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

const SONG_LIST_HTML = `
<ul class="top_songs_list">
  <li>
    <div class="profile_name"><span class="t1">Queencard</span><span class="t2">(G)I-DLE</span></div>
    <div class="profile_img"><div class="re" style="background-image:url('https://www.piugame.com/data/song_img/q.png?v=1')"></div></div>
    <div class="stepBall_in" style="background-image:url('/l_img/stepball/basic/n_bg.png')">
      <div class="tw"><img src="https://www.piugame.com/l_img/stepball/basic/n_text.png" /></div>
      <div class="numw"><img src="https://www.piugame.com/l_img/stepball/basic/n_num_3.png" /></div>
    </div>
  </li>
  <li>
    <div class="profile_name"><span class="t1">Euphorianic</span><span class="t2">SHK</span></div>
    <div class="profile_img"><div class="re" style="background-image:url('https://www.piugame.com/data/song_img/e.png?v=1')"></div></div>
    <div class="stepBall_in" style="background-image:url('/l_img/stepball/full/s_bg.png')">
      <div class="tw"><img src="https://www.piugame.com/l_img/stepball/full/s_text.png" /></div>
      <div class="numw"><img src="https://www.piugame.com/l_img/stepball/full/s_num_1.png" /><img src="https://www.piugame.com/l_img/stepball/full/s_num_6.png" /></div>
    </div>
  </li>
  <li>
    <div class="profile_name"><span class="t1">1948</span><span class="t2">SLAM</span></div>
    <div class="profile_img"><div class="re" style="background-image:url('https://www.piugame.com/data/song_img/x.png?v=1')"></div></div>
    <div class="stepBall_in" style="background-image:url('/l_img/stepball/full/s_bg.png')">
      <div class="tw"><img src="https://www.piugame.com/l_img/stepball/full/s_text.png" /></div>
      <div class="numw"></div>
    </div>
  </li>
</ul>
`;

class FakeSongCatalogCollection {
  public readonly indexes: Array<{ key: Record<string, unknown>; options?: Record<string, unknown> }> = [];
  public readonly documents = new Map<string, SongCatalogDocument>();
  public bulkWriteCalls = 0;

  public async createIndex(
    key: Record<string, unknown>,
    options?: Record<string, unknown>,
  ): Promise<string> {
    this.indexes.push({ key, options });
    return `idx_${this.indexes.length}`;
  }

