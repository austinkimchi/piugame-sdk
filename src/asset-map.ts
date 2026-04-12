import { Mutex } from "async-mutex";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import type { BestPlay, PlayerData, RecentPlay } from "./types";

interface AssetRecord {
  firstSeenAt: string;
  lastSeenAt: string;
  seenCount: number;
}

type AssetMapFile = Record<string, AssetRecord>;

function nowIso(): string {
  return new Date().toISOString();
}

export function normalizeAssetCode(value: string | null): string | null {
  const normalized = (value ?? "").trim().toLowerCase();
  return normalized || null;
}

export function toGradeDisplayKey(gradeCode: string | null): string | null {
  const code = normalizeAssetCode(gradeCode);
  if (!code) {
    return null;
  }

  return code.replace(/_p\b/i, "+").toUpperCase();
}

export function extractAvatarImageFilename(avatarUrl: string | null): string | null {
  if (!avatarUrl) {
    return null;
  }

  try {
    const parsed = new URL(avatarUrl);
    if (!/\/avatar_img\//i.test(parsed.pathname)) {
      return null;
    }

    const basename = path.posix.basename(parsed.pathname);
    if (!basename || !/\.(png|jpe?g|webp|gif)$/i.test(basename)) {
      return null;
    }

    return decodeURIComponent(basename);
  } catch {
    return null;
  }
}

class AssetFileStore {
  private readonly lock = new Mutex();
  private readonly filePath: string;

  public constructor(filePath: string) {
    this.filePath = filePath;
  }

  public async record(keys: Array<string | null | undefined>): Promise<void> {
    const filtered = keys
      .map((value) => (value ?? "").trim())
      .filter((value) => value.length > 0);

    if (filtered.length === 0) {
      return;
    }

    await this.lock.runExclusive(async () => {
      const map = await this.readCurrentMap();
      const at = nowIso();

      for (const key of filtered) {
        const existing = map[key];
        if (existing) {
          existing.lastSeenAt = at;
          existing.seenCount += 1;
          continue;
        }

        map[key] = {
          firstSeenAt: at,
          lastSeenAt: at,
          seenCount: 1,
        };
      }

      await this.writeMapAtomic(map);
    });
  }

  private async readCurrentMap(): Promise<AssetMapFile> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return {};
      }

      return parsed as AssetMapFile;
    } catch {
      return {};
    }
  }

  private async writeMapAtomic(map: AssetMapFile): Promise<void> {
    const dir = path.dirname(this.filePath);
    await mkdir(dir, { recursive: true });

    const tempPath = `${this.filePath}.tmp-${process.pid}-${Date.now()}`;
    await writeFile(tempPath, JSON.stringify(map, null, 2), "utf8");
    await rename(tempPath, this.filePath);
  }
}

export class GlobalAssetMapStore {
  private readonly avatarStore: AssetFileStore;
  private readonly gradeStore: AssetFileStore;
  private readonly plateStore: AssetFileStore;

  public constructor(avatarPath: string, gradePath: string, platePath: string) {
    this.avatarStore = new AssetFileStore(avatarPath);
    this.gradeStore = new AssetFileStore(gradePath);
    this.plateStore = new AssetFileStore(platePath);
  }

  public async recordPlayerData(profile: PlayerData): Promise<void> {
    const avatarFile = extractAvatarImageFilename(profile.avatarUrl);
    await this.avatarStore.record([avatarFile]);
  }

  public async recordRecentPlays(plays: RecentPlay[]): Promise<void> {
    if (plays.length === 0) {
      return;
    }

    const gradeKeys: string[] = [];
    for (const play of plays) {
      const normalized = normalizeAssetCode(play.grade);
      if (normalized) {
        gradeKeys.push(normalized);
      }

      const display = toGradeDisplayKey(play.grade);
      if (display) {
        gradeKeys.push(display);
      }
    }

    await Promise.all([
      this.gradeStore.record(gradeKeys),
      this.plateStore.record(plays.map((play) => normalizeAssetCode(play.plate))),
    ]);
  }

  public async recordBestPlays(plays: BestPlay[]): Promise<void> {
    if (plays.length === 0) {
      return;
    }

    const gradeKeys: string[] = [];
    for (const play of plays) {
      const normalized = normalizeAssetCode(play.grade);
      if (normalized) {
        gradeKeys.push(normalized);
      }

      const display = toGradeDisplayKey(play.grade);
      if (display) {
        gradeKeys.push(display);
      }
    }

    await Promise.all([
      this.gradeStore.record(gradeKeys),
      this.plateStore.record(plays.map((play) => normalizeAssetCode(play.plate))),
    ]);
  }
}
