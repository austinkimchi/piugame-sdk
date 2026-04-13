import { load, type Cheerio, type CheerioAPI } from "cheerio";
import type { Collection, Document, UpdateResult } from "mongodb";

import type { SongCatalogDocument } from "./song-catalog";

export type SongSeries = "1st" | "NX" | "FIESTA" | "PRIME" | "PRIME2" | "XX" | "PHOENIX";

export interface SongSeriesSection {
  sectionId: string;
  sectionTitle: string;
  sectionSeries: SongSeries | null;
}

export interface SongSeriesReferenceEntry {
  sourceFile: string;
  sectionId: string;
  sectionTitle: string;
  sectionSeries: SongSeries | null;
  songName: string;
  normalizedSongName: string;
  looseSongName: string;
  artistHint: string | null;
  normalizedArtistHint: string | null;
  noteText: string;
  shortCutSeriesOverride: SongSeries | null;
  portedSeriesOverride: SongSeries | null;
  hasPortedKeyword: boolean;
}

export interface SongSeriesReferenceParseResult {
  sections: SongSeriesSection[];
  entries: SongSeriesReferenceEntry[];
}

export interface SongSeriesReferenceBundle {
  entries: SongSeriesReferenceEntry[];
  aliasTokens: string[];
}

export interface SongCatalogSeriesOverride {
  songKey: string;
  artist: string;
  series: SongSeries;
  reason?: string | null;
  updatedAt?: string | null;
}

export interface SongCatalogSeriesAssignment {
  songKey: string;
  songName: string;
  artist: string;
  series: SongSeries;
  seriesSource: string;
  seriesRule: string;
  seriesConfidence: number;
  seriesAssignedAt: string;
}

export type SongSeriesUnresolvedReason =
  | "no_reference_match"
  | "ambiguous_reference"
  | "section_unmapped"
  | "ported_note_without_series";

export interface SongCatalogSeriesUnresolved {
  songKey: string;
  songName: string;
  artist: string;
  reason: SongSeriesUnresolvedReason;
  details: string;
}

export interface SongCatalogSeriesAssignmentSummary {
  totalCatalogSongs: number;
  assignedCount: number;
  unresolvedCount: number;
  manualOverrideCount: number;
}

export interface SongCatalogSeriesAssignmentResult {
  assigned: SongCatalogSeriesAssignment[];
  unresolved: SongCatalogSeriesUnresolved[];
  summary: SongCatalogSeriesAssignmentSummary;
}

export interface SongSeriesReferenceDocument extends SongSeriesReferenceEntry {
  referenceKey: string;
  updatedAt: string;
}

export interface SongCatalogSeriesWritableFields {
  series: SongSeries;
  seriesSource: string;
  seriesRule: string;
  seriesConfidence: number;
  seriesAssignedAt: string;
}

export interface SongCatalogSeriesDocument extends SongCatalogDocument, Partial<SongCatalogSeriesWritableFields> {}

export interface SongSeriesUpsertResult {
  matchedCount: number;
  modifiedCount: number;
  upsertedCount: number;
}

const SHORT_CUT_VARIANT_PATTERN = /-\s*SHORT\s*CUT\s*-/i;
const FULL_SONG_VARIANT_PATTERN = /-\s*FULL\s*SONG\s*-/i;
const PORTED_PATTERN = /\bported?\b/i;
const SHORT_CUT_FIESTA_PATTERN = /short\s*cuts?.*fiesta|fiesta.*short\s*cuts?/i;
const SONG_NOTE_TEXT_PATTERN =
  /\b(added|removed|short\s*cut|ported?\s+(?:to|from)|mission|gauntlet|category|template)\b/i;

function cleanText(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function normalizeName(value: string): string {
  return cleanText(value).normalize("NFKC").toLowerCase();
}

function normalizeLooseName(value: string): string {
  return normalizeName(value).replace(/[^\p{L}\p{N}]+/gu, "");
}

function normalizeCompact(value: string): string {
  return normalizeName(value).replace(/[^\p{L}\p{N}]+/gu, "");
}

function stripParentheticalSegments(value: string): string {
  return cleanText(value.replace(/\s*\([^)]*\)\s*/g, " "));
}

function stripFullSongVariant(songName: string): string {
  return cleanText(songName.replace(FULL_SONG_VARIANT_PATTERN, ""));
}

