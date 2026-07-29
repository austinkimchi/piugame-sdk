import { Mutex } from "async-mutex";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import type { RecentPlay } from "./types";

interface SongImageRecord {
  filename: string;
  firstSeenAt: string;
  lastSeenAt: string;
  seenCount: number;
}

interface SongMapEntry {
  songName: string;
  images: SongImageRecord[];
}

interface SongMapFile {
  [normalizedSongName: string]: SongMapEntry;
}

function nowIso(): string {
  return new Date().toISOString();
}

export function normalizeSongName(songName: string): string {
  return songName.replace(/\s+/g, " ").trim();
}

export function extractSongImageFilename(songImageUrl: string | null): string | null {
  if (!songImageUrl) {
    return null;
  }

  try {
    const parsed = new URL(songImageUrl);
    if (!/^\/data\/song_img2?\//i.test(parsed.pathname)) {
      return null;
    }

    const basename = path.posix.basename(parsed.pathname);
    if (!basename || !/\.png$/i.test(basename)) {
      return null;
    }

    return decodeURIComponent(basename);
  } catch {
    return null;
  }
}

export class SongMapStore {
  private readonly lock = new Mutex();
  private readonly filePath: string;

  public constructor(filePath: string) {
    this.filePath = filePath;
  }

  public async recordRecentPlays(plays: RecentPlay[]): Promise<string[]> {
    if (plays.length === 0) {
      return [];
    }

    return this.lock.runExclusive(async () => {
      const map = await this.readCurrentMap();
      let changed = false;
      const newFilenames = new Set<string>();

      for (const play of plays) {
        const key = normalizeSongName(play.songName);
        if (!key) {
          continue;
        }

        const filename = extractSongImageFilename(play.songImageUrl);
        if (!filename) {
          continue;
        }

        const at = nowIso();
        const entry = map[key] ?? { songName: key, images: [] };
        const existing = entry.images.find((item) => item.filename === filename);

        if (existing) {
          existing.lastSeenAt = at;
          existing.seenCount += 1;
        } else {
          newFilenames.add(filename);
          entry.images.push({
            filename,
            firstSeenAt: at,
            lastSeenAt: at,
            seenCount: 1,
          });
        }

        map[key] = entry;
        changed = true;
      }

      if (!changed) {
        return [];
      }

      await this.writeMapAtomic(map);
      return Array.from(newFilenames);
    });
  }

  private async readCurrentMap(): Promise<SongMapFile> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return {};
      }

      return parsed as SongMapFile;
    } catch {
      return {};
    }
  }

  private async writeMapAtomic(map: SongMapFile): Promise<void> {
    const dir = path.dirname(this.filePath);
    await mkdir(dir, { recursive: true });

    const tempPath = `${this.filePath}.tmp-${process.pid}-${Date.now()}`;
    await writeFile(tempPath, JSON.stringify(map, null, 2), "utf8");
    await rename(tempPath, this.filePath);
  }
}
