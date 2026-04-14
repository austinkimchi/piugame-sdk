import { mkdtemp, mkdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";

import { PiuClient } from "../src/client";
import type { HttpTransport, TransportResponse } from "../src/types";

const PLAY_DATA_HTML = `
<div class="subProfile_wrap">
  <div class="in_profile">
    <div class="profile_name">
      <div class="name_w">
        <span class="t1">Title A</span>
        <span class="t2">USER#1234</span>
      </div>
    </div>
    <div class="profile_img">
      <div class="re" style="background-image:url('https://www.piugame.com/data/avatar_img/avatar_a.png')"></div>
    </div>
    <div class="profile_etc"><span class="tt">12,345</span></div>
    <ul class="time_w"><li><span class="tt">last access date : 2026-01-01</span></li></ul>
  </div>
</div>
<div class="board_search"><div class="total"><span class="t2">1</span></div></div>
<div class="play_data_wrap">
  <div class="my_w"><span class="num">123</span></div>
  <div class="clear_w">
    <div class="l_con"><span class="t1">1 / 2</span></div>
    <div class="graph"><span class="num">50%</span></div>
  </div>
  <div class="plate_w"><ul class="list"></ul></div>
</div>
`;

const RECENT_PLAYS_HTML = `
<ul class="recently_playeList">
  <li>
    <div class="wrap_in">
      <div class="in" style="background-image:url('https://www.piugame.com/data/song_img/song1.png')"></div>
    </div>
    <div class="song_name"><p>Song 1</p></div>
    <div class="stepBall_in">
      <div class="tw"><img src="https://www.piugame.com/l_img/stepball/full/s_text.png" /></div>
      <div class="numw">
        <img src="https://www.piugame.com/l_img/stepball/full/s_num_1.png" />
        <img src="https://www.piugame.com/l_img/stepball/full/s_num_5.png" />
      </div>
    </div>
    <div class="con2">
      <ul class="list">
        <li><div class="tx">unused</div></li>
        <li>
          <div class="tx">999,999</div>
          <img src="https://www.piugame.com/l_img/grade/aa_p.png" />
        </li>
        <li><img src="https://www.piugame.com/l_img/plate/fg.png" /></li>
      </ul>
    </div>
    <table class="recently_play"><tr><td data-th="Perfect"><span class="tx">1</span></td></tr></table>
    <div class="recently_date_tt">2026-01-01</div>
  </li>
</ul>
`;

const BEST_SCORE_HTML = `
<div class="board_search"><div class="total_wrap"><span class="t2">1</span></div></div>
<ul class="my_best_scoreList">
  <li>
    <div class="song_name"><p>Song 2</p></div>
    <div class="stepBall_in">
      <div class="tw"><img src="https://www.piugame.com/l_img/stepball/full/s_text.png" /></div>
      <div class="numw"><img src="https://www.piugame.com/l_img/stepball/full/s_num_1.png" /></div>
    </div>
    <div class="etc_con">
      <ul>
        <li><div class="txt_v"><span class="num">900,001</span></div></li>
        <li><img src="https://www.piugame.com/l_img/grade/aa.png" /></li>
        <li><img src="https://www.piugame.com/l_img/plate/tg.png" /></li>
      </ul>
    </div>
  </li>
</ul>
<div class="board_paging">
  <button type="button" class="on">1</button>
</div>
`;

function response(
  status: number,
  body: string,
  headers: Record<string, string | string[] | undefined> = {},
  url = "https://www.piugame.com/mock",
): TransportResponse {
  return { status, body, headers, url };
}

function createTransport(counters: { recentCalls: number }): HttpTransport {
  return async (request) => {
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
      return response(200, PLAY_DATA_HTML);
    }

    if (url.pathname === "/my_page/recently_played.php") {
      counters.recentCalls += 1;
      return response(200, RECENT_PLAYS_HTML);
    }

    if (url.pathname === "/my_page/my_best_score.php") {
      const page = url.searchParams.get("page") ?? "1";
      if (page === "1") {
        return response(200, BEST_SCORE_HTML);
      }

      return response(200, "<ul class='my_best_scoreList'></ul>");
    }

    return response(404, "not found");
  };
}

