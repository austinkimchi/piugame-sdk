import { load } from "cheerio";
import type { Collection, Document } from "mongodb";

export type SongChartScope = "basic" | "full";

export interface ParsedSongChartRow {
  songName: string;
  artist: string;
  imageFilename: string | null;
  scope: SongChartScope;
  mode: string;
  level: string;
}

export interface SongCatalogChart {
  mode: string;
  level: string;
  token: string;
}

export interface SongCatalogSource {
  sourceFile: string;
  importedAt: string;
}

export interface SongCatalogDocument {
  songKey: string;
  songName: string;
  artist: string;
  piuVersion?: string;
  images: string[];
  chartsBasic: SongCatalogChart[];
  chartsFull: SongCatalogChart[];
  chartTokens: string[];
  source: SongCatalogSource;
}

export interface SongCatalogParseResult {
  rows: ParsedSongChartRow[];
  skippedRows: number;
  totalRows: number;
  skippedDetails: SongCatalogSkippedDetail[];
}

export interface SongCatalogBuildResult {
  documents: SongCatalogDocument[];
  skippedRows: number;
  parsedRows: number;
  totalRows: number;
  skippedDetails: SongCatalogSkippedDetail[];
  uniqueSongs: number;
  uniqueCharts: number;
}

export interface SongCatalogUpsertResult {
  matchedCount: number;
  modifiedCount: number;
  upsertedCount: number;
}

export interface SongCatalogSkippedDetail {
  rowIndex: number;
  songName: string | null;
  artist: string | null;
  scope: SongChartScope | null;
  mode: string | null;
  levelImageSources: string[];
  reasons: string[];
}

function nowIso(): string {
  return new Date().toISOString();
}

