import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, test, expect } from "vitest";

import { PiuClient } from "../src/client";
import {
  extractSongImageFilename,
  normalizeSongName,
  SongMapStore,
} from "../src/song-map";
import type { HttpTransport, TransportResponse } from "../src/types";

const PLAY_DATA_HTML = `
<div class="subProfile_wrap">
  <div class="in_profile">
    <div class="profile_name"><div class="name_w"><span class="t1">Title A</span><span class="t2">USER#1234</span></div></div>
    <div class="profile_img"><div class="re" style="background-image:url('https://www.piugame.com/data/avatar_img/avatar_a.png')"></div></div>
  </div>
</div>
<div class="board_search"><div class="total"><span class="t2">1</span></div></div>
<div class="play_data_wrap"><div class="my_w"><span class="num">100</span></div><div class="clear_w"><div class="l_con"><span class="t1">1 / 2</span></div><div class="graph"><span class="num">50%</span></div></div></div>
`;

const RECENT_PLAYS_HTML = `
<ul class="recently_playeList">
  <li>
    <div class="wrap_in"><div class="in" style="background-image:url('https://www.piugame.com/data/song_img/jacket_a.png')"></div></div>
    <div class="song_name"><p>BATTLE NO.1</p></div>
    <div class="stepBall_in">
      <div class="tw"><img src="https://www.piugame.com/l_img/stepball/full/s_text.png" /></div>
      <div class="numw"><img src="https://www.piugame.com/l_img/stepball/full/s_num_1.png" /><img src="https://www.piugame.com/l_img/stepball/full/s_num_4.png" /></div>
    </div>
    <div class="con2">
      <ul class="list">
        <li><div class="tx">unused</div></li>
        <li><div class="tx">927,332</div><img src="https://www.piugame.com/l_img/grade/aa_p.png" /></li>
        <li><img src="https://www.piugame.com/l_img/plate/fg.png" /></li>
      </ul>
    </div>
    <table class="recently_play"><tr><td data-th="Perfect"><span class="tx">1</span></td></tr></table>
    <div class="recently_date_tt">2026-01-01</div>
  </li>
  <li>
    <div class="wrap_in"><div class="in" style="background-image:url('https://www.piugame.com/data/song_img/jacket_b.png')"></div></div>
    <div class="song_name"><p>Conflict</p></div>
    <div class="stepBall_in">
      <div class="tw"><img src="https://www.piugame.com/l_img/stepball/full/s_text.png" /></div>
      <div class="numw"><img src="https://www.piugame.com/l_img/stepball/full/s_num_2.png" /><img src="https://www.piugame.com/l_img/stepball/full/s_num_0.png" /></div>
    </div>
    <div class="con2">
      <ul class="list">
        <li><div class="tx">unused</div></li>
        <li><div class="tx">900,000</div><img src="https://www.piugame.com/l_img/grade/aa.png" /></li>
        <li><img src="https://www.piugame.com/l_img/plate/tg.png" /></li>
      </ul>
    </div>
    <table class="recently_play"><tr><td data-th="Perfect"><span class="tx">1</span></td></tr></table>
    <div class="recently_date_tt">2026-01-01</div>
  </li>
</ul>
`;

function response(
  status: number,
  body: string,
  headers: Record<string, string | string[] | undefined> = {},
  url = "https://www.piugame.com/mock",
): TransportResponse {
  return { status, body, headers, url };
}