describe("asset jacket ensure mode", () => {
  test("enabled flag downloads avatar/grade/plate assets and does not write map JSON", async () => {
    const originalCwd = process.cwd();
    const originalAssetFlag = process.env.PIU_ASSET_MAP_ENABLE;
    const originalSongFlag = process.env.PIU_SONG_MAP_ENABLE;
    const originalSongAutoFlag = process.env.PIU_SONG_MAP_AUTO_FETCH;
    const tempDir = await mkdtemp(resolve(tmpdir(), "piu-asset-jackets-enabled-"));

    try {
      process.chdir(tempDir);
      process.env.PIU_ASSET_MAP_ENABLE = "1";
      delete process.env.PIU_SONG_MAP_ENABLE;
      delete process.env.PIU_SONG_MAP_AUTO_FETCH;

      const counters = { recentCalls: 0 };
      const transport = createTransport(counters);
      const client = new PiuClient({ transport });

      let downloadCalls = 0;
      (client as any).requestBinary = async () => {
        downloadCalls += 1;
        return Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
      };

      await client.login("user_a", "password_a");
      await client.getPlayerData("user_a");
      await client.getRecentPlays("user_a");
      await client.fetchAllPlays("user_a");

      expect(counters.recentCalls).toBe(1);
      expect(downloadCalls).toBeGreaterThanOrEqual(5);

      await stat(resolve(tempDir, "data", "avatar_img", "avatar_a.png"));
      await stat(resolve(tempDir, "data", "l_img", "grade", "aa_p.png"));
      await stat(resolve(tempDir, "data", "l_img", "grade", "aa.png"));
      await stat(resolve(tempDir, "data", "l_img", "plate", "fg.png"));
      await stat(resolve(tempDir, "data", "l_img", "plate", "tg.png"));

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
      if (originalSongFlag === undefined) {
        delete process.env.PIU_SONG_MAP_ENABLE;
      } else {
        process.env.PIU_SONG_MAP_ENABLE = originalSongFlag;
      }
      if (originalSongAutoFlag === undefined) {
        delete process.env.PIU_SONG_MAP_AUTO_FETCH;
      } else {
        process.env.PIU_SONG_MAP_AUTO_FETCH = originalSongAutoFlag;
      }
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  test("repeated calls do not re-download existing asset jackets", async () => {
    const originalCwd = process.cwd();
    const originalAssetFlag = process.env.PIU_ASSET_MAP_ENABLE;
    const tempDir = await mkdtemp(resolve(tmpdir(), "piu-asset-jackets-cache-"));

    try {
      process.chdir(tempDir);
      process.env.PIU_ASSET_MAP_ENABLE = "1";

      const counters = { recentCalls: 0 };
      const client = new PiuClient({ transport: createTransport(counters) });
      let downloadCalls = 0;
      (client as any).requestBinary = async () => {
        downloadCalls += 1;
        return Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
      };

      await client.login("user_a", "password_a");
      await client.getRecentPlays("user_a");
      const firstDownloadCount = downloadCalls;
      await client.getRecentPlays("user_a");

      expect(counters.recentCalls).toBe(1);
      expect(firstDownloadCount).toBeGreaterThan(0);
      expect(downloadCalls).toBe(firstDownloadCount);
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

  test("existing grade-map.json does not trigger map-based backfill downloads", async () => {
    const originalCwd = process.cwd();
    const originalAssetFlag = process.env.PIU_ASSET_MAP_ENABLE;
    const tempDir = await mkdtemp(resolve(tmpdir(), "piu-asset-jackets-no-backfill-"));

    try {
      process.chdir(tempDir);
      process.env.PIU_ASSET_MAP_ENABLE = "1";

      await mkdir(resolve(tempDir, "data"), { recursive: true });
      await writeFile(
        resolve(tempDir, "data", "grade-map.json"),
        JSON.stringify(
          {
            zz: {
              firstSeenAt: "2026-01-01T00:00:00.000Z",
              lastSeenAt: "2026-01-01T00:00:00.000Z",
              seenCount: 1,
            },
          },
          null,
          2,
        ),
        "utf8",
      );

      const client = new PiuClient({ transport: createTransport({ recentCalls: 0 }) });
      const downloadedUrls: string[] = [];
      (client as any).requestBinary = async (urlText: string) => {
        downloadedUrls.push(urlText);
        return Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
      };

      await client.login("user_a", "password_a");
      await client.getRecentPlays("user_a");

      expect(downloadedUrls.some((urlText) => /\/l_img\/grade\/zz\.png$/i.test(urlText))).toBe(false);
      expect(downloadedUrls.some((urlText) => /\/l_img\/grade\/aa_p\.png$/i.test(urlText))).toBe(true);
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

  test("disabled flag keeps asset jacket ensure as no-op", async () => {
    const originalCwd = process.cwd();
    const originalAssetFlag = process.env.PIU_ASSET_MAP_ENABLE;
    const tempDir = await mkdtemp(resolve(tmpdir(), "piu-asset-jackets-disabled-"));

    try {
      process.chdir(tempDir);
      delete process.env.PIU_ASSET_MAP_ENABLE;

      const counters = { recentCalls: 0 };
      const client = new PiuClient({ transport: createTransport(counters) });
      let downloadCalls = 0;
      (client as any).requestBinary = async () => {
        downloadCalls += 1;
        return Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
      };

      await client.login("user_a", "password_a");
      await client.getPlayerData("user_a");
      await client.getRecentPlays("user_a");
      await client.fetchAllPlays("user_a");

      expect(downloadCalls).toBe(0);
      await expect(stat(resolve(tempDir, "data", "avatar_img", "avatar_a.png"))).rejects.toBeTruthy();
      await expect(stat(resolve(tempDir, "data", "l_img", "grade", "aa_p.png"))).rejects.toBeTruthy();
      await expect(stat(resolve(tempDir, "data", "l_img", "plate", "fg.png"))).rejects.toBeTruthy();
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
