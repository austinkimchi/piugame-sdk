import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";

import {
  extractAvatarImageFilename,
  GlobalAssetMapStore,
  normalizeAssetCode,
} from "../src/asset-map";
import { PiuClient } from "../src/client";
import type { HttpTransport, TransportResponse } from "../src/types";

function readFixture(fileName: string): string {
  return readFileSync(resolve(process.cwd(), "scraped", fileName), "utf8");
}

function response(
  status: number,
  body: string,
  headers: Record<string, string | string[] | undefined> = {},
  url = "https://www.piugame.com/mock",
): TransportResponse {
  return { status, body, headers, url };
}

function bestScorePageHtml(songName: string, score: number, page: number, lastPage: number): string {
  return `
    <div class="board_search"><div class="total_wrap"><i class="t2">1</i></div></div>
    <div class="my_best_score_wrap">
      <ul class="my_best_scoreList flex wrap">
        <li>
          <div class="in">
            <div class="level_con mgL">
              <div class="stepBall_in">
                <div class="tw"><img src="https://www.piugame.com/l_img/stepball/full/s_text.png"/></div>
                <div class="numw">
                  <img src="https://www.piugame.com/l_img/stepball/full/s_num_1.png"/>
                  <img src="https://www.piugame.com/l_img/stepball/full/s_num_4.png"/>
                </div>
              </div>
            </div>
            <div class="song_con"><div class="song_name"><p>${songName}</p></div></div>
            <div class="etc_con">
              <ul class="list">
                <li><div class="txt_v"><span class="num">${score.toLocaleString()}</span></div></li>
                <li><div class="img"><img src="https://www.piugame.com/l_img/grade/aa.png"/></div></li>
                <li><div class="img st1"><img src="https://www.piugame.com/l_img/plate/tg.png"/></div></li>
              </ul>
            </div>
          </div>
        </li>
      </ul>
      <div class="page_search">
        <div class="board_paging">
          <button type="button" onclick="location.href='?&&amp;page=${page}'" class="on">${page}</button>
          <button type="button" onclick="location.href='?&&amp;page=${lastPage}'" class="icon"><i class="xi last"></i></button>
        </div>
      </div>
    </div>
  `;
}

