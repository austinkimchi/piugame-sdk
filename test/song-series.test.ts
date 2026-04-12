import { describe, expect, test } from "vitest";

import type { SongCatalogDocument } from "../src/song-catalog";
import {
  applySongSeriesAssignments,
  assignSongSeriesToCatalogDocuments,
  mapSectionIdToSeries,
  parseNamuSeriesReference,
  upsertSongSeriesReferences,
  type SongCatalogSeriesAssignment,
  type SongCatalogSeriesDocument,
  type SongSeriesReferenceDocument,
} from "../src/song-series";

function sampleCatalogDocument(songName: string, artist: string): SongCatalogDocument {
  return {
    songKey: songName,
    songName,
    artist,
    images: [],
    chartsBasic: [],
    chartsFull: [],
    chartTokens: [],
    source: {
      sourceFile: "fixture.php",
      importedAt: "2026-04-20T00:00:00.000Z",
    },
  };
}

class FakeSeriesReferenceCollection {
  public readonly indexes: Array<{ key: Record<string, unknown>; options?: Record<string, unknown> }> = [];
  public readonly docs = new Map<string, SongSeriesReferenceDocument>();

  public async createIndex(
    key: Record<string, unknown>,
    options?: Record<string, unknown>,
  ): Promise<string> {
    this.indexes.push({ key, options });
    return `idx_${this.indexes.length}`;
  }

  public async updateOne(
    filter: Record<string, unknown>,
    update: { $set: SongSeriesReferenceDocument },
    options: { upsert?: boolean },
  ): Promise<{ matchedCount: number; modifiedCount: number; upsertedCount: number }> {
    const key = String(filter.referenceKey);
    const current = this.docs.get(key);
    const next = update.$set;

    if (!current) {
      if (options.upsert) {
        this.docs.set(key, next);
        return { matchedCount: 0, modifiedCount: 0, upsertedCount: 1 };
      }

      return { matchedCount: 0, modifiedCount: 0, upsertedCount: 0 };
    }

    const changed = JSON.stringify(current) !== JSON.stringify(next);
    this.docs.set(key, next);
    return {
      matchedCount: 1,
      modifiedCount: changed ? 1 : 0,
      upsertedCount: 0,
    };
  }

  public find(): { toArray: () => Promise<SongSeriesReferenceDocument[]> } {
    return {
      toArray: async () => Array.from(this.docs.values()),
    };
  }
}

class FakeSongCatalogCollection {
  public readonly docs = new Map<string, SongCatalogSeriesDocument>();

  public async updateOne(
    filter: Record<string, unknown>,
    update: { $set: Partial<SongCatalogSeriesDocument> },
    options: { upsert?: boolean },
  ): Promise<{ matchedCount: number; modifiedCount: number; upsertedCount: number }> {
    const key = `${String(filter.songKey)}\u0000${String(filter.artist)}`;
    const current = this.docs.get(key);
    if (!current) {
      if (options.upsert) {
        this.docs.set(key, update.$set as SongCatalogSeriesDocument);
        return { matchedCount: 0, modifiedCount: 0, upsertedCount: 1 };
      }

      return { matchedCount: 0, modifiedCount: 0, upsertedCount: 0 };
    }

    const next = { ...current, ...update.$set };
    const changed = JSON.stringify(current) !== JSON.stringify(next);
    this.docs.set(key, next);
    return {
      matchedCount: 1,
      modifiedCount: changed ? 1 : 0,
      upsertedCount: 0,
    };
  }
}

describe("song series mapping", () => {
  test("maps deterministic section IDs including PRIME2 token", () => {
    expect(mapSectionIdToSeries("s-3.1")).toBe("1st");
    expect(mapSectionIdToSeries("s-5.7")).toBe("NX");
    expect(mapSectionIdToSeries("s-6.2")).toBe("FIESTA");
    expect(mapSectionIdToSeries("s-7.1")).toBe("PRIME");
    expect(mapSectionIdToSeries("s-7.2")).toBe("PRIME2");
    expect(mapSectionIdToSeries("s-7.3")).toBe("XX");
    expect(mapSectionIdToSeries("s-8.1")).toBe("PHOENIX");
    expect(mapSectionIdToSeries("s-6.4")).toBeNull();
  });
});

