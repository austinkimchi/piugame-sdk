import { load } from "cheerio";

import { ParseError } from "./errors";
import type {
  BestPlay,
  BestScorePage,
  JudgmentCounts,
  PlayerData,
  RecentPlay,
  TitleEntry,
} from "./types";

const NUMBER_PATTERN = /-?\d[\d,]*/;

function cleanText(value: string | undefined | null): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
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

function parseStepBall(containerHtml: ReturnType<typeof load>): { mode: string | null; level: number | null } {
  const modeImg = containerHtml(".tw img").attr("src");
  const modeMatch = modeImg ? /\/([^/]+)_text\.png/i.exec(modeImg) : null;
  const mode = modeMatch?.[1]?.toUpperCase() ?? null;

  const levelDigits: string[] = [];
  containerHtml(".numw img").each((_, img) => {
    const src = containerHtml(img).attr("src");
    const levelMatch = src ? /_num_(\d+)\.png/i.exec(src) : null;
    if (levelMatch) {
      levelDigits.push(levelMatch[1]);
    }
  });

  const level = levelDigits.length > 0 ? Number(levelDigits.join("")) : null;
  return {
    mode,
    level: Number.isFinite(level) ? level : null,
  };
}

function parseStepBallFromElement(root: ReturnType<typeof load>, selector: string): { mode: string | null; level: number | null } {
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
    return { gameId: gameIdTag, gameTag: null };
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
  const gameIdTag = cleanText(profile.find(".profile_name .name_w .t2").first().text()) || null;
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
  const $ = load(html);
  const entries = $(".data_titleList2 > li");

  if (entries.length === 0) {
    throw new ParseError("parseTitleEntries", "Could not find title entries.");
  }

  const results: TitleEntry[] = [];

  entries.each((_, entry) => {
    const root = $(entry);
    const className = cleanText(root.attr("class"));
    const statusText = cleanText(root.find(".state_w .stateBox .tt").first().text()) || null;
    const status = normalizeTitleStatus(statusText);
    const owned = className.split(/\s+/).includes("have");

    results.push({
      name:
        cleanText(root.attr("data-name")) ||
        cleanText(root.find(".txt_w .txt").first().text()) ||
        "Unknown",
      description: cleanText(root.find(".txt_w2 .txt").first().text()) || null,
      className,
      owned,
      locked: !owned || status.lockedByText,
      inUse: status.inUse,
      settable: status.settable,
      unlockable: status.unlockable,
      statusText,
    });
  });

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