describe("global asset map module", () => {
  test("extracts avatar filename and normalizes asset code", () => {
    expect(
      extractAvatarImageFilename("https://www.piugame.com/data/avatar_img/a1b2c3.png?v=1"),
    ).toBe("a1b2c3.png");
    expect(extractAvatarImageFilename("https://www.piugame.com/l_img/grade/aa.png")).toBeNull();
    expect(extractAvatarImageFilename("not-a-url")).toBeNull();

    expect(normalizeAssetCode(" AA_P ")).toBe("aa_p");
    expect(normalizeAssetCode("")).toBeNull();
  });

  test("upserts globally without user metadata", async () => {
    const tempDir = await mkdtemp(resolve(tmpdir(), "piu-asset-map-store-"));
    try {
      const avatarPath = resolve(tempDir, "avatar-map.json");
      const gradePath = resolve(tempDir, "grade-map.json");
      const platePath = resolve(tempDir, "plate-map.json");
      const store = new GlobalAssetMapStore(avatarPath, gradePath, platePath);

      await store.recordPlayerData({
        username: "user_a",
        titleName: null,
        gameIdTag: null,
        gameId: null,
        gameTag: null,
        avatarUrl: "https://www.piugame.com/data/avatar_img/avatar_a.png",
        pp: null,
        pumbilityScore: null,
        lastAccess: null,
        recentArcade: null,
        playCount: null,
        rating: null,
        clear: { cleared: null, total: null, raw: null },
        progressPercent: null,
        plateCounts: {},
      });

      await store.recordRecentPlays([
        {
          songName: "Song",
          songImageUrl: null,
          mode: null,
          level: null,
          score: null,
          grade: "aa_p",
          plate: "fg",
          stageBreak: false,
          judgments: { perfect: null, great: null, good: null, bad: null, miss: null },
          playedAt: null,
        },
        {
          songName: "Song2",
          songImageUrl: null,
          mode: null,
          level: null,
          score: null,
          grade: "aa_p",
          plate: "fg",
          stageBreak: false,
          judgments: { perfect: null, great: null, good: null, bad: null, miss: null },
          playedAt: null,
        },
      ]);

      const avatarMap = JSON.parse(await readFile(avatarPath, "utf8"));
      const gradeMap = JSON.parse(await readFile(gradePath, "utf8"));
      const plateMap = JSON.parse(await readFile(platePath, "utf8"));

      expect(avatarMap["avatar_a.png"].seenCount).toBe(1);
      expect(gradeMap.aa_p.seenCount).toBe(2);
      expect(plateMap.fg.seenCount).toBe(2);

      const gradeKeys = Object.keys(gradeMap.aa_p).sort();
      expect(gradeKeys).toEqual(["firstSeenAt", "lastSeenAt", "seenCount"]);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});

describe("global asset map client integration", () => {
  test("enabled flag populates avatar, grade, and plate maps globally", async () => {
    const playDataHtml = readFixture("play_data.php");
    const recentPlayedHtml = readFixture("recently_played.php");
    const originalCwd = process.cwd();
    const originalAssetFlag = process.env.PIU_ASSET_MAP_ENABLE;
    const originalSongFlag = process.env.PIU_SONG_MAP_ENABLE;
    const tempDir = await mkdtemp(resolve(tmpdir(), "piu-asset-map-client-enabled-"));

    try {
      process.chdir(tempDir);
      process.env.PIU_ASSET_MAP_ENABLE = "1";
      delete process.env.PIU_SONG_MAP_ENABLE;

      const transport: HttpTransport = async (request) => {
        const url = new URL(request.url);

        if (url.pathname === "/bbs/login_check.php") {
          return response(302, "", {
            location: "/",
            "set-cookie": [
              "sid=mocksid; Path=/; Domain=.piugame.com; Max-Age=3600",
              "PHPSESSID=mockphp; Path=/",
            ],
          });
        }

        if (url.pathname === "/my_page/play_data.php") {
          return response(200, playDataHtml);
        }

        if (url.pathname === "/my_page/recently_played.php") {
          return response(200, recentPlayedHtml);
        }

        if (url.pathname === "/my_page/my_best_score.php") {
          const page = url.searchParams.get("page") ?? "1";
          if (page === "1") {
            return response(200, bestScorePageHtml("Song 1", 900001, 1, 1));
          }

          return response(200, "<ul class='my_best_scoreList'></ul>");
        }

        return response(404, "not found");
      };

      const client = new PiuClient({ transport });
      await client.login("user_a", "password_a");
      await client.getPlayerData("user_a");
      await client.getRecentPlays("user_a");
      await client.fetchAllPlays("user_a");

      await client.login("user_b", "password_b");
      await client.getRecentPlays("user_b");

      const avatarPath = resolve(tempDir, "data", "avatar-map.json");
      const gradePath = resolve(tempDir, "data", "grade-map.json");
      const platePath = resolve(tempDir, "data", "plate-map.json");

      const avatarMap = JSON.parse(await readFile(avatarPath, "utf8"));
      const gradeMap = JSON.parse(await readFile(gradePath, "utf8"));
      const plateMap = JSON.parse(await readFile(platePath, "utf8"));

      expect(Object.keys(avatarMap).length).toBeGreaterThan(0);
      expect(gradeMap.aa_p.seenCount).toBeGreaterThan(1);
      expect(gradeMap.aa.seenCount).toBeGreaterThan(0);
      expect(plateMap.fg.seenCount).toBeGreaterThan(1);
      expect(plateMap.tg.seenCount).toBeGreaterThan(0);

      const serialized = JSON.stringify({ avatarMap, gradeMap, plateMap }).toLowerCase();
      expect(serialized.includes("user_a")).toBe(false);
      expect(serialized.includes("user_b")).toBe(false);
    } finally {
      process.chdir(originalCwd);
      if (originalAssetFlag === undefined) {
        delete process.env.PIU_ASSET_MAP_ENABLE;
      } else {
        process.env.PIU_ASSET_MAP_ENABLE = originalAssetFlag;
      }
      if (originalSongFlag === undefined) {
        delete process.env.PIU_SONG_MAP_ENABLE;
      } else {
        process.env.PIU_SONG_MAP_ENABLE = originalSongFlag;
      }
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  test("disabled flag keeps asset map module as no-op", async () => {
    const playDataHtml = readFixture("play_data.php");
    const originalCwd = process.cwd();
    const originalAssetFlag = process.env.PIU_ASSET_MAP_ENABLE;
    const tempDir = await mkdtemp(resolve(tmpdir(), "piu-asset-map-client-disabled-"));

    try {
      process.chdir(tempDir);
      delete process.env.PIU_ASSET_MAP_ENABLE;

      const transport: HttpTransport = async (request) => {
        const url = new URL(request.url);

        if (url.pathname === "/bbs/login_check.php") {
          return response(302, "", {
            location: "/",
            "set-cookie": [
              "sid=mocksid; Path=/; Domain=.piugame.com; Max-Age=3600",
              "PHPSESSID=mockphp; Path=/",
            ],
          });
        }

        if (url.pathname === "/my_page/play_data.php") {
          return response(200, playDataHtml);
        }

        return response(404, "not found");
      };

      const client = new PiuClient({ transport });
      await client.login("fixture_user", "fixture_password");
      await client.getPlayerData("fixture_user");

      await expect(stat(resolve(tempDir, "data", "avatar-map.json"))).rejects.toBeTruthy();
      await expect(stat(resolve(tempDir, "data", "grade-map.json"))).rejects.toBeTruthy();
      await expect(stat(resolve(tempDir, "data", "plate-map.json"))).rejects.toBeTruthy();
    } finally {
      process.chdir(originalCwd);
      if (originalAssetFlag === undefined) {
        delete process.env.PIU_ASSET_MAP_ENABLE;
      } else {
        process.env.PIU_ASSET_MAP_ENABLE = originalAssetFlag;
      }
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
