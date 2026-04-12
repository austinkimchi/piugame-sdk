import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";

import {
  buildSongCatalogDocuments,
  buildSongCatalogFromHtml,
  ensureSongCatalogIndexes,
  parseSongCatalogRows,
  upsertSongCatalogDocuments,
  type ParsedSongChartRow,
  type SongCatalogDocument,
} from "../src/song-catalog";

function readFixture(fileName: string): string {
  return readFileSync(resolve(process.cwd(), "scraped", fileName), "utf8");
}

class FakeSongCatalogCollection {
  public readonly indexes: Array<{ key: Record<string, unknown>; options?: Record<string, unknown> }> = [];
  public readonly documents = new Map<string, SongCatalogDocument>();

  public async createIndex(
    key: Record<string, unknown>,
    options?: Record<string, unknown>,
  ): Promise<string> {
    this.indexes.push({ key, options });
    return `idx_${this.indexes.length}`;
  }

  public async updateOne(
    filter: Record<string, unknown>,
    update: { $set: SongCatalogDocument },
    options: { upsert?: boolean },
  ): Promise<{ matchedCount: number; modifiedCount: number; upsertedCount: number }> {
    const key = `${String(filter.songKey)}\u0000${String(filter.artist)}`;
    const next = update.$set;
    const current = this.documents.get(key);

    if (!current) {
      if (options.upsert) {
        this.documents.set(key, next);
        return { matchedCount: 0, modifiedCount: 0, upsertedCount: 1 };
      }

      return { matchedCount: 0, modifiedCount: 0, upsertedCount: 0 };
    }

    const changed = JSON.stringify(current) !== JSON.stringify(next);
    this.documents.set(key, next);
    return {
      matchedCount: 1,
      modifiedCount: changed ? 1 : 0,
      upsertedCount: 0,
    };
  }
}

describe("song catalog parser", () => {
  test("extracts song, artist, image, scope, mode, and level from SONG_LIST_042026.php", () => {
    const html = readFixture("SONG_LIST_042026.php");
    const parsed = parseSongCatalogRows(html);

    expect(parsed.rows.length).toBeGreaterThan(4000);
    expect(parsed.totalRows).toBe(4714);
    expect(parsed.rows.length + parsed.skippedRows).toBe(parsed.totalRows);

    const basicChart = parsed.rows.find(
      (row) =>
        row.songName === "Queencard" &&
        row.artist === "(G)I-DLE" &&
        row.scope === "basic" &&
        row.mode === "N" &&
        row.level === 3,
    );

    expect(basicChart).toBeTruthy();
    expect(basicChart?.imageFilename).toBe("b79e7c017f5e5a725f1904a58ab6aa87.png");
    expect((basicChart as unknown as Record<string, unknown>)?.tt).toBeUndefined();

    const fullChart = parsed.rows.find(
      (row) =>
        row.songName === "Euphorianic" &&
        row.artist === "SHK" &&
        row.scope === "full" &&
        row.mode === "S" &&
        row.level === 16,
    );
    expect(fullChart).toBeTruthy();
    expect(fullChart?.imageFilename).toBe("7e1af52be6d8b4e147d2a0ebbf54ef98.png");
    expect(parsed.rows.some((row) => row.mode === "C")).toBe(true);

    const ladybugHard = parsed.rows.find(
      (row) =>
        row.songName === "Ladybug" &&
        row.artist === "Coconut" &&
        row.scope === "basic" &&
        row.mode === "H" &&
        row.level === 5,
    );
    expect(ladybugHard).toBeTruthy();

    const skippedUnknownLevel = parsed.skippedDetails.find(
      (row) => row.songName === "1948" && row.artist === "SLAM",
    );
    expect(skippedUnknownLevel?.reasons).toContain("missingLevel");
  });
});

