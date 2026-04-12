import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, test, expect } from "vitest";

import {
  extractLastPageNumber,
  parseBestScorePage,
  parseOwnedTitleCount,
  parsePumbilityScore,
  parsePlayerData,
  parseRecentPlays,
  parseTitleEntries,
} from "../src/parsers";

function readFixture(fileName: string): string {
  return readFileSync(resolve(process.cwd(), "scraped", fileName), "utf8");
}

describe("parsers", () => {
  test("parsePlayerData extracts profile and summary values", () => {
    const html = readFixture("play_data.php");
    const data = parsePlayerData(html, "fixture_user");

    expect(data.username).toBe("fixture_user");
    expect(data.titleName).toBe("CONRAD FOLLOWER");
    expect(data.gameIdTag).toBe("PKIMCHI#7501");
    expect(data.gameId).toBe("PKIMCHI");
    expect(data.gameTag).toBe("#7501");
    expect(data.avatarUrl).toContain("/data/avatar_img/");
    expect(data.pp).toBe(1034);
    expect(data.lastAccess).toBe("2026-04-11 12:37:31");
    expect(data.recentArcade).toBe("ROUND1 SLM 2");
    expect(data.playCount).toBe(215);
    expect(data.rating).toBe(18318);
    expect(data.clear.cleared).toBe(125);
    expect(data.clear.total).toBe(3646);
    expect(data.progressPercent).toBe(3);
    expect(data.plateCounts.ug).toBe(1);
    expect(data.plateCounts.sg).toBe(1);
    expect(data.plateCounts.mg).toBe(39);
    expect(data.plateCounts.tg).toBe(44);
    expect(data.plateCounts.fg).toBe(40);
  });

  test("parseRecentPlays extracts plays including stage break and judgments", () => {
    const html = readFixture("recently_played.php");
    const plays = parseRecentPlays(html);

    expect(plays.length).toBeGreaterThan(0);

    const first = plays[0];
    expect(first.songName).toBe("Clematis Rapsodia");
    expect(first.mode).toBe("S");
    expect(first.level).toBe(15);
    expect(first.stageBreak).toBe(true);
    expect(first.score).toBeNull();
    expect(first.judgments.perfect).toBe(555);
    expect(first.judgments.great).toBe(60);
    expect(first.judgments.good).toBe(28);
    expect(first.judgments.bad).toBe(16);
    expect(first.judgments.miss).toBe(28);
    expect(first.playedAt).toBe("2026-04-11 12:45:50 (GMT+9)");

    const second = plays[1];
    expect(second.songName).toBe("BATTLE NO.1");
    expect(second.stageBreak).toBe(false);
    expect(second.score).toBe(927332);
    expect(second.grade).toBe("aa_p");
    expect(second.plate).toBe("fg");
  });

  test("parsePlayerData normalizes spaces around # in gameIdTag", () => {
    const html = readFixture("play_data.php").replace("PKIMCHI #7501", "PKIMCHI   #   7501");
    const data = parsePlayerData(html, "fixture_user");

    expect(data.gameIdTag).toBe("PKIMCHI#7501");
    expect(data.gameId).toBe("PKIMCHI");
    expect(data.gameTag).toBe("#7501");
  });

  test("parsePumbilityScore extracts total score", () => {
    const html = readFixture("pumpbility.php");
    const score = parsePumbilityScore(html);
    expect(score).toBe(9352);
  });

  test("parseTitleEntries extracts title state and metadata", () => {
    const html = readFixture("title.php");
    const ownedCount = parseOwnedTitleCount(html);
    const titles = parseTitleEntries(html);

    expect(ownedCount).toBe(8);
    expect(titles.length).toBeGreaterThan(10);

    const inUse = titles.find((title) => title.name === "CONRAD FOLLOWER");
    expect(inUse).toBeTruthy();
    expect(inUse?.owned).toBe(true);
    expect(inUse?.inUse).toBe(true);
    expect(inUse?.statusText).toBe("Title in use");

    const settable = titles.find((title) => title.name === "GOLD MEMBER");
    expect(settable).toBeTruthy();
    expect(settable?.owned).toBe(true);
    expect(settable?.settable).toBe(true);
    expect(settable?.statusText).toBe("Set");

    const locked = titles.find((title) => title.name === "DOMINION CHALLENGER");
    expect(locked).toBeTruthy();
    expect(locked?.owned).toBe(false);
    expect(locked?.locked).toBe(true);
  });

  test("parseBestScorePage extracts score items and pagination", () => {
    const html = readFixture("my_best_score.php");
    const page = parseBestScorePage(html, 1);

    expect(page.page).toBe(1);
    expect(page.total).toBe(269);
    expect(page.lastPage).toBe(23);
    expect(page.plays.length).toBeGreaterThan(0);

    const first = page.plays[0];
    expect(first.songName).toBe("BATTLE NO.1");
    expect(first.mode).toBe("S");
    expect(first.level).toBe(14);
    expect(first.score).toBe(927332);
    expect(first.grade).toBe("aa_p");
    expect(first.plate).toBe("fg");

    expect(extractLastPageNumber(html)).toBe(23);
  });
});
