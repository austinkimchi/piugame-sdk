import { describe, expect, test } from "vitest";

import { MongoStorage } from "../src/storage/mongo";
import type { TitleEntry } from "../src/types";

function titleEntry(name: string, description: string | null): TitleEntry {
  return {
    name,
    description,
    setToken: null,
    className: "have",
    owned: true,
    locked: false,
    inUse: false,
    settable: true,
    unlockable: false,
    statusText: "Set",
  };
}

describe("MongoStorage", () => {
  test("upserts durable title catalog metadata without a TTL index", async () => {
    const bulkWrites: Record<string, unknown[]> = {};
    const indexes: Record<string, unknown[][]> = {};

    const fakeClient = {
      db: () => ({
        collection: (name: string) => {
          indexes[name] ??= [];
          return {
            bulkWrite: async (operations: unknown[]) => {
              bulkWrites[name] = operations;
            },
            createIndex: async (...args: unknown[]) => {
              indexes[name].push(args);
            },
          };
        },
      }),
      close: async () => undefined,
    };

    const storage = new (MongoStorage as any)(fakeClient);

    await (storage as any).ensureIndexes();
    await storage.upsertTitleCatalog([
      titleEntry("SUNNY FOLLOWER", "[SUNNY STEP] 100+ Plays"),
      titleEntry("BEGINNER", null),
    ]);

    expect(indexes.titles).toEqual([
      [{ normalizedName: 1 }, { unique: true }],
    ]);
    expect(indexes.titles.some(([, options]) => {
      return Boolean((options as { expireAfterSeconds?: number }).expireAfterSeconds);
    })).toBe(false);
    expect(bulkWrites.titles).toMatchObject([
      {
        updateOne: {
          filter: { normalizedName: "sunny follower" },
          update: {
            $set: {
              normalizedName: "sunny follower",
              name: "SUNNY FOLLOWER",
              description: "[SUNNY STEP] 100+ Plays",
            },
          },
          upsert: true,
        },
      },
      {
        updateOne: {
          filter: { normalizedName: "beginner" },
          update: {
            $set: {
              normalizedName: "beginner",
              name: "BEGINNER",
              description: null,
            },
          },
          upsert: true,
        },
      },
    ]);
  });
});
