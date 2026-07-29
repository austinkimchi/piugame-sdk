import { load } from "cheerio";

import { ParseError } from "./errors";
import type {
  BestPlay,
  BestScorePage,
  JudgmentCounts,
  PlayerData,
  RecentPlay,
  TopPlay,
  TitleEntry,
} from "./types";

const NUMBER_PATTERN = /-?\d[\d,]*/;
const TITLE_ENTRY_PATTERN = /<li\b([^>]*)>([\s\S]*?)<\/li>/gi;
const ATTRIBUTE_PATTERN = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
const HTML_ENTITY_PATTERN = /&(#x[\da-f]+|#\d+|[a-z]+);/gi;
const HTML_ENTITY_MAP: Record<string, string> = {
  amp: "&",
  apos: "'",
  gt: ">",
  lt: "<",
  nbsp: " ",
  quot: "\"",
};

function cleanText(value: string | undefined | null): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function decodeHtmlEntities(value: string): string {
  return value.replace(HTML_ENTITY_PATTERN, (entityText: string, entity: string) => {
    const normalized = entity.toLowerCase();
    if (normalized.startsWith("#x")) {
      const codePoint = Number.parseInt(normalized.slice(2), 16);
      return isValidCodePoint(codePoint) ? String.fromCodePoint(codePoint) : entityText;
    }

    if (normalized.startsWith("#")) {
      const codePoint = Number.parseInt(normalized.slice(1), 10);
      return isValidCodePoint(codePoint) ? String.fromCodePoint(codePoint) : entityText;
    }

    return HTML_ENTITY_MAP[normalized] ?? entityText;
  });
}

function isValidCodePoint(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= 0x10ffff;
}

function cleanHtmlText(value: string | undefined | null): string {
  return cleanText(decodeHtmlEntities((value ?? "").replace(/<[^>]*>/g, " ")));
}

function parseHtmlAttributes(value: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  ATTRIBUTE_PATTERN.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = ATTRIBUTE_PATTERN.exec(value)) !== null) {
    attributes[match[1].toLowerCase()] = decodeHtmlEntities(match[2] ?? match[3] ?? match[4] ?? "");
  }

  return attributes;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractClassHtml(html: string, className: string): string | null {
  const pattern = new RegExp(
    `<([a-z][\\w:-]*)\\b(?=[^>]*\\bclass=(["'])[^"']*\\b${escapeRegex(className)}\\b[^"']*\\2)[^>]*>([\\s\\S]*?)<\\/\\1>`,
    "i",
  );
  return pattern.exec(html)?.[3] ?? null;
}

function extractClassText(html: string, className: string): string {
  return cleanHtmlText(extractClassHtml(html, className));
}

function extractInputValue(html: string, inputName: string): string | null {
  const inputPattern = /<input\b([^>]*)>/gi;
  let match: RegExpExecArray | null;

  while ((match = inputPattern.exec(html)) !== null) {
    const attributes = parseHtmlAttributes(match[1]);
    if ((attributes.name ?? "").toLowerCase() === inputName.toLowerCase()) {
      return cleanText(attributes.value);
    }
  }

  return null;
}