describe("namu reference parser", () => {
  test("extracts section mappings, plain-text titles, and note-aware metadata", () => {
    const html = `
      <h3><a id="s-4.2">4.2.</a><span>Pump It Up THE REBIRTH</span></h3>
      <div>
        <table>
          <tbody>
            <tr>
              <td>winter</td>
              <td><a class="CpxtmARH" href="/w/Winter">Winter</a></td>
              <td>BanYa</td>
              <td>classic remake Added Short Cuts in Fiesta</td>
            </tr>
            <tr>
              <td><a class="CpxtmARH" href="/w/SeoulTour">tour of Seoul</a></td>
              <td>An Interesting View</td>
              <td>Oral song remake</td>
            </tr>
          </tbody>
        </table>
      </div>
      <h3><a id="s-7.2">7.2.</a><span>Pump It Up PRIME 2</span></h3>
      <div>
        <table>
          <tbody>
            <tr>
              <td>ported song</td>
              <td><a class="CpxtmARH" href="/w/PortedSong">Ported Song</a></td>
              <td>Composer X</td>
              <td>Ported to PRIME2 in updates</td>
            </tr>
            <tr>
              <td colspan="2"><a class="CpxtmARH" href="/w/BadApple">Bad Apple!! feat. nomico</a></td>
              <td><a class="CpxtmARH" href="/w/Minoshima">Masayoshi Minoshima</a></td>
              <td>note</td>
            </tr>
          </tbody>
        </table>
      </div>
    `;

    const parsed = parseNamuSeriesReference(html, "fixture.html");
    expect(parsed.sections.map((section) => section.sectionId)).toEqual(["s-4.2", "s-7.2"]);

    const winter = parsed.entries.find((entry) => entry.songName === "Winter");
    expect(winter?.sectionSeries).toBe("1st");
    expect(winter?.shortCutSeriesOverride).toBe("FIESTA");
    expect(winter?.artistHint).toBe("BanYa");

    const interestingView = parsed.entries.find((entry) => entry.songName === "An Interesting View");
    expect(interestingView?.sectionSeries).toBe("1st");

    const ported = parsed.entries.find((entry) => entry.songName === "Ported Song");
    expect(ported?.sectionSeries).toBe("PRIME2");
    expect(ported?.hasPortedKeyword).toBe(true);
    expect(ported?.portedSeriesOverride).toBe("PRIME2");

    expect(parsed.entries.some((entry) => entry.songName === "Bad Apple!! feat. nomico")).toBe(true);
    expect(parsed.entries.some((entry) => entry.songName === "Masayoshi Minoshima")).toBe(false);
  });
});