describe("song catalog build behavior", () => {
  test("dedupes repeated charts and applies S -> D -> C full chart sort + token formatting", () => {
    const rows: ParsedSongChartRow[] = [
      { songName: "Timing", artist: "BanYa", imageFilename: "timing-b.png", scope: "full", mode: "D", level: 19 },
      { songName: "Timing", artist: "BanYa", imageFilename: "timing-a.png", scope: "full", mode: "S", level: 14 },
      { songName: "Timing", artist: "BanYa", imageFilename: "timing-a.png", scope: "full", mode: "S", level: 3 },
      { songName: "Timing", artist: "BanYa", imageFilename: "timing-a.png", scope: "full", mode: "C", level: 4 },
      { songName: "Timing", artist: "BanYa", imageFilename: "timing-a.png", scope: "full", mode: "C", level: 2 },
      { songName: "Timing", artist: "BanYa", imageFilename: "timing-b.png", scope: "full", mode: "D", level: 14 },
      { songName: "Timing", artist: "BanYa", imageFilename: "timing-b.png", scope: "full", mode: "D", level: 14 },
      { songName: "Timing", artist: "BanYa", imageFilename: "timing-a.png", scope: "basic", mode: "N", level: 4 },
      { songName: "Timing", artist: "BanYa", imageFilename: "timing-a.png", scope: "basic", mode: "H", level: 7 },
    ];

    const docs = buildSongCatalogDocuments(rows, "fixture.php", "2026-04-20T00:00:00.000Z");
    expect(docs).toHaveLength(1);

    const doc = docs[0];
    expect(doc.images).toEqual(["timing-a.png", "timing-b.png"]);
    expect(doc.chartsFull.map((chart) => chart.token)).toEqual(["S3", "S14", "D14", "D19", "Cx2", "Cx4"]);
    expect(doc.chartsBasic.map((chart) => chart.token)).toEqual(["N4", "H7"]);
    expect(doc.chartTokens).toEqual(["S3", "S14", "D14", "D19", "Cx2", "Cx4"]);
    expect(doc.chartTokens).not.toContain("N4");
    expect(doc.chartTokens).not.toContain("H7");
  });

  test("keeps full-song titles distinct from non-full-song titles", () => {
    const rows: ParsedSongChartRow[] = [
      { songName: "Full Moon", artist: "Dreamcatcher", imageFilename: "a.png", scope: "full", mode: "S", level: 12 },
      { songName: "Full Moon - FULL SONG -", artist: "Dreamcatcher", imageFilename: "b.png", scope: "full", mode: "S", level: 18 },
    ];

    const docs = buildSongCatalogDocuments(rows, "fixture.php", "2026-04-20T00:00:00.000Z");
    expect(docs).toHaveLength(2);
    expect(docs.find((doc) => doc.songName === "Full Moon")).toBeTruthy();
    expect(docs.find((doc) => doc.songName === "Full Moon - FULL SONG -")).toBeTruthy();
  });
});

describe("song catalog integration", () => {
  test("builds from SONG_LIST fixture and upserts idempotently", async () => {
    const html = readFixture("SONG_LIST_042026.php");
    const built = buildSongCatalogFromHtml(html, "SONG_LIST_042026.php", "2026-04-20T00:00:00.000Z");
    const collection = new FakeSongCatalogCollection();

    await ensureSongCatalogIndexes(collection as unknown as any);
    const first = await upsertSongCatalogDocuments(collection as unknown as any, built.documents);
    const second = await upsertSongCatalogDocuments(collection as unknown as any, built.documents);

    expect(collection.indexes).toHaveLength(2);
    expect(collection.documents.size).toBe(built.uniqueSongs);
    expect(first.upsertedCount).toBe(built.uniqueSongs);
    expect(second.upsertedCount).toBe(0);
    expect(second.modifiedCount).toBe(0);
    expect(built.totalRows).toBe(4714);
    expect(built.parsedRows + built.skippedRows).toBe(built.totalRows);

    const sample = collection.documents.get("Queencard\u0000(G)I-DLE");
    expect(sample).toBeTruthy();
    expect(sample?.chartsBasic.length || 0).toBeGreaterThan(0);
    expect(sample?.source.sourceFile).toBe("SONG_LIST_042026.php");
    expect(sample?.chartTokens.length || 0).toBeGreaterThan(0);

    const ladybug = collection.documents.get("Ladybug\u0000Coconut");
    expect(ladybug?.chartsBasic.some((chart) => chart.mode === "H" && chart.level === 5)).toBe(true);
    expect(ladybug?.chartTokens.includes("H5")).toBe(false);
  });
});