describe("song map module", () => {
  test("normalizes song names and extracts song image filename", () => {
    expect(normalizeSongName("  BATTLE   NO.1  ")).toBe("BATTLE NO.1");
    expect(
      extractSongImageFilename(
        "https://www.piugame.com/data/song_img/abc123.png?v=20251219163819",
      ),
    ).toBe("abc123.png");
    expect(extractSongImageFilename("https://www.piugame.com/l_img/grade/aa.png")).toBeNull();
    expect(extractSongImageFilename("not-a-url")).toBeNull();
  });

  test("stores multiple filenames per song and updates counters", async () => {
    const tempDir = await mkdtemp(resolve(tmpdir(), "piu-song-map-store-"));
    try {
      const filePath = resolve(tempDir, "song-map.json");
      const store = new SongMapStore(filePath);

      await store.recordRecentPlays([
        {
          songName: "BATTLE NO.1",
          songImageUrl: "https://www.piugame.com/data/song_img/a.png?v=1",
          mode: null,
          level: null,
          score: null,
          grade: null,
          plate: null,
          stageBreak: false,
          judgments: { perfect: null, great: null, good: null, bad: null, miss: null },
          playedAt: null,
        },
        {
          songName: "BATTLE NO.1",
          songImageUrl: "https://www.piugame.com/data/song_img/b.png?v=2",
          mode: null,
          level: null,
          score: null,
          grade: null,
          plate: null,
          stageBreak: false,
          judgments: { perfect: null, great: null, good: null, bad: null, miss: null },
          playedAt: null,
        },
        {
          songName: "BATTLE NO.1",
          songImageUrl: "https://www.piugame.com/data/song_img/a.png?v=3",
          mode: null,
          level: null,
          score: null,
          grade: null,
          plate: null,
          stageBreak: false,
          judgments: { perfect: null, great: null, good: null, bad: null, miss: null },
          playedAt: null,
        },
      ]);

      const parsed = JSON.parse(await readFile(filePath, "utf8"));
      const entry = parsed["BATTLE NO.1"];

      expect(entry.songName).toBe("BATTLE NO.1");
      expect(entry.images).toHaveLength(2);
      const a = entry.images.find((item: { filename: string }) => item.filename === "a.png");
      const b = entry.images.find((item: { filename: string }) => item.filename === "b.png");
      expect(a?.seenCount).toBe(2);
      expect(typeof a?.firstSeenAt).toBe("string");
      expect(typeof a?.lastSeenAt).toBe("string");
      expect(b?.seenCount).toBe(1);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  test("concurrent updates keep JSON valid and aggregate counts", async () => {
    const tempDir = await mkdtemp(resolve(tmpdir(), "piu-song-map-race-"));
    try {
      const filePath = resolve(tempDir, "song-map.json");
      const store = new SongMapStore(filePath);

      const samplePlay = {
        songName: "Conflict",
        songImageUrl: "https://www.piugame.com/data/song_img/conflict.png?v=1",
        mode: null,
        level: null,
        score: null,
        grade: null,
        plate: null,
        stageBreak: false,
        judgments: { perfect: null, great: null, good: null, bad: null, miss: null },
        playedAt: null,
      };

      await Promise.all([
        store.recordRecentPlays([samplePlay]),
        store.recordRecentPlays([samplePlay]),
        store.recordRecentPlays([samplePlay]),
        store.recordRecentPlays([samplePlay]),
      ]);

      const parsed = JSON.parse(await readFile(filePath, "utf8"));
      const entry = parsed.Conflict;
      expect(entry.images).toHaveLength(1);
      expect(entry.images[0].seenCount).toBe(4);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});

describe("song map client integration", () => {
  test("enabled flag ensures missing song jackets and does not write song-map.json", async () => {
    const playDataHtml = PLAY_DATA_HTML;
    const recentPlayedHtml = RECENT_PLAYS_HTML;
    const originalCwd = process.cwd();
    const originalFlag = process.env.PIU_SONG_MAP_ENABLE;
    const originalAutoFetchFlag = process.env.PIU_SONG_MAP_AUTO_FETCH;
    const tempDir = await mkdtemp(resolve(tmpdir(), "piu-song-map-client-enabled-"));

    try {
      process.chdir(tempDir);
      process.env.PIU_SONG_MAP_ENABLE = "1";
      delete process.env.PIU_SONG_MAP_AUTO_FETCH;

      let recentCalls = 0;
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
          return response(200, playDataHtml, {});
        }

        if (url.pathname === "/my_page/recently_played.php") {
          recentCalls += 1;
          return response(200, recentPlayedHtml, {});
        }

        return response(404, "not found");
      };

      const client = new PiuClient({ transport });
      let downloadCalls = 0;
      (client as any).requestBinary = async () => {
        downloadCalls += 1;
        return Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
      };
      await client.login("fixture_user", "fixture_password");
      await client.getRecentPlays("fixture_user");

      const imageDir = resolve(tempDir, "data", "song_img");
      const files = await readdir(imageDir);

      expect(recentCalls).toBe(1);
      expect(downloadCalls).toBeGreaterThan(0);
      expect(files.some((file) => file.toLowerCase().endsWith(".png"))).toBe(true);
      await expect(stat(resolve(tempDir, "data", "song-map.json"))).rejects.toBeTruthy();
    } finally {
      process.chdir(originalCwd);
      if (originalFlag === undefined) {
        delete process.env.PIU_SONG_MAP_ENABLE;
      } else {
        process.env.PIU_SONG_MAP_ENABLE = originalFlag;
      }
      if (originalAutoFetchFlag === undefined) {
        delete process.env.PIU_SONG_MAP_AUTO_FETCH;
      } else {
        process.env.PIU_SONG_MAP_AUTO_FETCH = originalAutoFetchFlag;
      }
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  test("auto-fetch flag remains as alias for song-jacket ensure mode", async () => {
    const playDataHtml = PLAY_DATA_HTML;
    const recentPlayedHtml = RECENT_PLAYS_HTML;
    const originalCwd = process.cwd();
    const originalFlag = process.env.PIU_SONG_MAP_ENABLE;
    const originalAutoFetchFlag = process.env.PIU_SONG_MAP_AUTO_FETCH;
    const tempDir = await mkdtemp(resolve(tmpdir(), "piu-song-map-auto-fetch-"));

    try {
      process.chdir(tempDir);
      delete process.env.PIU_SONG_MAP_ENABLE;
      process.env.PIU_SONG_MAP_AUTO_FETCH = "1";

      let recentCalls = 0;
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
          return response(200, playDataHtml, {});
        }

        if (url.pathname === "/my_page/recently_played.php") {
          recentCalls += 1;
          return response(200, recentPlayedHtml, {});
        }

        return response(404, "not found");
      };

      const client = new PiuClient({ transport });
      let downloadCalls = 0;
      (client as any).requestBinary = async () => {
        downloadCalls += 1;
        return Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
      };
      await client.login("fixture_user", "fixture_password");
      await client.getRecentPlays("fixture_user");
      const firstDownloadCount = downloadCalls;
      await client.getRecentPlays("fixture_user");

      expect(recentCalls).toBe(1);
      expect(firstDownloadCount).toBeGreaterThan(0);
      expect(downloadCalls).toBe(firstDownloadCount);
      await expect(stat(resolve(tempDir, "data", "song-map.json"))).rejects.toBeTruthy();
    } finally {
      process.chdir(originalCwd);
      if (originalFlag === undefined) {
        delete process.env.PIU_SONG_MAP_ENABLE;
      } else {
        process.env.PIU_SONG_MAP_ENABLE = originalFlag;
      }
      if (originalAutoFetchFlag === undefined) {
        delete process.env.PIU_SONG_MAP_AUTO_FETCH;
      } else {
        process.env.PIU_SONG_MAP_AUTO_FETCH = originalAutoFetchFlag;
      }
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  test("disabled flag keeps module as no-op", async () => {
    const playDataHtml = PLAY_DATA_HTML;
    const recentPlayedHtml = RECENT_PLAYS_HTML;
    const originalCwd = process.cwd();
    const originalFlag = process.env.PIU_SONG_MAP_ENABLE;
    const originalAutoFetchFlag = process.env.PIU_SONG_MAP_AUTO_FETCH;
    const tempDir = await mkdtemp(resolve(tmpdir(), "piu-song-map-client-disabled-"));

    try {
      process.chdir(tempDir);
      delete process.env.PIU_SONG_MAP_ENABLE;
      delete process.env.PIU_SONG_MAP_AUTO_FETCH;

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
          return response(200, playDataHtml, {});
        }

        if (url.pathname === "/my_page/recently_played.php") {
          return response(200, recentPlayedHtml, {});
        }

        return response(404, "not found");
      };

      const client = new PiuClient({ transport });
      let downloadCalls = 0;
      (client as any).requestBinary = async () => {
        downloadCalls += 1;
        return Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
      };
      await client.login("fixture_user", "fixture_password");
      await client.getRecentPlays("fixture_user");

      expect(downloadCalls).toBe(0);
      await expect(stat(resolve(tempDir, "data", "song_img"))).rejects.toBeTruthy();
      await expect(stat(resolve(tempDir, "data", "song-map.json"))).rejects.toBeTruthy();
    } finally {
      process.chdir(originalCwd);
      if (originalFlag === undefined) {
        delete process.env.PIU_SONG_MAP_ENABLE;
      } else {
        process.env.PIU_SONG_MAP_ENABLE = originalFlag;
      }
      if (originalAutoFetchFlag === undefined) {
        delete process.env.PIU_SONG_MAP_AUTO_FETCH;
      } else {
        process.env.PIU_SONG_MAP_AUTO_FETCH = originalAutoFetchFlag;
      }
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