describe("song series assignment", () => {
  test("splits short-cut variant series from base song when note specifies Fiesta", () => {
    const references = parseNamuSeriesReference(
      `
      <h3><a id="s-4.2">4.2.</a><span>Rebirth</span></h3>
      <div>
        <table>
          <tbody>
            <tr>
              <td>full moon</td>
              <td><a class="CpxtmARH" href="/w/FullMoon">Full Moon</a></td>
              <td>Dreamcatcher</td>
              <td>Added Short Cuts in Fiesta</td>
            </tr>
          </tbody>
        </table>
      </div>
      `,
      "fixture.html",
    ).entries;

    const catalog = [
      sampleCatalogDocument("Full Moon", "Dreamcatcher"),
      sampleCatalogDocument("Full Moon - SHORT CUT -", "Dreamcatcher"),
    ];

    const result = assignSongSeriesToCatalogDocuments(catalog, references, [], "2026-04-20T00:00:00.000Z");
    expect(result.unresolved).toHaveLength(0);

    const base = result.assigned.find((item) => item.songName === "Full Moon");
    const shortCut = result.assigned.find((item) => item.songName.includes("SHORT CUT"));

    expect(base?.series).toBe("1st");
    expect(base?.seriesRule).toBe("section_mapping");
    expect(shortCut?.series).toBe("FIESTA");
    expect(shortCut?.seriesRule).toBe("note_short_cut_override");
  });

  test("uses manual overrides before auto rules", () => {
    const references = parseNamuSeriesReference(
      `
      <h3><a id="s-7.1">7.1.</a><span>Prime</span></h3>
      <div>
        <table><tbody><tr><td><a class="CpxtmARH">Song A</a></td><td>Artist A</td></tr></tbody></table>
      </div>
      `,
      "fixture.html",
    ).entries;

    const catalog = [sampleCatalogDocument("Song A", "Artist A")];
    const result = assignSongSeriesToCatalogDocuments(
      catalog,
      references,
      [{ songKey: "Song A", artist: "Artist A", series: "XX" }],
      "2026-04-20T00:00:00.000Z",
    );

    expect(result.assigned).toHaveLength(1);
    expect(result.assigned[0].series).toBe("XX");
    expect(result.assigned[0].seriesRule).toBe("manual_override");
    expect(result.summary.manualOverrideCount).toBe(1);
  });

  test("matches parenthetical catalog variants against reference base titles", () => {
    const references = parseNamuSeriesReference(
      `
      <h3><a id="s-7.3">7.3.</a><span>XX</span></h3>
      <div>
        <table><tbody><tr><td><a class="CpxtmARH">%X</a></td><td>Pory</td></tr></tbody></table>
      </div>
      `,
      "fixture.html",
    ).entries;

    const catalog = [sampleCatalogDocument("%X (Percent X)", "Pory")];
    const result = assignSongSeriesToCatalogDocuments(catalog, references, [], "2026-04-20T00:00:00.000Z");

    expect(result.unresolved).toHaveLength(0);
    expect(result.assigned).toHaveLength(1);
    expect(result.assigned[0].series).toBe("XX");
  });

  test("leaves unresolved when references are ambiguous or have ported notes without target series", () => {
    const references = parseNamuSeriesReference(
      `
      <h3><a id="s-4.2">4.2.</a><span>Rebirth</span></h3>
      <div>
        <table><tbody><tr><td><a class="CpxtmARH">Ambiguous Song</a></td><td>Artist X</td></tr></tbody></table>
      </div>
      <h3><a id="s-7.2">7.2.</a><span>Prime 2</span></h3>
      <div>
        <table><tbody><tr><td><a class="CpxtmARH">Ambiguous Song</a></td><td>Artist X</td></tr></tbody></table>
      </div>
      <h3><a id="s-4.1">4.1.</a><span>The Collection</span></h3>
      <div>
        <table><tbody><tr><td><a class="CpxtmARH">Ported Unknown</a></td><td>Artist Y</td><td>ported from old version</td></tr></tbody></table>
      </div>
      `,
      "fixture.html",
    ).entries;

    const catalog = [
      sampleCatalogDocument("Ambiguous Song", "Artist X"),
      sampleCatalogDocument("Ported Unknown", "Artist Y"),
    ];

    const result = assignSongSeriesToCatalogDocuments(catalog, references, [], "2026-04-20T00:00:00.000Z");
    expect(result.assigned).toHaveLength(0);

    const ambiguous = result.unresolved.find((item) => item.songName === "Ambiguous Song");
    const ported = result.unresolved.find((item) => item.songName === "Ported Unknown");

    expect(ambiguous?.reason).toBe("ambiguous_reference");
    expect(ported?.reason).toBe("ported_note_without_series");
  });
});

describe("song series persistence helpers", () => {
  test("upserts references idempotently and applies assignments without duplicate changes", async () => {
    const referenceCollection = new FakeSeriesReferenceCollection();
    const catalogCollection = new FakeSongCatalogCollection();

    const references = parseNamuSeriesReference(
      `
      <h3><a id="s-7.3">7.3.</a><span>XX</span></h3>
      <div>
        <table><tbody><tr><td><a class="CpxtmARH">Song XX</a></td><td>Artist XX</td></tr></tbody></table>
      </div>
      `,
      "fixture.html",
    ).entries;

    const firstUpsert = await upsertSongSeriesReferences(referenceCollection as unknown as any, references);
    const secondUpsert = await upsertSongSeriesReferences(referenceCollection as unknown as any, references);

    expect(firstUpsert.upsertedCount).toBe(1);
    expect(secondUpsert.upsertedCount).toBe(0);
    expect(secondUpsert.modifiedCount).toBe(0);

    const songKey = "Song XX";
    const artist = "Artist XX";
    catalogCollection.docs.set(`${songKey}\u0000${artist}`, {
      ...sampleCatalogDocument(songKey, artist),
    });

    const assignments: SongCatalogSeriesAssignment[] = [
      {
        songKey,
        songName: songKey,
        artist,
        series: "XX",
        seriesSource: "fixture.html:s-7.3",
        seriesRule: "section_mapping",
        seriesConfidence: 0.95,
        seriesAssignedAt: "2026-04-20T00:00:00.000Z",
      },
    ];

    const firstApply = await applySongSeriesAssignments(catalogCollection as unknown as any, assignments);
    const secondApply = await applySongSeriesAssignments(catalogCollection as unknown as any, assignments);

    expect(firstApply.modifiedCount).toBe(1);
    expect(secondApply.modifiedCount).toBe(0);
  });
});
