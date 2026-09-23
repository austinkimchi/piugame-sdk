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
    requirement: null,
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
            indexes: async () => name === "titles"
              ? [{ name: "_id_", key: { _id: 1 } }, { name: "normalizedName_1", key: { normalizedName: 1 }, unique: true }]
              : [{ name: "_id_", key: { _id: 1 } }],
            dropIndex: async (indexName: string) => {
              indexes[name].push(["drop", indexName]);
            },
          };
        },
      }),
      close: async () => undefined,
    };

    const storage = new (MongoStorage as any)(fakeClient);

    await (storage as any).ensureIndexes();
    await storage.upsertTitleCatalog("phoenix2", [
      titleEntry("SUNNY FOLLOWER", "[SUNNY STEP] 100+ Plays"),
      titleEntry("BEGINNER", null),
    ]);

    expect(indexes.titles).toContainEqual(["drop", "normalizedName_1"]);
    expect(indexes.titles).toContainEqual([{ piuVersion: 1, normalizedName: 1 }, { unique: true }]);
    expect(indexes.titles.some(([, options]) => {
      return Boolean((options as { expireAfterSeconds?: number }).expireAfterSeconds);
    })).toBe(false);
    expect(bulkWrites.titles).toMatchObject([
      {
        updateOne: {
          filter: { piuVersion: "phoenix2", normalizedName: "sunny follower" },
          update: {
            $set: {
              piuVersion: "phoenix2",
              normalizedName: "sunny follower",
              name: "SUNNY FOLLOWER",
              description: "[SUNNY STEP] 100+ Plays",
              requirementMetric: null,
              requirementTarget: null,
            },
          },
          upsert: true,
        },
      },
      {
        updateOne: {
          filter: { piuVersion: "phoenix2", normalizedName: "beginner" },
          update: {
            $set: {
              piuVersion: "phoenix2",
              normalizedName: "beginner",
              name: "BEGINNER",
              description: null,
              requirementMetric: null,
              requirementTarget: null,
            },
          },
          upsert: true,
        },
      },
    ]);
  });
});