function collapseSpacedDigits(songName: string): string {
  return cleanText(songName.replace(/(\d)\s+(?=\d)/g, "$1"));
}

function generateNameVariants(songName: string): string[] {
  const queue = [cleanText(songName)];
  const seen = new Set<string>();

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || seen.has(current)) {
      continue;
    }
    seen.add(current);

    const variants = [
      stripParentheticalSegments(current),
      stripShortCutVariant(current),
      stripFullSongVariant(current),
      collapseSpacedDigits(current),
    ];

    for (const variant of variants) {
      if (variant && !seen.has(variant)) {
        queue.push(variant);
      }
    }
  }

  return Array.from(seen.values());
}

function generateNormalizedNameVariants(songName: string): string[] {
  return Array.from(new Set(generateNameVariants(songName).map((value) => normalizeName(value)).filter(Boolean)));
}

function generateLooseNameVariants(songName: string): string[] {
  return Array.from(new Set(generateNameVariants(songName).map((value) => normalizeLooseName(value)).filter(Boolean)));
}

function normalizeArtistForCompare(value: string): string {
  const normalized = normalizeName(value);
  const withoutSuffix = normalized
    .replace(/\b(production|records|recordings|sound\s*team|music|studio)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (withoutSuffix === "banya-p" || withoutSuffix === "banya p") {
    return "banya";
  }

  return withoutSuffix || normalized;
}

function generateArtistVariants(artist: string | null): string[] {
  if (!artist) {
    return [];
  }

  const normalized = normalizeArtistForCompare(artist);
  const compact = normalizeCompact(normalized);
  const normalizedOriginal = normalizeName(artist);
  const compactOriginal = normalizeCompact(artist);

  return Array.from(new Set([normalized, compact, normalizedOriginal, compactOriginal].filter(Boolean)));
}

function nowIso(): string {
  return new Date().toISOString();
}

function buildSectionSeriesMap(): Map<string, SongSeries> {
  const map = new Map<string, SongSeries>();

  const firstSections = [
    "s-3.1",
    "s-3.2",
    "s-3.3",
    "s-3.4",
    "s-3.5",
    "s-3.6",
    "s-4.1",
    "s-4.2",
    "s-4.3",
    "s-4.4",
    "s-5.1",
    "s-5.2",
    "s-5.3",
  ];

  for (const sectionId of firstSections) {
    map.set(sectionId, "1st");
  }

  map.set("s-5.4", "NX");
  map.set("s-5.5", "NX");
  map.set("s-5.6", "NX");
  map.set("s-5.7", "NX");

  map.set("s-6.2", "FIESTA");
  map.set("s-6.3", "FIESTA");
  map.set("s-6.5", "FIESTA");

  map.set("s-7.1", "PRIME");
  map.set("s-7.2", "PRIME2");
  map.set("s-7.3", "XX");

  map.set("s-8.1", "PHOENIX");

  return map;
}

const SECTION_SERIES_MAP = buildSectionSeriesMap();

export function mapSectionIdToSeries(sectionId: string): SongSeries | null {
  return SECTION_SERIES_MAP.get(sectionId) ?? null;
}

function parseSeriesTokenFromText(text: string): SongSeries | null {
  const normalized = normalizeName(text);

  if (/\bphoenix\b/.test(normalized)) {
    return "PHOENIX";
  }

  if (/\bprime\s*2\b|\bprime2\b/.test(normalized)) {
    return "PRIME2";
  }

  if (/\bprime\b/.test(normalized)) {
    return "PRIME";
  }

  if (/\bfiesta\b/.test(normalized)) {
    return "FIESTA";
  }

  if (/\bnx\b/.test(normalized)) {
    return "NX";
  }

  if (/\bxx\b/.test(normalized)) {
    return "XX";
  }

  if (/\b1st\b|\bfirst\b/.test(normalized)) {
    return "1st";
  }

  return null;
}

interface ExpandedCell {
  text: string;
  links: string[];
}

interface ExpandedRow {
  columns: ExpandedCell[];
  rowText: string;
}

interface RowSpanState {
  remaining: number;
  cell: ExpandedCell;
}

function parseCell($: CheerioAPI, element: any): ExpandedCell {
  const $root = $(element);
  const links = Array.from(
    new Set(
      $root
        .find("a.CpxtmARH")
        .toArray()
        .map((anchor) => cleanText($(anchor).text()))
        .filter((value) => value.length > 0),
    ),
  );

  return {
    text: cleanText($root.text()),
    links,
  };
}

function consumeRowSpanColumn(
  carry: Map<number, RowSpanState>,
  columnIndex: number,
): ExpandedCell | null {
  const slot = carry.get(columnIndex);
  if (!slot) {
    return null;
  }

  slot.remaining -= 1;
  if (slot.remaining <= 0) {
    carry.delete(columnIndex);
  } else {
    carry.set(columnIndex, slot);
  }

  return slot.cell;
}

function expandTableRows($: CheerioAPI, tableElement: any): ExpandedRow[] {
  const $table = $(tableElement);
  const rows: ExpandedRow[] = [];
  const carry = new Map<number, RowSpanState>();

  $table.find("tr").each((_, rowElement) => {
    const row = $(rowElement);
    const columns: ExpandedCell[] = [];
    let cursor = 0;

    while (carry.has(cursor)) {
      const carried = consumeRowSpanColumn(carry, cursor);
      if (carried) {
        columns[cursor] = carried;
      }
      cursor += 1;
    }

    row.children("th,td").each((_, cellElement) => {
      while (carry.has(cursor)) {
        const carried = consumeRowSpanColumn(carry, cursor);
        if (carried) {
          columns[cursor] = carried;
        }
        cursor += 1;
      }

      const cell = parseCell($, cellElement);
      const $cell = $(cellElement);
      const colspanRaw = Number.parseInt($cell.attr("colspan") ?? "1", 10);
      const rowspanRaw = Number.parseInt($cell.attr("rowspan") ?? "1", 10);
      const colspan = Number.isFinite(colspanRaw) && colspanRaw > 0 ? colspanRaw : 1;
      const rowspan = Number.isFinite(rowspanRaw) && rowspanRaw > 0 ? rowspanRaw : 1;

      for (let offset = 0; offset < colspan; offset += 1) {
        columns[cursor + offset] = cell;
        if (rowspan > 1) {
          carry.set(cursor + offset, { remaining: rowspan - 1, cell });
        }
      }

      cursor += colspan;
    });

    while (carry.has(cursor)) {
      const carried = consumeRowSpanColumn(carry, cursor);
      if (carried) {
        columns[cursor] = carried;
      }
      cursor += 1;
    }

    const compactColumns = columns.filter((column): column is ExpandedCell => Boolean(column));
    const rowText = cleanText(compactColumns.map((column) => column.text).join(" "));

    rows.push({
      columns: compactColumns,
      rowText,
    });
  });

  return rows;
}

function looksLikeArtist(text: string): boolean {
  if (!text) {
    return false;
  }

  const normalized = normalizeName(text);
  if (normalized.length > 80) {
    return false;
  }

  if (/\b(added|removed|short cut|shortcuts|notes?|ported?|mission|template)\b/.test(normalized)) {
    return false;
  }

  if (/^\d+$/.test(normalized)) {
    return false;
  }

  return true;
}

function looksLikeSongNote(text: string): boolean {
  const normalized = normalizeName(text);
  if (!normalized) {
    return true;
  }

  if (normalized.length > 160) {
    return true;
  }

  return SONG_NOTE_TEXT_PATTERN.test(normalized);
}

function determineArtistColumnIndex(columns: ExpandedCell[]): number | null {
  if (columns.length >= 3) {
    for (let index = 2; index < columns.length; index += 1) {
      const columnText = cleanText(columns[index].text);
      if (looksLikeArtist(columnText)) {
        return index;
      }
    }
  }

  if (columns.length === 2 && looksLikeArtist(cleanText(columns[1].text))) {
    return 1;
  }

  return null;
}

function artistHintFromColumn(column: ExpandedCell | null): string | null {
  if (!column) {
    return null;
  }

  const fromLinks = column.links.find((value) => looksLikeArtist(value));
  if (fromLinks) {
    return cleanText(fromLinks);
  }

  const fromText = cleanText(column.text);
  return looksLikeArtist(fromText) ? fromText : null;
}

function songNameCandidatesFromColumn(column: ExpandedCell): string[] {
  const candidates = new Set<string>();

  const push = (value: string): void => {
    const cleaned = cleanText(value);
    if (!cleaned || looksLikeSongNote(cleaned)) {
      return;
    }

    candidates.add(cleaned);
  };

  for (const link of column.links) {
    push(link);
  }

  const text = cleanText(column.text);
  if (text) {
    push(text);

    for (const part of text.split("/")) {
      push(part);
    }
  }

  return Array.from(candidates.values());
}

function collectSongNameCandidates(columns: ExpandedCell[], artistIndex: number | null, artistHint: string | null): string[] {
  if (columns.length === 0) {
    return [];
  }

  const upperBound = artistIndex !== null ? Math.max(0, artistIndex - 1) : Math.min(1, columns.length - 1);
  const candidates = new Set<string>();

  for (let index = 0; index <= upperBound; index += 1) {
    for (const candidate of songNameCandidatesFromColumn(columns[index])) {
      candidates.add(candidate);
    }
  }

  const normalizedArtistVariants = new Set(generateArtistVariants(artistHint));

  return Array.from(candidates.values()).filter((candidate) => {
    const normalizedCandidate = normalizeName(candidate);
    const compactCandidate = normalizeCompact(candidate);
    if (!normalizedCandidate) {
      return false;
    }

    if (normalizedArtistVariants.has(normalizedCandidate) || normalizedArtistVariants.has(compactCandidate)) {
      return false;
    }

    return true;
  });
}

function buildReferenceKey(reference: SongSeriesReferenceEntry): string {
  return [
    reference.sourceFile,
    reference.sectionId,
    reference.normalizedSongName,
    reference.normalizedArtistHint ?? "",
  ].join("\u0000");
}

function parseSeriesSections(html: string): SongSeriesSection[] {
  const $ = load(html);
  const sections: SongSeriesSection[] = [];

  $("h2 > a[id^='s-'], h3 > a[id^='s-']").each((_, anchor) => {
    const $anchor = $(anchor);
    const sectionId = cleanText($anchor.attr("id"));
    if (!/^s-\d+\.\d+$/.test(sectionId)) {
      return;
    }

    const heading = $anchor.closest("h2,h3");
    const spanText = cleanText(heading.find("span").first().text());
    const headingText = cleanText(heading.text());
    const sectionTitle = spanText || headingText.replace(/^\d+(?:\.\d+)?\.\s*/, "");

    sections.push({
      sectionId,
      sectionTitle,
      sectionSeries: mapSectionIdToSeries(sectionId),
    });
  });

  return sections;
}

function parseEntriesForSection(
  $: CheerioAPI,
  section: SongSeriesSection,
  $content: Cheerio<any>,
  sourceFile: string,
): SongSeriesReferenceEntry[] {
  const entries: SongSeriesReferenceEntry[] = [];

  $content.find("table").each((_, tableElement) => {
    const expandedRows = expandTableRows($, tableElement);

    for (const row of expandedRows) {
      const artistIndex = determineArtistColumnIndex(row.columns);
      const artistHint = artistHintFromColumn(artistIndex !== null ? row.columns[artistIndex] : null);
      const songNames = collectSongNameCandidates(row.columns, artistIndex, artistHint);
      if (songNames.length === 0) {
        continue;
      }

      const noteText = row.rowText;
      const hasPortedKeyword = PORTED_PATTERN.test(noteText);
      const shortCutSeriesOverride = SHORT_CUT_FIESTA_PATTERN.test(noteText) ? "FIESTA" : null;
      const portedSeriesOverride = hasPortedKeyword ? parseSeriesTokenFromText(noteText) : null;

      for (const songName of songNames) {
        const normalizedSongName = normalizeName(songName);
        if (!normalizedSongName) {
          continue;
        }

        entries.push({
          sourceFile,
          sectionId: section.sectionId,
          sectionTitle: section.sectionTitle,
          sectionSeries: section.sectionSeries,
          songName,
          normalizedSongName,
          looseSongName: normalizeLooseName(songName),
          artistHint,
          normalizedArtistHint: artistHint ? normalizeName(artistHint) : null,
          noteText,
          shortCutSeriesOverride,
          portedSeriesOverride,
          hasPortedKeyword,
        });
      }
    }
  });

  return entries;
}

export function parseNamuSeriesReference(html: string, sourceFile: string): SongSeriesReferenceParseResult {
  const $ = load(html);
  const sections = parseSeriesSections(html);
  const entries: SongSeriesReferenceEntry[] = [];

  $("h2 > a[id^='s-'], h3 > a[id^='s-']").each((_, anchor) => {
    const $anchor = $(anchor);
    const sectionId = cleanText($anchor.attr("id"));
    if (!/^s-\d+\.\d+$/.test(sectionId)) {
      return;
    }

    const section = sections.find((candidate) => candidate.sectionId === sectionId);
    if (!section) {
      return;
    }

    const heading = $anchor.closest("h2,h3");
    const content = heading.next();
    if (!content.length || !content.is("div")) {
      return;
    }

    entries.push(...parseEntriesForSection($, section, content, sourceFile));
  });

  return { sections, entries };
}

function collectAliasTokens(entries: SongSeriesReferenceEntry[]): string[] {
  return Array.from(new Set(entries.map((entry) => entry.normalizedSongName))).sort((left, right) =>
    left.localeCompare(right),
  );
}

function extractAliasTokensFromHtml(html: string): string[] {
  const $ = load(html);
  const tokens = new Set<string>();

  $("a.CpxtmARH").each((_, anchor) => {
    const text = cleanText($(anchor).text());
    if (!text || text.length > 120) {
      return;
    }

    const normalized = normalizeName(text);
    if (!normalized || normalized.startsWith("pump it up ")) {
      return;
    }

    tokens.add(normalized);
  });

  return Array.from(tokens).sort((left, right) => left.localeCompare(right));
}

export function buildSeriesReferenceBundle(
  primaryHtml: string,
  secondaryHtml: string,
  primarySourceFile: string,
  secondarySourceFile: string,
): SongSeriesReferenceBundle {
  const primary = parseNamuSeriesReference(primaryHtml, primarySourceFile);
  const secondary = parseNamuSeriesReference(secondaryHtml, secondarySourceFile);

  const dedupedByKey = new Map<string, SongSeriesReferenceEntry>();
  for (const entry of [...primary.entries, ...secondary.entries]) {
    const key = buildReferenceKey(entry);
    dedupedByKey.set(key, entry);
  }

  const entries = Array.from(dedupedByKey.values());
  const aliasTokens = Array.from(
    new Set([...collectAliasTokens(entries), ...extractAliasTokensFromHtml(secondaryHtml)]),
  ).sort((left, right) => left.localeCompare(right));

  return { entries, aliasTokens };
}

function isShortCutVariant(songName: string): boolean {
  return SHORT_CUT_VARIANT_PATTERN.test(songName);
}

function stripShortCutVariant(songName: string): string {
  return cleanText(songName.replace(SHORT_CUT_VARIANT_PATTERN, ""));
}

function overrideLookupKey(songKey: string, artist: string): string {
  return `${songKey}\u0000${normalizeName(artist)}`;
}

function buildReferenceIndexes(references: SongSeriesReferenceEntry[]): {
  bySongArtist: Map<string, SongSeriesReferenceEntry[]>;
  bySongName: Map<string, SongSeriesReferenceEntry[]>;
  bySongLoose: Map<string, SongSeriesReferenceEntry[]>;
} {
  const bySongArtist = new Map<string, SongSeriesReferenceEntry[]>();
  const bySongName = new Map<string, SongSeriesReferenceEntry[]>();
  const bySongLoose = new Map<string, SongSeriesReferenceEntry[]>();

  for (const reference of references) {
    const normalizedNameVariants = generateNormalizedNameVariants(reference.songName);
    const looseNameVariants = generateLooseNameVariants(reference.songName);
    const artistVariants = generateArtistVariants(reference.artistHint);

    for (const normalizedSongName of normalizedNameVariants) {
      const byName = bySongName.get(normalizedSongName) ?? [];
      byName.push(reference);
      bySongName.set(normalizedSongName, byName);

      for (const artistVariant of artistVariants) {
        const key = `${normalizedSongName}\u0000${artistVariant}`;
        const byArtist = bySongArtist.get(key) ?? [];
        byArtist.push(reference);
        bySongArtist.set(key, byArtist);
      }
    }

    for (const looseSongName of looseNameVariants) {
      const byLoose = bySongLoose.get(looseSongName) ?? [];
      byLoose.push(reference);
      bySongLoose.set(looseSongName, byLoose);
    }
  }

  return { bySongArtist, bySongName, bySongLoose };
}

function dedupeReferences(references: SongSeriesReferenceEntry[]): SongSeriesReferenceEntry[] {
  const byKey = new Map<string, SongSeriesReferenceEntry>();
  for (const reference of references) {
    byKey.set(buildReferenceKey(reference), reference);
  }

  return Array.from(byKey.values());
}

function artistSimilarityScore(artist: string, reference: SongSeriesReferenceEntry): number {
  const referenceArtist = reference.artistHint;
  if (!referenceArtist) {
    return 0;
  }

  const catalogVariants = generateArtistVariants(artist);
  const referenceVariants = generateArtistVariants(referenceArtist);
  const referenceVariantSet = new Set(referenceVariants);

  for (const variant of catalogVariants) {
    if (referenceVariantSet.has(variant)) {
      return 3;
    }
  }

  for (const left of catalogVariants) {
    for (const right of referenceVariants) {
      if (left.length >= 4 && right.length >= 4 && (left.includes(right) || right.includes(left))) {
        return 2;
      }
    }
  }

  const leftTokens = new Set(normalizeArtistForCompare(artist).split(/\s+/).filter(Boolean));
  const rightTokens = new Set(normalizeArtistForCompare(referenceArtist).split(/\s+/).filter(Boolean));
  for (const token of leftTokens) {
    if (token.length >= 3 && rightTokens.has(token)) {
      return 1;
    }
  }

  return 0;
}

function narrowByArtistSimilarity(references: SongSeriesReferenceEntry[], artist: string): SongSeriesReferenceEntry[] {
  if (references.length <= 1) {
    return references;
  }

  const scored = references.map((reference) => ({
    reference,
    score: artistSimilarityScore(artist, reference),
  }));

  const bestScore = Math.max(...scored.map((item) => item.score));
  if (bestScore <= 0) {
    return references;
  }

  return scored.filter((item) => item.score === bestScore).map((item) => item.reference);
}

function pickReferenceCandidates(
  songName: string,
  artist: string,
  indexes: ReturnType<typeof buildReferenceIndexes>,
): { references: SongSeriesReferenceEntry[]; method: "song+artist" | "songName" | "looseSongName" | null } {
  const normalizedNameVariants = generateNormalizedNameVariants(songName);
  const looseNameVariants = generateLooseNameVariants(songName);
  const artistVariants = generateArtistVariants(artist);

  const byArtistCandidates: SongSeriesReferenceEntry[] = [];
  for (const normalizedSongName of normalizedNameVariants) {
    for (const artistVariant of artistVariants) {
      const byArtist = indexes.bySongArtist.get(`${normalizedSongName}\u0000${artistVariant}`) ?? [];
      byArtistCandidates.push(...byArtist);
    }
  }
  if (byArtistCandidates.length > 0) {
    return { references: dedupeReferences(byArtistCandidates), method: "song+artist" };
  }

  const byNameCandidates: SongSeriesReferenceEntry[] = [];
  for (const normalizedSongName of normalizedNameVariants) {
    const byName = indexes.bySongName.get(normalizedSongName) ?? [];
    byNameCandidates.push(...byName);
  }
  if (byNameCandidates.length > 0) {
    const deduped = dedupeReferences(byNameCandidates);
    return { references: narrowByArtistSimilarity(deduped, artist), method: "songName" };
  }

  const byLooseCandidates: SongSeriesReferenceEntry[] = [];
  for (const looseSongName of looseNameVariants) {
    const byLoose = indexes.bySongLoose.get(looseSongName) ?? [];
    byLooseCandidates.push(...byLoose);
  }
  if (byLooseCandidates.length > 0) {
    const deduped = dedupeReferences(byLooseCandidates);
    return { references: narrowByArtistSimilarity(deduped, artist), method: "looseSongName" };
  }

  return { references: [], method: null };
}

function chooseReferenceSeries(
  songName: string,
  references: SongSeriesReferenceEntry[],
): { series: SongSeries; rule: string; source: string; confidenceDelta: number } | null {
  const resolved: Array<{ series: SongSeries; rule: string; source: string; confidenceDelta: number }> = [];
  const shortCutVariant = isShortCutVariant(songName);

  for (const reference of references) {
    const baseSeries = reference.sectionSeries;
    if (!baseSeries) {
      continue;
    }

    if (reference.hasPortedKeyword) {
      if (reference.portedSeriesOverride) {
        resolved.push({
          series: reference.portedSeriesOverride,
          rule: "note_ported_override",
          source: `${reference.sourceFile}:${reference.sectionId}`,
          confidenceDelta: 0.05,
        });
      }
      continue;
    }

    if (shortCutVariant && reference.shortCutSeriesOverride) {
      resolved.push({
        series: reference.shortCutSeriesOverride,
        rule: "note_short_cut_override",
        source: `${reference.sourceFile}:${reference.sectionId}`,
        confidenceDelta: 0.08,
      });
      continue;
    }

    resolved.push({
      series: baseSeries,
      rule: "section_mapping",
      source: `${reference.sourceFile}:${reference.sectionId}`,
      confidenceDelta: 0,
    });
  }

  if (resolved.length === 0) {
    return null;
  }

  const uniqueSeries = Array.from(new Set(resolved.map((item) => item.series)));
  if (uniqueSeries.length > 1) {
    return null;
  }

  return resolved[0];
}

function hasPortedNoteWithoutSeries(references: SongSeriesReferenceEntry[]): boolean {
  return references.some((reference) => reference.hasPortedKeyword && !reference.portedSeriesOverride);
}

export function assignSongSeriesToCatalogDocuments(
  catalogDocuments: SongCatalogDocument[],
  references: SongSeriesReferenceEntry[],
  overrides: SongCatalogSeriesOverride[] = [],
  assignedAt = nowIso(),
): SongCatalogSeriesAssignmentResult {
  const indexes = buildReferenceIndexes(references);
  const overrideMap = new Map<string, SongCatalogSeriesOverride>();

  for (const override of overrides) {
    overrideMap.set(overrideLookupKey(override.songKey, override.artist), override);
  }

  const assigned: SongCatalogSeriesAssignment[] = [];
  const unresolved: SongCatalogSeriesUnresolved[] = [];
  let manualOverrideCount = 0;

  for (const document of catalogDocuments) {
    const override = overrideMap.get(overrideLookupKey(document.songKey, document.artist));
    if (override) {
      manualOverrideCount += 1;
      assigned.push({
        songKey: document.songKey,
        songName: document.songName,
        artist: document.artist,
        series: override.series,
        seriesSource: "song_catalog_series_overrides",
        seriesRule: "manual_override",
        seriesConfidence: 1,
        seriesAssignedAt: assignedAt,
      });
      continue;
    }

    const match = pickReferenceCandidates(document.songName, document.artist, indexes);
    if (match.references.length === 0 || !match.method) {
      unresolved.push({
        songKey: document.songKey,
        songName: document.songName,
        artist: document.artist,
        reason: "no_reference_match",
        details: "No reference row matched with exact or controlled fallback normalization.",
      });
      continue;
    }

    if (hasPortedNoteWithoutSeries(match.references)) {
      unresolved.push({
        songKey: document.songKey,
        songName: document.songName,
        artist: document.artist,
        reason: "ported_note_without_series",
        details: "Reference row includes a ported note but no explicit target series token.",
      });
      continue;
    }

    const seriesDecision = chooseReferenceSeries(document.songName, match.references);
    if (!seriesDecision) {
      const allUnmapped = match.references.every((reference) => !reference.sectionSeries);
      unresolved.push({
        songKey: document.songKey,
        songName: document.songName,
        artist: document.artist,
        reason: allUnmapped ? "section_unmapped" : "ambiguous_reference",
        details: allUnmapped
          ? "Reference section exists but has no deterministic section-to-series rule."
          : "Multiple reference candidates produced conflicting series values.",
      });
      continue;
    }

    let confidence = 0.95 + seriesDecision.confidenceDelta;
    if (match.method === "songName") {
      confidence -= 0.07;
    } else if (match.method === "looseSongName") {
      confidence -= 0.14;
    }

    assigned.push({
      songKey: document.songKey,
      songName: document.songName,
      artist: document.artist,
      series: seriesDecision.series,
      seriesSource: seriesDecision.source,
      seriesRule: seriesDecision.rule,
      seriesConfidence: Math.max(0, Math.min(1, confidence)),
      seriesAssignedAt: assignedAt,
    });
  }

  return {
    assigned,
    unresolved,
    summary: {
      totalCatalogSongs: catalogDocuments.length,
      assignedCount: assigned.length,
      unresolvedCount: unresolved.length,
      manualOverrideCount,
    },
  };
}

export async function ensureSongSeriesReferenceIndexes(
  collection: Collection<SongSeriesReferenceDocument & Document>,
): Promise<void> {
  await collection.createIndex({ referenceKey: 1 }, { unique: true });
  await collection.createIndex({ normalizedSongName: 1 });
  await collection.createIndex({ sectionId: 1 });
}

export async function ensureSongSeriesOverrideIndexes(
  collection: Collection<SongCatalogSeriesOverride & Document>,
): Promise<void> {
  await collection.createIndex({ songKey: 1, artist: 1 }, { unique: true });
}

export async function upsertSongSeriesReferences(
  collection: Collection<SongSeriesReferenceDocument & Document>,
  references: SongSeriesReferenceEntry[],
  updatedAt = nowIso(),
): Promise<SongSeriesUpsertResult> {
  let matchedCount = 0;
  let modifiedCount = 0;
  let upsertedCount = 0;

  for (const reference of references) {
    const referenceKey = buildReferenceKey(reference);
    const result = (await collection.updateOne(
      { referenceKey },
      {
        $set: {
          ...reference,
          referenceKey,
        },
        $setOnInsert: {
          updatedAt,
        },
      },
      { upsert: true },
    )) as UpdateResult;

    matchedCount += result.matchedCount ?? 0;
    modifiedCount += result.modifiedCount ?? 0;
    upsertedCount += result.upsertedCount ?? 0;
  }

  return {
    matchedCount,
    modifiedCount,
    upsertedCount,
  };
}

export async function loadSongSeriesReferences(
  collection: Collection<SongSeriesReferenceDocument & Document>,
): Promise<SongSeriesReferenceEntry[]> {
  const documents = await collection.find({}).toArray();
  return documents.map((document) => ({
    sourceFile: document.sourceFile,
    sectionId: document.sectionId,
    sectionTitle: document.sectionTitle,
    sectionSeries: document.sectionSeries,
    songName: document.songName,
    normalizedSongName: document.normalizedSongName,
    looseSongName: document.looseSongName,
    artistHint: document.artistHint,
    normalizedArtistHint: document.normalizedArtistHint,
    noteText: document.noteText,
    shortCutSeriesOverride: document.shortCutSeriesOverride,
    portedSeriesOverride: document.portedSeriesOverride,
    hasPortedKeyword: document.hasPortedKeyword,
  }));
}

export async function loadSongSeriesOverrides(
  collection: Collection<SongCatalogSeriesOverride & Document>,
): Promise<SongCatalogSeriesOverride[]> {
  const documents = await collection.find({}).toArray();
  return documents.map((document) => ({
    songKey: document.songKey,
    artist: document.artist,
    series: document.series,
    reason: document.reason ?? null,
    updatedAt: document.updatedAt ?? null,
  }));
}

export async function applySongSeriesAssignments(
  collection: Collection<SongCatalogSeriesDocument & Document>,
  assignments: SongCatalogSeriesAssignment[],
): Promise<SongSeriesUpsertResult> {
  let matchedCount = 0;
  let modifiedCount = 0;
  let upsertedCount = 0;

  for (const assignment of assignments) {
    const result = (await collection.updateOne(
      { songKey: assignment.songKey, artist: assignment.artist },
      {
        $set: {
          series: assignment.series,
          seriesSource: assignment.seriesSource,
          seriesRule: assignment.seriesRule,
          seriesConfidence: assignment.seriesConfidence,
          seriesAssignedAt: assignment.seriesAssignedAt,
        },
      },
      { upsert: false },
    )) as UpdateResult;

    matchedCount += result.matchedCount ?? 0;
    modifiedCount += result.modifiedCount ?? 0;
    upsertedCount += result.upsertedCount ?? 0;
  }

  return {
    matchedCount,
    modifiedCount,
    upsertedCount,
  };
}