  private applyUpdate(
    filter: Record<string, unknown>,
    update: { $set: SongCatalogDocument },
    options: { upsert?: boolean },
  ): { matchedCount: number; modifiedCount: number; upsertedCount: number } {
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

  public async bulkWrite(
    operations: Array<{
      updateOne: {
        filter: Record<string, unknown>;
        update: { $set: SongCatalogDocument };
        upsert?: boolean;
      };
    }>,
  ): Promise<{ matchedCount: number; modifiedCount: number; upsertedCount: number }> {
    this.bulkWriteCalls += 1;
    return operations.reduce(
      (total, operation) => {
        const result = this.applyUpdate(
          operation.updateOne.filter,
          operation.updateOne.update,
          { upsert: operation.updateOne.upsert },
        );
        return {
          matchedCount: total.matchedCount + result.matchedCount,
          modifiedCount: total.modifiedCount + result.modifiedCount,
          upsertedCount: total.upsertedCount + result.upsertedCount,
        };
      },
      { matchedCount: 0, modifiedCount: 0, upsertedCount: 0 },
    );
  }
}

describe("song catalog parser", () => {
  test("extracts rows and reports skipped rows from inline SONG_LIST fixture", () => {
    const parsed = parseSongCatalogRows(SONG_LIST_HTML);

    expect(parsed.totalRows).toBe(3);
    expect(parsed.rows).toHaveLength(2);
    expect(parsed.skippedRows).toBe(1);

    const basicChart = parsed.rows.find(
      (row) =>
        row.songName === "Queencard" &&
        row.artist === "(G)I-DLE" &&
        row.scope === "basic" &&
        row.mode === "N" &&
        row.level === "3",
    );
    expect(basicChart?.imageFilename).toBe("q.png");

    const fullChart = parsed.rows.find(
      (row) =>
        row.songName === "Euphorianic" &&
        row.artist === "SHK" &&
        row.scope === "full" &&
        row.mode === "S" &&
        row.level === "16",
    );
    expect(fullChart?.imageFilename).toBe("e.png");

    const skippedUnknownLevel = parsed.skippedDetails.find(
      (row) => row.songName === "1948" && row.artist === "SLAM",
    );
    expect(skippedUnknownLevel?.reasons).toContain("missingLevel");
  });
});

describe("song catalog build behavior", () => {
  test("dedupes repeated charts and applies S -> D -> C full chart sort + token formatting", () => {
    const rows: ParsedSongChartRow[] = [
      { songName: "Timing", artist: "BanYa", imageFilename: "timing-b.png", scope: "full", mode: "D", level: "19" },
      { songName: "Timing", artist: "BanYa", imageFilename: "timing-a.png", scope: "full", mode: "S", level: "14" },
      { songName: "Timing", artist: "BanYa", imageFilename: "timing-a.png", scope: "full", mode: "S", level: "3" },
      { songName: "Timing", artist: "BanYa", imageFilename: "timing-a.png", scope: "full", mode: "C", level: "4" },
      { songName: "Timing", artist: "BanYa", imageFilename: "timing-a.png", scope: "full", mode: "C", level: "2" },
      { songName: "Timing", artist: "BanYa", imageFilename: "timing-b.png", scope: "full", mode: "D", level: "14" },
      { songName: "Timing", artist: "BanYa", imageFilename: "timing-b.png", scope: "full", mode: "D", level: "14" },
      { songName: "Timing", artist: "BanYa", imageFilename: "timing-a.png", scope: "basic", mode: "N", level: "4" },
      { songName: "Timing", artist: "BanYa", imageFilename: "timing-a.png", scope: "basic", mode: "H", level: "7" },
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
      { songName: "Full Moon", artist: "Dreamcatcher", imageFilename: "a.png", scope: "full", mode: "S", level: "12" },
      { songName: "Full Moon - FULL SONG -", artist: "Dreamcatcher", imageFilename: "b.png", scope: "full", mode: "S", level: "18" },
    ];

    const docs = buildSongCatalogDocuments(rows, "fixture.php", "2026-04-20T00:00:00.000Z");
    expect(docs).toHaveLength(2);
    expect(docs.find((doc) => doc.songName === "Full Moon")).toBeTruthy();
    expect(docs.find((doc) => doc.songName === "Full Moon - FULL SONG -")).toBeTruthy();
  });
});

describe("song catalog integration", () => {
  test("builds from inline SONG_LIST fixture and upserts idempotently", async () => {
    const built = buildSongCatalogFromHtml(SONG_LIST_HTML, "inline-song-list", "2026-04-20T00:00:00.000Z");
    const collection = new FakeSongCatalogCollection();

    await ensureSongCatalogIndexes(collection as unknown as any);
    const first = await upsertSongCatalogDocuments(collection as unknown as any, built.documents);
    const second = await upsertSongCatalogDocuments(collection as unknown as any, built.documents);
    const empty = await upsertSongCatalogDocuments(collection as unknown as any, []);

    expect(collection.indexes).toHaveLength(2);
    expect(collection.bulkWriteCalls).toBe(2);
    expect(collection.documents.size).toBe(built.uniqueSongs);
    expect(first.upsertedCount).toBe(built.uniqueSongs);
    expect(second.upsertedCount).toBe(0);
    expect(second.modifiedCount).toBe(0);
    expect(empty).toEqual({ matchedCount: 0, modifiedCount: 0, upsertedCount: 0 });
    expect(built.totalRows).toBe(3);
    expect(built.parsedRows + built.skippedRows).toBe(built.totalRows);

    const sample = collection.documents.get("Queencard\u0000(G)I-DLE");
    expect(sample).toBeTruthy();
    expect(sample?.chartsBasic.length).toBe(1);
    expect(sample?.source.sourceFile).toBe("inline-song-list");
    expect(sample?.chartTokens).toEqual([]);
  });
});
