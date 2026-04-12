import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import { describe, test, expect } from "vitest";

import { PiuClient } from "../src/client";
import {
  extractSongImageFilename,
  normalizeSongName,
  SongMapStore,
} from "../src/song-map";
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
  test("enabled flag updates song map on login and each getRecentPlays call", async () => {
    const playDataHtml = readFixture("play_data.php");
    const recentPlayedHtml = readFixture("recently_played.php");
    const originalCwd = process.cwd();
    const originalFlag = process.env.PIU_SONG_MAP_ENABLE;
    const tempDir = await mkdtemp(resolve(tmpdir(), "piu-song-map-client-enabled-"));

    try {
      process.chdir(tempDir);
      process.env.PIU_SONG_MAP_ENABLE = "1";

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
      await client.login("fixture_user", "fixture_password");
      await client.getRecentPlays("fixture_user");

      const mapPath = resolve(tempDir, "data", "song-map.json");
      const parsed = JSON.parse(await readFile(mapPath, "utf8"));
      const battle = parsed["BATTLE NO.1"];
      const battleFile = battle.images.find((item: { filename: string }) =>
        item.filename.includes("12452411f0fddba3caf2382c9bf033f4"),
      );

      expect(recentCalls).toBe(1);
      expect(battleFile?.seenCount).toBe(2);
    } finally {
      process.chdir(originalCwd);
      if (originalFlag === undefined) {
        delete process.env.PIU_SONG_MAP_ENABLE;
      } else {
        process.env.PIU_SONG_MAP_ENABLE = originalFlag;
      }
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  test("auto-fetch flag downloads newly discovered song jacket PNGs", async () => {
    const playDataHtml = readFixture("play_data.php");
    const recentPlayedHtml = readFixture("recently_played.php");
    const originalCwd = process.cwd();
    const originalFlag = process.env.PIU_SONG_MAP_ENABLE;
    const originalAutoFetchFlag = process.env.PIU_SONG_MAP_AUTO_FETCH;
    const originalFetch = globalThis.fetch;
    const tempDir = await mkdtemp(resolve(tmpdir(), "piu-song-map-auto-fetch-"));

    try {
      process.chdir(tempDir);
      process.env.PIU_SONG_MAP_ENABLE = "1";
      process.env.PIU_SONG_MAP_AUTO_FETCH = "1";

      globalThis.fetch = (async () => {
        const pngBytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
        return new Response(pngBytes, { status: 200 });
      }) as typeof fetch;

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
      await client.login("fixture_user", "fixture_password");
      await client.getRecentPlays("fixture_user");

      const mapPath = resolve(tempDir, "data", "song-map.json");
      const parsed = JSON.parse(await readFile(mapPath, "utf8"));
      const battle = parsed["BATTLE NO.1"];
      const jacketFilename = battle.images[0].filename as string;

      const jacketPath = resolve(tempDir, "data", "song_img", jacketFilename);
      const written = await readFile(jacketPath);
      expect(written.length).toBeGreaterThan(0);
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
      globalThis.fetch = originalFetch;
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  test("disabled flag keeps module as no-op", async () => {
    const playDataHtml = readFixture("play_data.php");
    const originalCwd = process.cwd();
    const originalFlag = process.env.PIU_SONG_MAP_ENABLE;
    const tempDir = await mkdtemp(resolve(tmpdir(), "piu-song-map-client-disabled-"));

    try {
      process.chdir(tempDir);
      delete process.env.PIU_SONG_MAP_ENABLE;

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
          return response(200, "", {});
        }

        return response(404, "not found");
      };

      const client = new PiuClient({ transport });
      await client.login("fixture_user", "fixture_password");

      expect(recentCalls).toBe(0);
    } finally {
      process.chdir(originalCwd);
      if (originalFlag === undefined) {
        delete process.env.PIU_SONG_MAP_ENABLE;
      } else {
        process.env.PIU_SONG_MAP_ENABLE = originalFlag;
      }
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