function normalizeGameIdTag(value: string | undefined | null): string | null {
  const collapsed = cleanText(value);
  if (!collapsed) {
    return null;
  }

  const normalized = collapsed.replace(/\s*#\s*/g, "#");
  return normalized || null;
}

function parseNumber(value: string | undefined | null): number | null {
  const text = cleanText(value);
  const match = text.match(NUMBER_PATTERN);
  if (!match) {
    return null;
  }

  const parsed = Number(match[0].replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function parseBackgroundImageUrl(styleValue: string | undefined): string | null {
  if (!styleValue) {
    return null;
  }

  const match = /url\((['"]?)([^'")]+)\1\)/i.exec(styleValue);
  return match?.[2] ?? null;
}

function parseAssetCode(src: string | undefined, assetFolder: "grade" | "plate"): string | null {
  if (!src) {
    return null;
  }

  const regex = new RegExp(`/${assetFolder}/([^/]+)\\.[a-zA-Z]+(?:[?#].*)?$`, "i");
  const match = regex.exec(src);
  if (!match) {
    return null;
  }

  return match[1].toLowerCase();
}

function parseFileBasenameCode(src: string | undefined): string | null {
  if (!src) {
    return null;
  }

  const match = /(?:^|\/)([^/?#]+)\.[a-zA-Z]+(?:[?#].*)?$/i.exec(src);
  if (!match) {
    return null;
  }

  return match[1].toLowerCase();
}

function normalizeChartLevel(level: string): string {
  if (!/^\d+$/.test(level)) {
    return level;
  }
  return `${Number.parseInt(level, 10)}`;
}

function parseStepBall(containerHtml: ReturnType<typeof load>): { mode: string | null; level: string | null } {
  const modeImg = containerHtml(".tw img").attr("src");
  const modeMatch = modeImg ? /\/([^/]+)_text\.png/i.exec(modeImg) : null;
  const mode = modeMatch?.[1]?.toUpperCase() ?? null;

  const levelParts: string[] = [];
  containerHtml(".numw img").each((_, img) => {
    const src = containerHtml(img).attr("src");
    const levelMatch = src ? /(?:_num_([^/.?#]+)|_guess)\.png/i.exec(src) : null;
    if (levelMatch) {
      const part = levelMatch[1] ?? "?";
      levelParts.push(/^\d+$/.test(part) ? part : "?");
    }
  });

  const level = levelParts.length > 0 ? normalizeChartLevel(levelParts.join("")) : null;
  return {
    mode,
    level,
  };
}

function parseStepBallFromElement(root: ReturnType<typeof load>, selector: string): { mode: string | null; level: string | null } {
  const html = root(selector).first().html();
  if (!html) {
    return { mode: null, level: null };
  }

  return parseStepBall(load(html));
}

function parseGameIdTag(gameIdTag: string | null): { gameId: string | null; gameTag: string | null } {
  if (!gameIdTag) {
    return { gameId: null, gameTag: null };
  }

  const split = gameIdTag.split("#");
  if (split.length === 1) {
    return { gameId: cleanText(gameIdTag) || null, gameTag: null };
  }

  const gameId = cleanText(split[0]);
  const gameTag = `#${cleanText(split.slice(1).join("#"))}`;
  return {
    gameId: gameId || null,
    gameTag: gameTag || null,
  };
}

export function parsePlayerData(html: string, username: string): PlayerData {
  const $ = load(html);
  const profile = $(".subProfile_wrap .in_profile").first();

  if (profile.length === 0) {
    throw new ParseError("parsePlayerData", "Could not find profile block in play_data response.");
  }

  const titleName = cleanText(profile.find(".profile_name .name_w .t1").first().text()) || null;
  const gameIdTag = normalizeGameIdTag(profile.find(".profile_name .name_w .t2").first().text());
  const { gameId, gameTag } = parseGameIdTag(gameIdTag);

  let lastAccess: string | null = null;
  let recentArcade: string | null = null;

  profile.find(".time_w li .tt").each((_, element) => {
    const line = cleanText($(element).text());
    const normalized = line.toLowerCase();

    if (normalized.startsWith("last access date")) {
      lastAccess = cleanText(line.split(":").slice(1).join(":")) || null;
    }

    if (normalized.startsWith("recently access games")) {
      recentArcade = cleanText(line.split(":").slice(1).join(":")) || null;
    }
  });

  const clearRaw = cleanText($(".play_data_wrap .clear_w .l_con .t1").first().text()) || null;
  const clearMatch = clearRaw ? /(\d[\d,]*)\s*\/\s*(\d[\d,]*)/.exec(clearRaw) : null;

  const plateCounts: Record<string, number> = {};
  $(".play_data_wrap .plate_w .list > li").each((_, element) => {
    const item = $(element);
    const count = parseNumber(item.find(".t_num").first().text());

    const typeFromLink = cleanText(item.find("a[data-type]").first().attr("data-type"));
    const imageSrc = item.find(".img img").first().attr("src");
    const typeFromImage = imageSrc ? /s_([a-z0-9_]+)\./i.exec(imageSrc)?.[1] : null;

    const key = (typeFromLink || typeFromImage || "unknown").toLowerCase();
    plateCounts[key] = count ?? 0;
  });

  return {
    username,
    titleName,
    gameIdTag,
    gameId,
    gameTag,
    avatarUrl: parseBackgroundImageUrl(profile.find(".profile_img .re").attr("style")),
    pp: parseNumber(profile.find(".profile_etc .tt").first().text()),
    pumbilityScore: null,
    lastAccess,
    recentArcade,
    playCount: parseNumber($(".board_search .total .t2").first().text()),
    rating: parseNumber($(".play_data_wrap .my_w .num").first().text()),
    clear: {
      raw: clearRaw,
      cleared: clearMatch ? parseNumber(clearMatch[1]) : null,
      total: clearMatch ? parseNumber(clearMatch[2]) : null,
    },
    progressPercent: parseNumber($(".play_data_wrap .clear_w .graph .num").first().text()),
    plateCounts,
  };
}

export function parsePumbilityScore(html: string): number | null {
  const $ = load(html);

  let score: number | null = null;

  $(".pumbility_total_wrap .inn, .pumbility_total_wrap .in_bg1").each((_, element) => {
    if (score !== null) {
      return;
    }

    const root = $(element);
    const label = cleanText(root.find(".t1").first().text()).toLowerCase();
    if (!/pumbility|pumpbility/.test(label)) {
      return;
    }

    score = parseNumber(root.find(".t2").first().text());
  });

  if (score !== null) {
    return score;
  }

  return parseNumber(
    $(".pumbility_total_wrap .inn .t2, .pumbility_total_wrap .in_bg1 .t2").first().text(),
  );
}

export function parseTopPlays(html: string): TopPlay[] {
  const $ = load(html);
  const scopedEntries = $(".rating_rangking_list_w.pumblitiySt .list > li");
  const entries = scopedEntries.length > 0 ? scopedEntries : $(".rating_rangking_list_w .list > li");
  const plays: TopPlay[] = [];

  entries.each((_, entry) => {
    const root = $(entry);
    const songName = cleanText(root.find(".profile_name .t1").first().text());

    if (!songName) {
      return;
    }

    const rank = parseNumber(root.find(".num .img_wrap .num .tt").first().text()) ?? plays.length + 1;
    const localRoot = load(root.html() ?? "");
    const { mode, level } = parseStepBallFromElement(localRoot, ".stepBall_in");
    const gradeSrc = root.find(".grade_wrap img").first().attr("src");

    plays.push({
      rank,
      songName,
      artist: cleanText(root.find(".profile_name .t2").first().text()) || null,
      songImageUrl: parseBackgroundImageUrl(root.find(".profile_img .re").first().attr("style")),
      mode,
      level,
      grade: parseAssetCode(gradeSrc, "grade") ?? parseFileBasenameCode(gradeSrc),
      score: parseNumber(root.find(".score .tt").first().text()),
      playedAt: cleanText(root.find(".date .tt").first().text()) || null,
    });
  });

  return plays;
}

function createEmptyJudgments(): JudgmentCounts {
  return {
    perfect: null,
    great: null,
    good: null,
    bad: null,
    miss: null,
  };
}

export function parseRecentPlays(html: string): RecentPlay[] {
  const $ = load(html);
  const entries = $(".recently_playeList > li");

  if (entries.length === 0) {
    throw new ParseError("parseRecentPlays", "Could not find recently played entries.");
  }

  const plays: RecentPlay[] = [];

  entries.each((_, entry) => {
    const root = $(entry);
    const songName = cleanText(root.find(".song_name p").first().text());

    if (!songName) {
      return;
    }

    const scoreCell = root.find(".con2 .list > li").eq(1);
    const stageText = cleanText(scoreCell.find(".tx").first().text());
    const stageBreak = /stage\s*break/i.test(stageText);

    const judgments = createEmptyJudgments();
    root.find("table.recently_play td").each((_, td) => {
      const cell = $(td);
      const label = cleanText(cell.attr("data-th")).toLowerCase();
      const value = parseNumber(cell.find(".tx").first().text());

      if (label === "perfect") {
        judgments.perfect = value;
      } else if (label === "great") {
        judgments.great = value;
      } else if (label === "good") {
        judgments.good = value;
      } else if (label === "bad") {
        judgments.bad = value;
      } else if (label === "miss") {
        judgments.miss = value;
      }
    });

    const { mode, level } = parseStepBallFromElement(load(root.html() ?? ""), ".stepBall_in");

    plays.push({
      songName,
      songImageUrl: parseBackgroundImageUrl(root.find(".wrap_in > .in").attr("style")),
      mode,
      level,
      score: stageBreak ? null : parseNumber(scoreCell.find(".tx").first().text()),
      grade: stageBreak
        ? null
        : parseAssetCode(scoreCell.find("img").first().attr("src"), "grade"),
      plate: parseAssetCode(root.find(".con2 .list > li").eq(2).find("img").first().attr("src"), "plate"),
      stageBreak,
      judgments,
      playedAt: cleanText(root.find(".recently_date_tt").first().text()) || null,
    });
  });

  return plays;
}

function normalizeTitleStatus(statusText: string | null): {
  inUse: boolean;
  settable: boolean;
  unlockable: boolean;
  lockedByText: boolean;
} {
  const normalized = (statusText ?? "").toLowerCase();
  return {
    inUse: normalized === "title in use",
    settable: normalized === "set",
    unlockable: /unlocking is possible|unlockable/.test(normalized),
    lockedByText:
      /not achieving the unlock condition|unlocking is impossible|locked/.test(normalized),
  };
}

export function parseTitleEntries(html: string): TitleEntry[] {
  const results: TitleEntry[] = [];
  const titleListHtml = extractClassHtml(html, "data_titleList2");
  if (!titleListHtml) {
    throw new ParseError("parseTitleEntries", "Could not find title entries.");
  }

  TITLE_ENTRY_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = TITLE_ENTRY_PATTERN.exec(titleListHtml)) !== null) {
    const attributes = parseHtmlAttributes(match[1]);
    const entryHtml = match[2];
    const className = cleanText(attributes.class);
    const titleText = extractClassText(entryHtml, "txt_w");
    const descriptionText = extractClassText(entryHtml, "txt_w2");
    const statusText = cleanHtmlText(extractClassHtml(entryHtml, "state_w")) || null;
    const status = normalizeTitleStatus(statusText);
    const owned = className.split(/\s+/).includes("have");

    results.push({
      name: cleanText(attributes["data-name"]) || titleText || "Unknown",
      description: descriptionText || null,
      setToken: extractInputValue(entryHtml, "no"),
      className,
      owned,
      locked: !owned || status.lockedByText,
      inUse: status.inUse,
      settable: status.settable,
      unlockable: status.unlockable,
      statusText,
    });
  }

  if (results.length === 0) {
    throw new ParseError("parseTitleEntries", "Could not find title entries.");
  }

  return results;
}

export function parseOwnedTitleCount(html: string): number | null {
  const $ = load(html);
  return parseNumber($(".board_search .total_wrap .t2").first().text());
}

export function extractLastPageNumber(html: string): number | null {
  const $ = load(html);
  const paging = $(".board_paging").first();
  if (paging.length === 0) {
    return null;
  }

  let fromLastButton: number | null = null;
  paging.find("button").each((_, button) => {
    const item = $(button);
    if (item.find(".xi.last").length > 0) {
      const onclick = item.attr("onclick") ?? "";
      const match = /page=(\d+)/i.exec(onclick);
      if (match) {
        fromLastButton = Number(match[1]);
      }
    }
  });

  if (fromLastButton && Number.isFinite(fromLastButton)) {
    return fromLastButton;
  }

  let maxNumeric = 1;
  paging.find("button").each((_, button) => {
    const value = parseNumber($(button).text());
    if (value && value > maxNumeric) {
      maxNumeric = value;
    }
  });

  return maxNumeric;
}

export function parseBestScorePage(html: string, page: number): BestScorePage {
  const $ = load(html);
  const items = $(".my_best_scoreList > li");

  const plays: BestPlay[] = [];

  items.each((_, item) => {
    const root = $(item);
    const songName = cleanText(root.find(".song_name p").first().text());
    if (!songName) {
      return;
    }

    const localRoot = load(root.html() ?? "");
    const { mode, level } = parseStepBallFromElement(localRoot, ".stepBall_in");

    plays.push({
      songName,
      mode,
      level,
      score: parseNumber(root.find(".txt_v .num").first().text()),
      grade: parseAssetCode(root.find(".etc_con li").eq(1).find("img").first().attr("src"), "grade"),
      plate: parseAssetCode(root.find(".etc_con li").eq(2).find("img").first().attr("src"), "plate"),
      page,
    });
  });

  return {
    page,
    total: parseNumber($(".board_search .total_wrap .t2").first().text()),
    lastPage: extractLastPageNumber(html),
    plays,
  };
}