function cleanText(value: string | undefined | null): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function decodeQuotedStyleHtml(styleValue: string | undefined): string | null {
  if (!styleValue) {
    return null;
  }

  return styleValue.replace(/&quot;/g, "\"").replace(/&#39;/g, "'");
}

function extractBackgroundImageUrl(styleValue: string | undefined): string | null {
  const normalizedStyle = decodeQuotedStyleHtml(styleValue);
  if (!normalizedStyle) {
    return null;
  }

  const match = /url\((['"]?)([^'")]+)\1\)/i.exec(normalizedStyle);
  return match?.[2] ?? null;
}

function extractSongImageFilename(imageUrl: string | null): string | null {
  if (!imageUrl) {
    return null;
  }

  try {
    const parsed = new URL(imageUrl);
    const match = /\/data\/song_img2?\/([^/]+\.png)(?:[?#].*)?$/i.exec(parsed.pathname + parsed.search);
    if (!match) {
      return null;
    }

    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}

function extractScopeFromStepBallStyle(styleValue: string | undefined): SongChartScope | null {
  const normalizedStyle = decodeQuotedStyleHtml(styleValue);
  if (!normalizedStyle) {
    return null;
  }

  const match = /\/l_img\/(?:p2\/)?stepball\/(basic|full)\/[a-z0-9_]+_bg\.png/i.exec(normalizedStyle);
  if (!match) {
    return null;
  }

  return match[1].toLowerCase() as SongChartScope;
}

function extractModeCode(src: string | undefined): string | null {
  if (!src) {
    return null;
  }

  const match = /(?:^|\/)([a-z0-9_]+)_text\.png(?:[?#].*)?$/i.exec(src);
  if (!match) {
    return null;
  }

  return match[1].toUpperCase();
}

function extractLevelToken(levelImageSources: Array<string | undefined>): string | null {
  const pieces: string[] = [];

  for (const src of levelImageSources) {
    if (!src) {
      continue;
    }

    const match = /(?:_num_([^/.?#]+)|_guess)\.png(?:[?#].*)?$/i.exec(src);
    if (match) {
      const piece = match[1] ?? "?";
      pieces.push(/^\d+$/.test(piece) ? piece : "?");
    }
  }

  if (pieces.length === 0) {
    return null;
  }

  return normalizeChartLevel(pieces.join(""));
}

function normalizeChartLevel(level: string): string {
  if (!/^\d+$/.test(level)) {
    return level;
  }
  return `${Number.parseInt(level, 10)}`;
}

function chartToken(mode: string, level: string): string {
  const normalizedLevel = normalizeChartLevel(level);
  if (mode === "C") {
    return `Cx${normalizedLevel}`;
  }

  return `${mode}${normalizedLevel}`;
}

function levelSortValue(level: string): number {
  const parsed = Number.parseInt(level, 10);
  return Number.isFinite(parsed) ? parsed : Number.MAX_SAFE_INTEGER;
}

function normalizeSongKey(songName: string): string {
  return cleanText(songName);
}

function fullModeOrder(mode: string): number {
  if (mode === "S") {
    return 0;
  }

  if (mode === "D") {
    return 1;
  }

  if (mode === "C") {
    return 2;
  }

  return 9;
}

function compareFullCharts(left: SongCatalogChart, right: SongCatalogChart): number {
  const byMode = fullModeOrder(left.mode) - fullModeOrder(right.mode);
  if (byMode !== 0) {
    return byMode;
  }

  const byLevel = levelSortValue(left.level) - levelSortValue(right.level);
  if (byLevel !== 0) {
    return byLevel;
  }

  return left.level.localeCompare(right.level) || left.mode.localeCompare(right.mode);
}

function compareBasicCharts(left: SongCatalogChart, right: SongCatalogChart): number {
  const byLevel = levelSortValue(left.level) - levelSortValue(right.level);
  if (byLevel !== 0) {
    return byLevel;
  }

  return left.level.localeCompare(right.level) || left.mode.localeCompare(right.mode);
}

export function parseSongCatalogRows(html: string): SongCatalogParseResult {
  const $ = load(html);
  const listItems = $(".top_songs_list > li");

  const rows: ParsedSongChartRow[] = [];
  let skippedRows = 0;
  const skippedDetails: SongCatalogSkippedDetail[] = [];
  const totalRows = listItems.length;

  listItems.each((index, element) => {
    const root = $(element);

    const songName = cleanText(root.find(".profile_name .t1").first().text());
    const artist = cleanText(root.find(".profile_name .t2").first().text());
    const imageUrl = extractBackgroundImageUrl(root.find(".profile_img .re").first().attr("style"));
    const imageFilename = extractSongImageFilename(imageUrl);

    const stepBall = root.find(".stepBall_in").first();
    const scope = extractScopeFromStepBallStyle(stepBall.attr("style"));
    const mode = extractModeCode(stepBall.find(".tw img").first().attr("src"));
    const levelImageSources = stepBall
      .find(".numw img")
      .toArray()
      .map((item) => $(item).attr("src"));
    const level = extractLevelToken(levelImageSources);

    if (!songName || !artist || !scope || !mode || level === null) {
      skippedRows += 1;
      const reasons: string[] = [];

      if (!songName) {
        reasons.push("missingSongName");
      }

      if (!artist) {
        reasons.push("missingArtist");
      }

      if (!scope) {
        reasons.push("missingScope");
      }

      if (!mode) {
        reasons.push("missingMode");
      }

      if (level === null) {
        reasons.push("missingLevel");
      }

      skippedDetails.push({
        rowIndex: index + 1,
        songName: songName || null,
        artist: artist || null,
        scope,
        mode,
        levelImageSources: levelImageSources.filter((value): value is string => Boolean(value)),
        reasons,
      });
      return;
    }

    rows.push({
      songName,
      artist,
      imageFilename,
      scope,
      mode,
      level,
    });
  });

  return { rows, skippedRows, totalRows, skippedDetails };
}

export function buildSongCatalogDocuments(
  rows: ParsedSongChartRow[],
  sourceFile: string,
  importedAt = nowIso(),
): SongCatalogDocument[] {
  interface MutableSongCatalogAggregate {
    songKey: string;
    songName: string;
    artist: string;
    images: Set<string>;
    chartsBasic: Map<string, SongCatalogChart>;
    chartsFull: Map<string, SongCatalogChart>;
    source: SongCatalogSource;
  }

  const aggregates = new Map<string, MutableSongCatalogAggregate>();

  for (const row of rows) {
    const songKey = normalizeSongKey(row.songName);
    const artist = cleanText(row.artist);
    const aggregateKey = `${songKey}\u0000${artist}`;

    const aggregate =
      aggregates.get(aggregateKey) ??
      {
        songKey,
        songName: row.songName,
        artist,
        images: new Set<string>(),
        chartsBasic: new Map<string, SongCatalogChart>(),
        chartsFull: new Map<string, SongCatalogChart>(),
        source: {
          sourceFile,
          importedAt,
        },
      };

    if (row.imageFilename) {
      aggregate.images.add(row.imageFilename);
    }

    const chart: SongCatalogChart = {
      mode: row.mode,
      level: row.level,
      token: chartToken(row.mode, row.level),
    };

    const chartKey = `${row.scope}|${row.mode}|${row.level}`;
    if (row.scope === "basic") {
      aggregate.chartsBasic.set(chartKey, chart);
    } else {
      aggregate.chartsFull.set(chartKey, chart);
    }

    aggregates.set(aggregateKey, aggregate);
  }

  const documents: SongCatalogDocument[] = [];

  for (const aggregate of aggregates.values()) {
    const chartsBasic = Array.from(aggregate.chartsBasic.values()).sort(compareBasicCharts);
    const chartsFull = Array.from(aggregate.chartsFull.values()).sort(compareFullCharts);
    const chartTokens = Array.from(new Set(chartsFull.map((chart) => chart.token)));

    documents.push({
      songKey: aggregate.songKey,
      songName: aggregate.songName,
      artist: aggregate.artist,
      images: Array.from(aggregate.images).sort((left, right) => left.localeCompare(right)),
      chartsBasic,
      chartsFull,
      chartTokens,
      source: aggregate.source,
    });
  }

  documents.sort((left, right) => {
    const bySong = left.songName.localeCompare(right.songName);
    if (bySong !== 0) {
      return bySong;
    }

    return left.artist.localeCompare(right.artist);
  });

  return documents;
}

export function buildSongCatalogFromHtml(
  html: string,
  sourceFile: string,
  importedAt = nowIso(),
): SongCatalogBuildResult {
  const parsed = parseSongCatalogRows(html);
  const documents = buildSongCatalogDocuments(parsed.rows, sourceFile, importedAt);
  const uniqueCharts = documents.reduce(
    (sum, document) => sum + document.chartsBasic.length + document.chartsFull.length,
    0,
  );

  return {
    documents,
    skippedRows: parsed.skippedRows,
    parsedRows: parsed.rows.length,
    totalRows: parsed.totalRows,
    skippedDetails: parsed.skippedDetails,
    uniqueSongs: documents.length,
    uniqueCharts,
  };
}

export async function ensureSongCatalogIndexes(
  collection: Collection<SongCatalogDocument & Document>,
): Promise<void> {
  await collection.createIndex({ songKey: 1, artist: 1 }, { unique: true });
  await collection.createIndex({ "chartsFull.mode": 1, "chartsFull.level": 1 });
}

export async function upsertSongCatalogDocuments(
  collection: Collection<SongCatalogDocument & Document>,
  documents: SongCatalogDocument[],
): Promise<SongCatalogUpsertResult> {
  if (documents.length === 0) {
    return { matchedCount: 0, modifiedCount: 0, upsertedCount: 0 };
  }

  const result = await collection.bulkWrite(
    documents.map((document) => ({
      updateOne: {
        filter: { songKey: document.songKey, artist: document.artist },
        update: { $set: document },
        upsert: true,
      },
    })),
    { ordered: false },
  );

  return {
    matchedCount: result.matchedCount ?? 0,
    modifiedCount: result.modifiedCount ?? 0,
    upsertedCount: result.upsertedCount ?? 0,
  };
}
