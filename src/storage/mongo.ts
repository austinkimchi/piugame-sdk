import { MongoClient, type Collection } from "mongodb";

import type { EndpointName, SerializableCookie, StoredSession } from "../types";

interface SessionDocument {
  username: string;
  cookies: SerializableCookie[];
  expiresAt: Date;
  updatedAt: Date;
}

interface CacheDocument {
  key: string;
  username: string;
  endpoint: EndpointName;
  payload: string;
  expiresAt: Date;
  updatedAt: Date;
}

export class MongoStorage {
  private readonly client: MongoClient;
  private readonly sessions: Collection<SessionDocument>;
  private readonly cache: Collection<CacheDocument>;

  private constructor(client: MongoClient) {
    this.client = client;

    const db = this.client.db("piugame_sdk");
    this.sessions = db.collection<SessionDocument>("sessions");
    this.cache = db.collection<CacheDocument>("cache");
  }

  public static async connect(uri: string): Promise<MongoStorage> {
    const client = new MongoClient(uri);
    await client.connect();

    const storage = new MongoStorage(client);
    await storage.ensureIndexes();
    return storage;
  }

  public async close(): Promise<void> {
    await this.client.close();
  }

  public async getSession(username: string): Promise<StoredSession | null> {
    const document = await this.sessions.findOne({ username });
    if (!document) {
      return null;
    }

    return {
      username: document.username,
      cookies: document.cookies,
      expiresAt: document.expiresAt.toISOString(),
      updatedAt: document.updatedAt.toISOString(),
    };
  }

  public async setSession(
    username: string,
    cookies: SerializableCookie[],
    expiresAt: Date,
  ): Promise<void> {
    await this.sessions.updateOne(
      { username },
      {
        $set: {
          username,
          cookies,
          expiresAt,
          updatedAt: new Date(),
        },
      },
      { upsert: true },
    );
  }

  public async clearSession(username: string): Promise<void> {
    await this.sessions.deleteOne({ username });
  }

  public async getCache(key: string): Promise<string | null> {
    const document = await this.cache.findOne({ key });
    return document?.payload ?? null;
  }

  public async setCache(
    key: string,
    username: string,
    endpoint: EndpointName,
    payload: string,
    expiresAt: Date,
  ): Promise<void> {
    await this.cache.updateOne(
      { key },
      {
        $set: {
          key,
          username,
          endpoint,
          payload,
          expiresAt,
          updatedAt: new Date(),
        },
      },
      { upsert: true },
    );
  }

  public async clearUserCache(username: string): Promise<void> {
    await this.cache.deleteMany({ username });
  }

  public async clearUser(username: string): Promise<void> {
    await Promise.all([this.clearSession(username), this.clearUserCache(username)]);
  }

  private async ensureIndexes(): Promise<void> {
    await this.sessions.createIndex({ username: 1 }, { unique: true });
    await this.sessions.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });

    await this.cache.createIndex({ key: 1 }, { unique: true });
    await this.cache.createIndex({ username: 1 });
    await this.cache.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
  }
}
