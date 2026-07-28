import { Mutex } from "async-mutex";
import { access, mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  AuthenticationError,
  NetworkError,
  SSOAutomationError,
  SessionExpiredError,
  SSORequiredError,
  TitleUpdateError,
} from "./errors";
import * as http from "node:http";
import * as https from "node:https";
import {
  parseBestScorePage,
  parsePumbilityScore,
  parsePlayerData,
  parseRecentPlays,
  parseTopPlays,
  parseTitleEntries,
} from "./parsers";
import { extractSongImageFilename } from "./song-map";
import { MongoStorage } from "./storage/mongo";
import type {
  BestPlay,
  BestScorePage,
  CacheTtlConfig,
  EndpointName,
  FetchAllPlaysResult,
  HttpTransport,
  PiuGameVersion,
  PlayerData,
  PiuClientOptions,
  RecentPlay,
  SerializableCookie,
  StoredSession,
  TopPlay,
  TransportRequest,
  TransportResponse,
  TitleEntry,
  TitleUpdateResult,
} from "./types";

interface Credentials {
  username: string;
  password: string;
}

interface SessionCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  expiresAt: Date | null;
  secure: boolean;
  httpOnly: boolean;
}

interface SessionState {
  username: string;
  cookies: SessionCookie[];
  expiresAt: Date | null;
  lastValidatedAt: number;
}

interface CacheEntry {
  payload: string;
  expiresAt: number;
  username: string;
  endpoint: EndpointName;
}

interface EnsureAuthOptions {
  force?: boolean;
}

interface ReauthenticationResult {
  validated: boolean;
}

interface ProbeResult {
  valid: boolean;
  ssoRedirectUrl: string | null;
}

interface BrowserCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires: number;
  secure: boolean;
  httpOnly: boolean;
}

interface SsoSubmitResult {
  submitted: boolean;
  loginResponse: Promise<void> | null;
}

const PIU_VERSION_BASE_URLS: Record<PiuGameVersion, string> = {
  phoenix: "https://phoenix.piugame.com",
  phoenix2: "https://www.piugame.com",
};
const DEFAULT_PIU_VERSION: PiuGameVersion = "phoenix";
const DEFAULT_BASE_URL = PIU_VERSION_BASE_URLS[DEFAULT_PIU_VERSION];
const LOGIN_PATH = "/bbs/login_check.php";
const LOGOUT_PATH = "/bbs/logout.php";
const AUTH_PROBE_PATH = "/my_page/play_data.php";

const DEFAULT_TTL: CacheTtlConfig = {
  playerDataMs: 2 * 60 * 1000,
  recentPlaysMs: 60 * 1000,
  titleMs: 5 * 60 * 1000,
  bestScorePageMs: 5 * 60 * 1000,
  topPlaysMs: 5 * 60 * 1000,
};

const DEFAULT_TIMEOUT_MS = 20_000;
const SESSION_EXPIRY_FALLBACK_MS = 30 * 60 * 1000;
const SESSION_VALIDATION_COOLDOWN_MS = 60 * 1000;
const DEFAULT_REDIRECT_LIMIT = 5;
const DEFAULT_SSO_TIMEOUT_MS = 60_000;
const DEFAULT_AUTH_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36 Edg/150.0.0.0";
const INSECURE_TLS_ENV_KEY = "PIU_INSECURE_TLS";
const TLS_FALLBACK_ENV_KEY = "PIU_TLS_FALLBACK_INSECURE";
const SONG_ASSET_ENABLE_ENV_KEY = "PIU_SONG_ASSET_ENABLE";
const PROFILE_ASSET_ENABLE_ENV_KEY = "PIU_PROFILE_ASSET_ENABLE";
const GRADE_PLATE_ASSET_ENABLE_ENV_KEY = "PIU_GRADE_PLATE_ASSET_ENABLE";
const SONG_MAP_ENABLE_ENV_KEY = "PIU_SONG_MAP_ENABLE";
const SONG_MAP_AUTO_FETCH_ENABLE_ENV_KEY = "PIU_SONG_MAP_AUTO_FETCH";
const ASSET_MAP_ENABLE_ENV_KEY = "PIU_ASSET_MAP_ENABLE";
const SONG_IMAGE_PATH = "data/song_img";

const SSO_USERNAME_SELECTORS = [
  "input[name='mb_id']",
  "input[name='id']",
  "input[name='username']",
  "input[name='email']",
  "input[type='email']",
  "input[type='text']",
];
const SSO_PASSWORD_SELECTORS = [
  "input[name='mb_password']",
  "input[name='password']",
  "input[type='password']",
];
const SSO_SUBMIT_SELECTORS = [
  "button[type='submit']",
  "input[type='submit']",
  "button[name='login']",
  "button:has-text('Login')",
  "button:has-text('Sign in')",
  "button:has-text('Sign In')",
];
const SSO_ENTRY_SELECTORS = [
  "form[action*='login_check.php']",
  ...SSO_USERNAME_SELECTORS,
  ...SSO_PASSWORD_SELECTORS,
];
const SSO_AUTHENTICATED_SELECTORS = [
  ".subProfile_wrap",
  ".play_data_wrap",
  ".profile_name",
];
const SSO_READINESS_POLL_MS = 100;

const TLS_CERT_ERROR_CODES = new Set([
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "UNABLE_TO_GET_ISSUER_CERT",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  "CERT_HAS_EXPIRED",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "ERR_TLS_CERT_ALTNAME_INVALID",
]);

function normalizeHeaderName(name: string): string {
  return name.trim().toLowerCase();
}

function parseBooleanEnv(value: string | undefined): boolean | null {
  if (!value) {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }

  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }

  return null;
}

function parseBooleanEnvFromKeys(...keys: string[]): boolean | null {
  for (const key of keys) {
    const parsed = parseBooleanEnv(process.env[key]);
    if (parsed !== null) {
      return parsed;
    }
  }

  return null;
}

function normalizeAssetCode(value: string | null): string | null {
  const normalized = (value ?? "").trim().toLowerCase();
  return normalized || null;
}

function normalizeTitleName(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function isPiuHost(baseUrl: string): boolean {
  try {
    const host = new URL(baseUrl).hostname.toLowerCase();
    return isKnownPiuHostname(host);
  } catch {
    return false;
  }
}

function isKnownPiuHostname(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === "piugame.com" || host === "www.piugame.com" || host.endsWith(".piugame.com");
}

function isTlsCertificateValidationError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  const maybeError = error as { code?: unknown; cause?: unknown; message?: unknown };
  const code = typeof maybeError.code === "string" ? maybeError.code : null;
  if (code && TLS_CERT_ERROR_CODES.has(code)) {
    return true;
  }

  const nestedCause = maybeError.cause;
  if (nestedCause && typeof nestedCause === "object") {
    const nestedCode = (nestedCause as { code?: unknown }).code;
    if (typeof nestedCode === "string" && TLS_CERT_ERROR_CODES.has(nestedCode)) {
      return true;
    }
  }

  const message = typeof maybeError.message === "string" ? maybeError.message.toLowerCase() : "";
  return message.includes("unable to verify the first certificate");
}

function splitSetCookieHeader(rawHeader: string): string[] {
  const result: string[] = [];
  let startIndex = 0;
  let inExpires = false;

  for (let i = 0; i < rawHeader.length; i += 1) {
    const char = rawHeader[i];
    const lowerSlice = rawHeader.slice(i).toLowerCase();

    if (!inExpires && lowerSlice.startsWith("expires=")) {
      inExpires = true;
      i += "expires=".length - 1;
      continue;
    }

    if (inExpires && char === ";") {
      inExpires = false;
      continue;
    }

    if (!inExpires && char === ",") {
      result.push(rawHeader.slice(startIndex, i).trim());
      startIndex = i + 1;
    }
  }

  const tail = rawHeader.slice(startIndex).trim();
  if (tail) {
    result.push(tail);
  }

  return result.filter(Boolean);
}

function getHeaderValues(
  headers: Record<string, string | string[] | undefined>,
  headerName: string,
): string[] {
  const normalized = normalizeHeaderName(headerName);
  const direct = headers[normalized] ?? headers[headerName];

  if (Array.isArray(direct)) {
    return direct;
  }

  if (typeof direct === "string") {
    if (normalized === "set-cookie") {
      return splitSetCookieHeader(direct);
    }

    return [direct];
  }

  return [];
}

function parseDate(value: string | undefined): Date | null {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function toSerializableCookie(cookie: SessionCookie): SerializableCookie {
  return {
    name: cookie.name,
    value: cookie.value,
    domain: cookie.domain,
    path: cookie.path,
    expiresAt: cookie.expiresAt ? cookie.expiresAt.toISOString() : null,
    secure: cookie.secure,
    httpOnly: cookie.httpOnly,
  };
}

function fromSerializableCookie(cookie: SerializableCookie): SessionCookie {
  return {
    name: cookie.name,
    value: cookie.value,
    domain: cookie.domain,
    path: cookie.path,
    expiresAt: parseDate(cookie.expiresAt ?? undefined),
    secure: cookie.secure,
    httpOnly: cookie.httpOnly,
  };
}

function normalizePath(path: string): string {
  return path.startsWith("/") ? path : `/${path}`;
}

function absoluteUrl(baseUrl: string, path: string): string {
  return new URL(path, baseUrl).toString();
}

function originFromBaseUrl(baseUrl: string): string {
  return new URL(baseUrl).origin;
}

function resolveBaseUrl(options: PiuClientOptions): string {
  return options.baseUrl ?? PIU_VERSION_BASE_URLS[options.version ?? DEFAULT_PIU_VERSION];
}

function cacheNamespaceFromBaseUrl(baseUrl: string): string {
  const origin = originFromBaseUrl(baseUrl);
  if (origin === originFromBaseUrl(PIU_VERSION_BASE_URLS.phoenix)) {
    return "phoenix";
  }
  if (origin === originFromBaseUrl(PIU_VERSION_BASE_URLS.phoenix2)) {
    return "phoenix2";
  }

  return origin;
}

function isRedirectStatus(status: number): boolean {
  return status >= 300 && status < 400;
}

function isSsoUrl(urlOrLocation: string | undefined | null): boolean {
  if (!urlOrLocation) {
    return false;
  }

  return /api\.am-pass\.net\/sso/i.test(urlOrLocation);
}

function toResponseHeaders(
  incoming: http.IncomingHttpHeaders,
): Record<string, string | string[] | undefined> {
  const output: Record<string, string | string[] | undefined> = {};

  for (const [rawName, rawValue] of Object.entries(incoming)) {
    const name = normalizeHeaderName(rawName);

    if (Array.isArray(rawValue)) {
      output[name] = rawValue;
      continue;
    }

    if (typeof rawValue === "number") {
      output[name] = String(rawValue);
      continue;
    }

    output[name] = rawValue;
  }

  return output;
}

function createDefaultTransport(
  defaultTimeoutMs: number,
  rejectUnauthorized: boolean,
  allowInsecureTlsFallback: boolean,
): HttpTransport {
  const httpAgent = new http.Agent({ keepAlive: true });
  const httpsAgentStrict = new https.Agent({
    keepAlive: true,
    rejectUnauthorized,
  });
  const httpsAgentInsecure = new https.Agent({
    keepAlive: true,
    rejectUnauthorized: false,
  });

  const requestOnce = async (
    request: TransportRequest,
    urlText: string,
    useInsecureTls: boolean,
  ): Promise<TransportResponse> => {
    const url = new URL(urlText);
    const useHttps = url.protocol === "https:";
    const client = useHttps ? https : http;

    return new Promise<TransportResponse>((resolve, reject) => {
      const timeoutMs = request.timeoutMs ?? defaultTimeoutMs;
      const nodeRequest = client.request(
        url,
        {
          method: request.method,
          headers: request.headers,
          agent: useHttps
            ? (useInsecureTls ? httpsAgentInsecure : httpsAgentStrict)
            : httpAgent,
        },
        (nodeResponse) => {
          const chunks: Buffer[] = [];

          nodeResponse.on("data", (chunk) => {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
          });

          nodeResponse.on("end", () => {
            resolve({
              status: nodeResponse.statusCode ?? 0,
              headers: toResponseHeaders(nodeResponse.headers),
              body: Buffer.concat(chunks).toString("utf8"),
              url: url.toString(),
            });
          });

          nodeResponse.on("error", reject);
        },
      );

      const timeoutHandle = setTimeout(() => {
        nodeRequest.destroy(new Error(`Request timeout after ${timeoutMs}ms.`));
      }, timeoutMs);

      nodeRequest.on("error", (error) => {
        clearTimeout(timeoutHandle);
        reject(error);
      });

      nodeRequest.on("close", () => {
        clearTimeout(timeoutHandle);
      });

      if (request.body) {
        nodeRequest.write(request.body);
      }

      nodeRequest.end();
    });
  };

  return async (request: TransportRequest): Promise<TransportResponse> => {
    const mode = request.redirect ?? "follow";
    let currentUrl = request.url;

    for (let redirectCount = 0; redirectCount <= DEFAULT_REDIRECT_LIMIT; redirectCount += 1) {
      let response: TransportResponse;
      try {
        response = await requestOnce(request, currentUrl, false);
      } catch (error) {
        const shouldFallbackToInsecureTls =
          rejectUnauthorized &&
          allowInsecureTlsFallback &&
          currentUrl.toLowerCase().startsWith("https://") &&
          isTlsCertificateValidationError(error);

        if (!shouldFallbackToInsecureTls) {
          throw error;
        }

        response = await requestOnce(request, currentUrl, true);
      }

      if (mode !== "follow" || !isRedirectStatus(response.status)) {
        return response;
      }

      const location = getHeaderValues(response.headers, "location")[0];
      if (!location) {
        return response;
      }

      currentUrl = new URL(location, currentUrl).toString();
    }

    throw new Error(`Too many redirects (>${DEFAULT_REDIRECT_LIMIT}) for ${request.method} ${request.url}.`);
  };
}

export class PiuClient {
  private readonly baseUrl: string;
  private readonly cacheNamespace: string;
  private readonly timeoutMs: number;
  private readonly cacheTtl: CacheTtlConfig;
  private readonly userAgent: string;
  private readonly transport: HttpTransport;
  private readonly ssoAutoResolve: boolean;
  private readonly ssoHeadless: boolean;
  private readonly ssoTimeoutMs: number;
  private readonly speculativeSsoBootstrap: boolean;
  private readonly songAssetEnabled: boolean;
  private readonly profileAssetEnabled: boolean;
  private readonly gradePlateAssetEnabled: boolean;

  private readonly sessions = new Map<string, SessionState>();
  private readonly credentials = new Map<string, Credentials>();
  private readonly authLocks = new Map<string, Mutex>();
  private readonly inMemoryCache = new Map<string, CacheEntry>();
  private readonly songImageDownloadLocks = new Map<string, Promise<void>>();
  private readonly assetImageDownloadLocks = new Map<string, Promise<void>>();

  private mongoStorage: MongoStorage | null = null;

  public constructor(options: PiuClientOptions = {}) {
    this.baseUrl = resolveBaseUrl(options);
    this.cacheNamespace = cacheNamespaceFromBaseUrl(this.baseUrl);
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.cacheTtl = {
      ...DEFAULT_TTL,
      ...(options.cacheTtl ?? {}),
    };
    this.userAgent = options.userAgent ?? "piugame-sdk/0.1";
    const insecureTlsFromEnv = parseBooleanEnv(process.env[INSECURE_TLS_ENV_KEY]) ?? false;
    const fallbackFromEnv = parseBooleanEnv(process.env[TLS_FALLBACK_ENV_KEY]);
    const allowInsecureTlsFallback =
      options.allowInsecureTlsFallback ??
      fallbackFromEnv ??
      isPiuHost(this.baseUrl);
    const rejectUnauthorized = options.rejectUnauthorized ?? !insecureTlsFromEnv;
    this.ssoAutoResolve = options.ssoAutoResolve ?? true;
    this.ssoHeadless = options.ssoHeadless ?? true;
    this.ssoTimeoutMs = options.ssoTimeoutMs ?? DEFAULT_SSO_TIMEOUT_MS;
    this.speculativeSsoBootstrap =
      options.speculativeSsoBootstrap ?? (!options.transport && isPiuHost(this.baseUrl));
    this.songAssetEnabled =
      parseBooleanEnvFromKeys(
        SONG_ASSET_ENABLE_ENV_KEY,
        SONG_MAP_ENABLE_ENV_KEY,
        SONG_MAP_AUTO_FETCH_ENABLE_ENV_KEY,
      ) ?? false;
    this.profileAssetEnabled =
      parseBooleanEnvFromKeys(PROFILE_ASSET_ENABLE_ENV_KEY, ASSET_MAP_ENABLE_ENV_KEY) ?? false;
    this.gradePlateAssetEnabled =
      parseBooleanEnvFromKeys(GRADE_PLATE_ASSET_ENABLE_ENV_KEY, ASSET_MAP_ENABLE_ENV_KEY) ?? false;
    this.transport =
      options.transport ??
      createDefaultTransport(this.timeoutMs, rejectUnauthorized, allowInsecureTlsFallback);
  }

  public async setDatabase(mongoUri: string): Promise<void> {
    if (this.mongoStorage) {
      await this.mongoStorage.close();
    }

    this.mongoStorage = await MongoStorage.connect(mongoUri);

    for (const username of this.sessions.keys()) {
      await this.persistSession(username);
    }

    for (const [key, entry] of this.inMemoryCache.entries()) {
      const ttlMs = Math.max(1, entry.expiresAt - Date.now());
      await this.mongoStorage.setCache(
        key,
        entry.username,
        entry.endpoint,
        entry.payload,
        new Date(Date.now() + ttlMs),
      );
    }
  }

  public async login(username: string, password: string): Promise<void> {
    if (!username || !password) {
      throw new AuthenticationError("Both username and password are required.");
    }

    this.credentials.set(username, { username, password });
    await this.ensureAuthenticated(username, { force: true });
  }

  public async logout(username: string): Promise<void> {
    const hadSession = await this.hasKnownSession(username);

    if (hadSession) {
      try {
        await this.requestWithCurrentSession(username, {
          method: "GET",
          path: LOGOUT_PATH,
          redirect: "manual",
        });
      } catch {
        // Best-effort logout; local and DB cleanup still proceed.
      }
    }

    this.sessions.delete(username);
    this.credentials.delete(username);
    this.clearUserInMemoryCache(username);

    if (this.mongoStorage) {
      await this.mongoStorage.clearUser(username);
    }
  }

  public async getPlayerData(username: string): Promise<PlayerData> {
    const profile = await this.getCachedParsedEndpoint({
      username,
      endpoint: "player_data",
      cacheTtlMs: this.cacheTtl.playerDataMs,
      loader: async () => {
        await this.ensureAuthenticated(username);
        const [playDataResponse, pumbilityScore] = await Promise.all([
          this.authenticatedRequest(username, {
            method: "GET",
            path: "/my_page/play_data.php",
            redirect: "manual",
            skipEnsureAuthenticated: true,
          }),
          this.fetchPumbilityScore(username, true),
        ]);

        const parsed = parsePlayerData(playDataResponse.body, username);
        return {
          ...parsed,
          pumbilityScore,
        };
      },
    });

    await this.ensureAssetsFromPlayerData(profile);
    return profile;
  }

  public async getRecentPlays(username: string): Promise<RecentPlay[]> {
    const plays = await this.getCachedParsedEndpoint({
      username,
      endpoint: "recent_plays",
      cacheTtlMs: this.cacheTtl.recentPlaysMs,
      loader: async () => {
        const response = await this.authenticatedRequest(username, {
          method: "GET",
          path: "/my_page/recently_played.php",
          redirect: "manual",
        });

        return parseRecentPlays(response.body);
      },
    });

    await Promise.all([
      this.ensureSongImagesFromRecentPlays(plays),
      this.ensureAssetsFromRecentPlays(plays),
    ]);
    return plays;
  }

  public async getTopPlays(username: string): Promise<TopPlay[]> {
    return this.getCachedParsedEndpoint({
      username,
      endpoint: "top_plays",
      cacheTtlMs: this.cacheTtl.topPlaysMs,
      loader: async () => {
        const response = await this.authenticatedRequest(username, {
          method: "GET",
          path: "/my_page/pumbility.php",
          redirect: "manual",
        });

        return parseTopPlays(response.body);
      },
    });
  }

  public async getTitle(username: string): Promise<TitleEntry[]> {
    return this.fetchFreshTitleEntries(username);
  }

  public async setTitle(username: string, titleName: string): Promise<TitleUpdateResult> {
    const normalizedTitleName = normalizeTitleName(titleName);
    if (!normalizedTitleName) {
      throw new TitleUpdateError("Title name is required.");
    }

    const currentTitles = await this.fetchFreshTitleEntries(username);
    const target = currentTitles.find(
      (title) => normalizeTitleName(title.name) === normalizedTitleName,
    );

    if (!target) {
      throw new TitleUpdateError(`Title '${titleName}' was not found.`);
    }

    if (target.inUse) {
      throw new TitleUpdateError(`Title '${target.name}' is already in use.`);
    }

    if (!target.owned || target.locked) {
      throw new TitleUpdateError(`Title '${target.name}' is not owned or is locked.`);
    }

    if (!target.settable || !target.setToken) {
      throw new TitleUpdateError(`Title '${target.name}' cannot be set from the current page.`);
    }

    const body = new URLSearchParams({ no: target.setToken }).toString();
    await this.authenticatedRequest(username, {
      method: "POST",
      path: "/logic/user_title_update.php",
      body,
      headers: {
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "content-type": "application/x-www-form-urlencoded",
        origin: originFromBaseUrl(this.baseUrl),
        referer: absoluteUrl(this.baseUrl, "/my_page/title.php"),
      },
      redirect: "manual",
    });

    await this.clearUserEndpointCache(username, ["title", "player_data"]);

    const titles = await this.fetchFreshTitleEntries(username);
    const updated = titles.find(
      (title) => normalizeTitleName(title.name) === normalizeTitleName(target.name),
    );
    const success = updated?.inUse === true;

    return {
      username,
      titleName: updated?.name ?? target.name,
      success,
      message: success
        ? `Title '${updated?.name ?? target.name}' is now in use.`
        : `Title '${target.name}' update was submitted, but the refreshed title page did not show it in use.`,
      titles,
    };
  }

  public async refresh(username: string): Promise<PlayerData> {
    this.clearUserInMemoryCache(username);
    if (this.mongoStorage) {
      await this.mongoStorage.clearUserCache(username, this.userCacheKeyPrefix(username));
    }

    await this.ensureAuthenticated(username, { force: true });

    const [response, pumbilityScore] = await Promise.all([
      this.authenticatedRequest(username, {
        method: "GET",
        path: "/my_page/play_data.php",
        redirect: "manual",
        skipEnsureAuthenticated: true,
      }),
      this.fetchPumbilityScore(username, true),
    ]);
    const parsed = parsePlayerData(response.body, username);
    const result: PlayerData = {
      ...parsed,
      pumbilityScore,
    };
    await this.writeCache(username, this.buildCacheKey(username, "player_data"), "player_data", result, this.cacheTtl.playerDataMs);
    await this.ensureAssetsFromPlayerData(result);
    return result;
  }

  public async fetchAllPlays(username: string): Promise<FetchAllPlaysResult> {
    const firstPage = await this.getBestScorePage(username, 1);
    const pagesFetched = [1];

    const aggregated = [...firstPage.plays];
    const seen = new Set(aggregated.map((play) => this.playIdentity(play.songName, play.mode, play.level, play.score, play.grade)));

    const detectedLastPage = firstPage.lastPage;

    if (detectedLastPage && detectedLastPage > 1) {
      for (let page = 2; page <= detectedLastPage; page += 1) {
        const result = await this.getBestScorePage(username, page);
        pagesFetched.push(page);

        for (const play of result.plays) {
          const identity = this.playIdentity(play.songName, play.mode, play.level, play.score, play.grade);
          if (!seen.has(identity)) {
            seen.add(identity);
            aggregated.push(play);
          }
        }
      }

      return {
        username,
        total: firstPage.total,
        totalPages: detectedLastPage,
        pagesFetched,
        plays: aggregated,
      };
    }

    let page = 2;
    let maxFallbackPages = 200;

    while (maxFallbackPages > 0) {
      const result = await this.getBestScorePage(username, page);
      if (result.plays.length === 0) {
        break;
      }

      let addedThisPage = 0;
      for (const play of result.plays) {
        const identity = this.playIdentity(play.songName, play.mode, play.level, play.score, play.grade);
        if (!seen.has(identity)) {
          seen.add(identity);
          aggregated.push(play);
          addedThisPage += 1;
        }
      }

      if (addedThisPage === 0) {
        break;
      }

      pagesFetched.push(page);
      page += 1;
      maxFallbackPages -= 1;
    }

    return {
      username,
      total: firstPage.total,
      totalPages: pagesFetched.length,
      pagesFetched,
      plays: aggregated,
    };
  }

  private async getBestScorePage(username: string, page: number): Promise<BestScorePage> {
    const result = await this.getCachedParsedEndpoint({
      username,
      endpoint: "best_score_page",
      suffix: `:${page}`,
      cacheTtlMs: this.cacheTtl.bestScorePageMs,
      loader: async () => {
        const response = await this.authenticatedRequest(username, {
          method: "GET",
          path: `/my_page/my_best_score.php?&&page=${page}`,
          redirect: "manual",
        });

        return parseBestScorePage(response.body, page);
      },
    });

    await this.ensureAssetsFromBestPlays(result.plays);
    return result;
  }

  private playIdentity(
    songName: string,
    mode: string | null,
    level: number | null,
    score: number | null,
    grade: string | null,
  ): string {
    return [songName, mode ?? "", level ?? "", score ?? "", grade ?? ""].join("|");
  }

  private async fetchPumbilityScore(
    username: string,
    skipEnsureAuthenticated = false,
  ): Promise<number | null> {
    try {
      const response = await this.authenticatedRequest(username, {
        method: "GET",
        path: "/my_page/pumbility.php",
        redirect: "manual",
        skipEnsureAuthenticated,
      });

      return parsePumbilityScore(response.body);
    } catch {
      return null;
    }
  }

  private async fetchFreshTitleEntries(username: string): Promise<TitleEntry[]> {
    const response = await this.authenticatedRequest(username, {
      method: "GET",
      path: "/my_page/title.php",
      redirect: "manual",
    });

    const titles = parseTitleEntries(response.body);
    await this.persistTitleCatalog(titles);
    return titles;
  }

  private async persistTitleCatalog(titles: TitleEntry[]): Promise<void> {
    if (!this.mongoStorage) {
      return;
    }

    await this.mongoStorage.upsertTitleCatalog(titles);
  }

  private async getCachedParsedEndpoint<T>(options: {
    username: string;
    endpoint: EndpointName;
    suffix?: string;
    cacheTtlMs: number;
    loader: () => Promise<T>;
  }): Promise<T> {
    const key = this.buildCacheKey(options.username, options.endpoint, options.suffix);

    const cached = await this.readCache<T>(key);
    if (cached !== null) {
      return cached;
    }

    const fresh = await options.loader();
    await this.writeCache(options.username, key, options.endpoint, fresh, options.cacheTtlMs);
    return fresh;
  }

  private buildCacheKey(username: string, endpoint: EndpointName, suffix?: string): string {
    return `${this.cacheNamespace}:${username}:${endpoint}${suffix ?? ""}`;
  }

  private async readCache<T>(key: string): Promise<T | null> {
    const memory = this.inMemoryCache.get(key);
    if (memory && memory.expiresAt > Date.now()) {
      return JSON.parse(memory.payload) as T;
    }

    if (memory) {
      this.inMemoryCache.delete(key);
    }

    if (!this.mongoStorage) {
      return null;
    }

    const payload = await this.mongoStorage.getCache(key);
    if (!payload) {
      return null;
    }

    return JSON.parse(payload) as T;
  }

  private async writeCache(
    username: string,
    key: string,
    endpoint: EndpointName,
    payload: unknown,
    ttlMs: number,
  ): Promise<void> {
    const serialized = JSON.stringify(payload);
    const expiresAt = Date.now() + ttlMs;

    this.inMemoryCache.set(key, {
      payload: serialized,
      expiresAt,
      username,
      endpoint,
    });

    if (this.mongoStorage) {
      await this.mongoStorage.setCache(
        key,
        username,
        endpoint,
        serialized,
        new Date(expiresAt),
      );
    }
  }

  private clearUserInMemoryCache(username: string): void {
    for (const [key, value] of this.inMemoryCache.entries()) {
      if (value.username === username && key.startsWith(`${this.cacheNamespace}:${username}:`)) {
        this.inMemoryCache.delete(key);
      }
    }
  }

  private async clearUserEndpointCache(
    username: string,
    endpoints: EndpointName[],
  ): Promise<void> {
    for (const [key, value] of this.inMemoryCache.entries()) {
      if (value.username !== username || !key.startsWith(`${this.cacheNamespace}:${username}:`)) {
        continue;
      }

      if (endpoints.includes(value.endpoint)) {
        this.inMemoryCache.delete(key);
      }
    }

    if (this.mongoStorage) {
      await this.mongoStorage.clearUserEndpointCache(
        username,
        endpoints,
        this.userCacheKeyPrefix(username),
      );
    }
  }

  private userCacheKeyPrefix(username: string): string {
    return `${this.cacheNamespace}:${username}:`;
  }

  private async ensureSongImagesFromRecentPlays(plays: RecentPlay[]): Promise<void> {
    if (!this.songAssetEnabled || plays.length === 0) {
      return;
    }

    try {
      const sourceUrlByFilename = new Map<string, string>();
      for (const play of plays) {
        if (!play.songImageUrl) {
          continue;
        }

        const filename = extractSongImageFilename(play.songImageUrl);
        if (!filename || sourceUrlByFilename.has(filename)) {
          continue;
        }

        sourceUrlByFilename.set(filename, play.songImageUrl);
      }

      await Promise.all(Array.from(sourceUrlByFilename.entries()).map(
        ([filename, sourceUrl]) => this.ensureSongImageDownloaded(filename, sourceUrl),
      ));
    } catch {
      // Best-effort song image ensure; ignore write failures.
    }
  }

  private async ensureSongImageDownloaded(filename: string, sourceUrl: string): Promise<void> {
    const existing = this.songImageDownloadLocks.get(filename);
    if (existing) {
      await existing;
      return;
    }

    const pending = (async () => {
      const targetPath = path.resolve(process.cwd(), SONG_IMAGE_PATH, filename);
      try {
        await access(targetPath);
        return;
      } catch {
        // File does not exist; continue.
      }

      const buffer = await this.downloadBinaryAsset(sourceUrl);
      if (buffer.length === 0) {
        throw new Error(`PNG download returned empty body for ${sourceUrl}`);
      }

      const dir = path.dirname(targetPath);
      await mkdir(dir, { recursive: true });

      const tempPath = `${targetPath}.tmp-${process.pid}-${Date.now()}`;
      await writeFile(tempPath, buffer);

      try {
        await rename(tempPath, targetPath);
      } catch {
        await rm(tempPath, { force: true });
      }
    })();

    this.songImageDownloadLocks.set(
      filename,
      pending.finally(() => {
        this.songImageDownloadLocks.delete(filename);
      }),
    );

    const queued = this.songImageDownloadLocks.get(filename);
    if (queued) {
      await queued;
    }
  }

  private async ensureAssetsFromPlayerData(profile: PlayerData): Promise<void> {
    if (!this.profileAssetEnabled) {
      return;
    }

    try {
      if (profile.avatarUrl) {
        await this.ensureAssetImageDownloaded(profile.avatarUrl);
      }
    } catch {
      // Best-effort asset image ensure; ignore write failures.
    }
  }

  private async ensureAssetsFromRecentPlays(plays: RecentPlay[]): Promise<void> {
    if (!this.gradePlateAssetEnabled || plays.length === 0) {
      return;
    }

    try {
      const gradeCodes = new Set<string>();
      const plateCodes = new Set<string>();
      for (const play of plays) {
        const grade = normalizeAssetCode(play.grade);
        const plate = normalizeAssetCode(play.plate);
        if (grade) {
          gradeCodes.add(grade);
        }
        if (plate) {
          plateCodes.add(plate);
        }
      }
      await Promise.all([
        ...Array.from(gradeCodes).map((grade) =>
          this.ensureAssetImageDownloaded(absoluteUrl(this.baseUrl, `/l_img/grade/${grade}.png`)),
        ),
        ...Array.from(plateCodes).map((plate) =>
          this.ensureAssetImageDownloaded(absoluteUrl(this.baseUrl, `/l_img/plate/${plate}.png`)),
        ),
      ]);
    } catch {
      // Best-effort asset image ensure; ignore write failures.
    }
  }

  private async ensureAssetsFromBestPlays(plays: BestPlay[]): Promise<void> {
    if (!this.gradePlateAssetEnabled || plays.length === 0) {
      return;
    }

    try {
      const gradeCodes = new Set<string>();
      const plateCodes = new Set<string>();
      for (const play of plays) {
        const grade = normalizeAssetCode(play.grade);
        const plate = normalizeAssetCode(play.plate);
        if (grade) {
          gradeCodes.add(grade);
        }
        if (plate) {
          plateCodes.add(plate);
        }
      }

      await Promise.all([
        ...Array.from(gradeCodes).map((grade) =>
          this.ensureAssetImageDownloaded(absoluteUrl(this.baseUrl, `/l_img/grade/${grade}.png`)),
        ),
        ...Array.from(plateCodes).map((plate) =>
          this.ensureAssetImageDownloaded(absoluteUrl(this.baseUrl, `/l_img/plate/${plate}.png`)),
        ),
      ]);
    } catch {
      // Best-effort asset image ensure; ignore write failures.
    }
  }

  private async ensureAssetImageDownloaded(assetUrl: string): Promise<void> {
    let parsed: URL;
    try {
      parsed = new URL(assetUrl);
    } catch {
      return;
    }

    const targetPath = this.resolveAssetOutputPath(parsed);

    const existing = this.assetImageDownloadLocks.get(targetPath);
    if (existing) {
      await existing;
      return;
    }

    const pending = (async () => {
      try {
        await access(targetPath);
        return;
      } catch {
        // File does not exist; continue.
      }
      const buffer = await this.downloadBinaryAsset(assetUrl);
      if (buffer.length === 0) {
        throw new Error(`Asset download returned empty body for ${assetUrl}`);
      }

      const dir = path.dirname(targetPath);
      await mkdir(dir, { recursive: true });

      const tempPath = `${targetPath}.tmp-${process.pid}-${Date.now()}`;
      await writeFile(tempPath, buffer);

      try {
        await rename(tempPath, targetPath);
      } catch {
        await rm(tempPath, { force: true });
      }
    })();

    this.assetImageDownloadLocks.set(
      targetPath,
      pending.finally(() => {
        this.assetImageDownloadLocks.delete(targetPath);
      }),
    );

    const queued = this.assetImageDownloadLocks.get(targetPath);
    if (queued) {
      await queued;
    }
  }

  private resolveAssetOutputPath(parsedUrl: URL): string {
    const decodedPath = decodeURIComponent(parsedUrl.pathname).replace(/^\/+/, "");
    const relativePath = decodedPath.startsWith("data/")
      ? decodedPath.slice("data/".length)
      : decodedPath;

    if (!relativePath || relativePath.includes("..")) {
      throw new Error(`Unsafe output path resolved from URL: ${parsedUrl.toString()}`);
    }

    return path.join(process.cwd(), "data", relativePath);
  }

  private async downloadBinaryAsset(urlText: string): Promise<Buffer> {
    const fallbackToInsecureTls =
      parseBooleanEnv(process.env[TLS_FALLBACK_ENV_KEY]) ?? true;
    const forceInsecureTls = parseBooleanEnv(process.env[INSECURE_TLS_ENV_KEY]) ?? false;

    try {
      return await this.requestBinary(urlText, forceInsecureTls);
    } catch (error) {
      if (
        !forceInsecureTls &&
        fallbackToInsecureTls &&
        isTlsCertificateValidationError(error)
      ) {
        return this.requestBinary(urlText, true);
      }

      throw error;
    }
  }

  private async requestBinary(
    urlText: string,
    useInsecureTls: boolean,
    redirectCount = 0,
  ): Promise<Buffer> {
    if (redirectCount > DEFAULT_REDIRECT_LIMIT) {
      throw new Error(`Too many redirects (>${DEFAULT_REDIRECT_LIMIT}) for ${urlText}`);
    }

    const target = new URL(urlText);
    const useHttps = target.protocol === "https:";
    const client = useHttps ? https : http;

    const response = await new Promise<{
      status: number;
      headers: Record<string, string | string[] | undefined>;
      body: Buffer;
    }>((resolvePromise, rejectPromise) => {
      const request = client.request(
        target,
        {
          method: "GET",
          headers: {
            "user-agent": this.userAgent,
            accept: "image/png,*/*;q=0.8",
            referer: this.baseUrl,
          },
          agent: useHttps
            ? new https.Agent({
                keepAlive: true,
                rejectUnauthorized: !useInsecureTls,
              })
            : new http.Agent({ keepAlive: true }),
        },
        (incoming) => {
          const chunks: Buffer[] = [];
          incoming.on("data", (chunk) => {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
          });
          incoming.on("end", () => {
            resolvePromise({
              status: incoming.statusCode ?? 0,
              headers: incoming.headers,
              body: Buffer.concat(chunks),
            });
          });
          incoming.on("error", rejectPromise);
        },
      );

      const timeout = setTimeout(() => {
        request.destroy(new Error(`Asset request timeout after ${this.timeoutMs}ms for ${urlText}`));
      }, this.timeoutMs);

      request.on("error", (error) => {
        clearTimeout(timeout);
        rejectPromise(error);
      });

      request.on("close", () => {
        clearTimeout(timeout);
      });

      request.end();
    });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.location;
      const first = Array.isArray(location) ? location[0] : location;
      if (!first) {
        throw new Error(`Redirect response missing Location header for ${urlText}`);
      }

      const nextUrl = new URL(first, urlText).toString();
      return this.requestBinary(nextUrl, useInsecureTls, redirectCount + 1);
    }

    if (response.status < 200 || response.status >= 300) {
      throw new Error(`Asset download failed (${response.status}) for ${urlText}`);
    }

    return response.body;
  }

  private async hasKnownSession(username: string): Promise<boolean> {
    if (this.sessions.has(username)) {
      return true;
    }

    if (!this.mongoStorage) {
      return false;
    }

    const stored = await this.mongoStorage.getSession(username);
    return Boolean(stored);
  }

  private async authenticatedRequest(
    username: string,
    options: {
      method: string;
      path: string;
      body?: string;
      headers?: Record<string, string>;
      redirect?: RequestRedirect;
      skipEnsureAuthenticated?: boolean;
    },
  ): Promise<TransportResponse> {
    if (!options.skipEnsureAuthenticated) {
      await this.ensureAuthenticated(username);
    }

    const firstAttempt = await this.requestWithCurrentSession(username, {
      method: options.method,
      path: options.path,
      body: options.body,
      headers: options.headers,
      redirect: options.redirect,
    });

    if (!this.responseSignalsInvalidSession(firstAttempt)) {
      return firstAttempt;
    }

    await this.ensureAuthenticated(username, { force: true });

    const secondAttempt = await this.requestWithCurrentSession(username, {
      method: options.method,
      path: options.path,
      body: options.body,
      headers: options.headers,
      redirect: options.redirect,
    });

    if (!this.responseSignalsInvalidSession(secondAttempt)) {
      return secondAttempt;
    }

    const redirectUrl = this.extractSsoRedirect(secondAttempt);
    if (redirectUrl) {
      throw new SSORequiredError(redirectUrl);
    }

    throw new SessionExpiredError("Session became invalid after automatic reauthentication.");
  }

  private async ensureAuthenticated(username: string, options: EnsureAuthOptions = {}): Promise<void> {
    const lock = this.getLock(username);

    await lock.runExclusive(async () => {
      if (!this.sessions.has(username)) {
        await this.restoreSessionFromMongo(username);
      }

      const existing = this.sessions.get(username);

      if (!options.force && existing && !this.isSessionExpired(existing)) {
        if (
          existing.lastValidatedAt > 0 &&
          Date.now() - existing.lastValidatedAt < SESSION_VALIDATION_COOLDOWN_MS
        ) {
          return;
        }

        const probe = await this.probeSession(username);
        if (probe.valid) {
          existing.lastValidatedAt = Date.now();
          this.sessions.set(username, existing);
          await this.persistSession(username);
          return;
        }

        if (probe.ssoRedirectUrl) {
          const reauthResult = await this.reauthenticate(username);
          if (reauthResult.validated) {
            return;
          }

          const afterReauth = await this.probeSession(username);
          if (afterReauth.valid) {
            return;
          }

          if (afterReauth.ssoRedirectUrl) {
            throw new SSORequiredError(afterReauth.ssoRedirectUrl);
          }

          throw new SessionExpiredError("Session validation failed after reauthentication.");
        }
      }

      const reauthResult = await this.reauthenticate(username);
      if (reauthResult.validated) {
        return;
      }

      const finalProbe = await this.probeSession(username);
      if (finalProbe.valid) {
        return;
      }

      if (finalProbe.ssoRedirectUrl) {
        throw new SSORequiredError(finalProbe.ssoRedirectUrl);
      }

      throw new SessionExpiredError("Reauthentication succeeded but validation still failed.");
    });
  }

  private async reauthenticate(username: string): Promise<ReauthenticationResult> {
    const credentials = this.credentials.get(username);
    if (!credentials) {
      throw new SessionExpiredError(
        `Session for '${username}' is unavailable and no credentials are stored for automatic relogin.`,
      );
    }

    if (await this.trySpeculativeSsoLogin(username, credentials)) {
      return { validated: true };
    }

    let response = await this.sendLoginRequest(username, credentials);
    let redirectLocation = this.extractLocation(response);

    if (redirectLocation && isSsoUrl(redirectLocation)) {
      if (!this.ssoAutoResolve) {
        throw new SSORequiredError(redirectLocation);
      }

      await this.resolveSsoAndHydrateSession(username, redirectLocation);
      const probeAfterSso = await this.probeSession(username);
      if (probeAfterSso.valid) {
        const session = this.sessions.get(username);
        if (session) {
          session.lastValidatedAt = Date.now();
          this.sessions.set(username, session);
          await this.persistSession(username);
        }

        return { validated: true };
      }

      if (probeAfterSso.ssoRedirectUrl) {
        throw new SSORequiredError(probeAfterSso.ssoRedirectUrl);
      }

      if (!probeAfterSso.valid) {
        throw new AuthenticationError(
          "Automatic SSO completed but did not produce an authenticated PIUGAME session.",
        );
      }
    }

    await this.applyLoginResponseToSession(username, response, redirectLocation);
    return { validated: false };
  }

  private async trySpeculativeSsoLogin(
    username: string,
    credentials: Credentials,
  ): Promise<boolean> {
    if (!this.ssoAutoResolve || !this.speculativeSsoBootstrap) {
      return false;
    }

    const redirectUrl = this.buildSsoRedirectUrl(absoluteUrl(this.baseUrl, LOGIN_PATH));
    if (!(await this.tryResolveSsoBootstrapOverHttp(username, redirectUrl))) {
      return false;
    }

    return this.completeLoginWithHydratedSsoSession(username, credentials, {
      rejectAmbiguous: true,
    });
  }

  private buildSsoRedirectUrl(refererUrl: string): string {
    const encodedReferer = Buffer.from(refererUrl, "utf8").toString("base64");
    return `https://api.am-pass.net/sso?referer=${encodeURIComponent(encodedReferer)}`;
  }

  private async sendLoginRequest(
    username: string,
    credentials: Credentials,
  ): Promise<TransportResponse> {
    const form = new URLSearchParams();
    form.set("url", "/");
    form.set("mb_id", credentials.username);
    form.set("mb_password", credentials.password);
    const loginUrl = absoluteUrl(this.baseUrl, LOGIN_PATH);

    const headers = this.buildBrowserNavigationHeaders(loginUrl, {
      contentType: "application/x-www-form-urlencoded",
      referer: absoluteUrl(this.baseUrl, "/"),
    });

    const existingSession = this.sessions.get(username);
    if (existingSession && existingSession.cookies.length > 0) {
      const cookieHeader = this.buildCookieHeader(existingSession, loginUrl);
      if (cookieHeader) {
        headers.cookie = cookieHeader;
      }
    }

    return this.send({
      method: "POST",
      url: loginUrl,
      headers,
      body: form.toString(),
      redirect: "manual",
      timeoutMs: this.timeoutMs,
    });
  }

  private async applyLoginResponseToSession(
    username: string,
    response: TransportResponse,
    redirectLocation: string | null,
  ): Promise<void> {
    if (response.status >= 400) {
      throw new AuthenticationError(`Login request failed with HTTP ${response.status}.`);
    }

    if (redirectLocation && /\/bbs\/login\.php/i.test(redirectLocation)) {
      throw new AuthenticationError("PIUGAME rejected credentials (redirected back to login page).");
    }

    const session = this.sessions.get(username) ?? this.createSession(username);
    this.applySetCookies(
      session,
      getHeaderValues(response.headers, "set-cookie"),
      absoluteUrl(this.baseUrl, LOGIN_PATH),
    );

    if (session.cookies.length === 0) {
      throw new AuthenticationError("Login did not yield usable session cookies.");
    }

    session.lastValidatedAt = Date.now();
    session.expiresAt = this.deriveSessionExpiry(session.cookies);

    this.sessions.set(username, session);
    await this.persistSession(username);
  }

  protected async resolveSsoAndHydrateSession(
    username: string,
    redirectUrl: string,
  ): Promise<void> {
    const credentials = this.credentials.get(username);
    if (!credentials) {
      throw new SSOAutomationError(
        `Cannot resolve SSO for '${username}' because SSO credentials are unavailable.`,
      );
    }

    if (await this.tryResolveSsoBootstrapOverHttp(username, redirectUrl)) {
      await this.completeLoginWithHydratedSsoSession(username, credentials);
      return;
    }

    let playwrightChromium: { launch: (options: { headless: boolean }) => Promise<any> } | null = null;
    try {
      const playwrightModule = await import("playwright");
      const candidate = (playwrightModule as { chromium?: unknown }).chromium;
      if (candidate && typeof candidate === "object" && "launch" in candidate) {
        playwrightChromium = candidate as { launch: (options: { headless: boolean }) => Promise<any> };
      }
    } catch (error) {
      throw new SSOAutomationError(
        "Playwright could not be loaded for automatic SSO resolution.",
        { cause: error },
      );
    }

    if (!playwrightChromium) {
      throw new SSOAutomationError("Playwright chromium launcher is unavailable.");
    }

    let browser: any = null;

    try {
      browser = await playwrightChromium.launch({ headless: this.ssoHeadless });
      const context = await browser.newContext();
      const page = await context.newPage();

      await page.goto(redirectUrl, {
        waitUntil: "commit",
        timeout: this.ssoTimeoutMs,
      });

      const browserCookies = await this.waitForSsoBootstrapCookies(context, page);
      const mappedCookies = this.mapBrowserCookiesToSessionCookies(browserCookies);

      if (mappedCookies.length === 0) {
        throw new SSOAutomationError("Automatic SSO finished without PIUGAME bootstrap cookies.");
      }

      const session = this.sessions.get(username) ?? this.createSession(username);
      session.cookies = mappedCookies;
      session.lastValidatedAt = 0;
      session.expiresAt = this.deriveSessionExpiry(mappedCookies);

      this.sessions.set(username, session);
      await this.persistSession(username);

      await browser.close();
      browser = null;

      await this.completeLoginWithHydratedSsoSession(username, credentials);
    } catch (error) {
      if (error instanceof AuthenticationError || error instanceof SSOAutomationError) {
        throw error;
      }

      throw new SSOAutomationError(
        `Automatic SSO resolution failed for '${username}'.`,
        { cause: error },
      );
    } finally {
      if (browser) {
        await browser.close();
      }
    }
  }

  private async tryResolveSsoBootstrapOverHttp(
    username: string,
    redirectUrl: string,
  ): Promise<boolean> {
    const temporarySession = this.createSession(username);
    let currentUrl = redirectUrl;

    try {
      for (let redirectCount = 0; redirectCount <= DEFAULT_REDIRECT_LIMIT; redirectCount += 1) {
        const headers = this.buildBrowserNavigationHeaders(currentUrl);
        const cookieHeader = this.buildCookieHeader(temporarySession, currentUrl);
        if (cookieHeader) {
          headers.cookie = cookieHeader;
        }

        const response = await this.send({
          method: "GET",
          url: currentUrl,
          headers,
          redirect: "manual",
          timeoutMs: this.timeoutMs,
        });

        this.applySetCookies(
          temporarySession,
          getHeaderValues(response.headers, "set-cookie"),
          currentUrl,
        );

        const baseHostCookies = temporarySession.cookies.filter((cookie) =>
          this.isCookieForBaseHost(cookie.domain),
        );
        if (baseHostCookies.length > 0) {
          const session = this.sessions.get(username) ?? this.createSession(username);
          session.cookies = baseHostCookies;
          session.lastValidatedAt = 0;
          session.expiresAt = this.deriveSessionExpiry(baseHostCookies);

          this.sessions.set(username, session);
          await this.persistSession(username);
          return true;
        }

        if (!isRedirectStatus(response.status)) {
          return false;
        }

        const location = this.extractLocationForRequest(response, currentUrl);
        if (!location) {
          return false;
        }

        currentUrl = location;
      }
    } catch {
      return false;
    }

    return false;
  }

  private async completeLoginWithHydratedSsoSession(
    username: string,
    credentials: Credentials,
    options: {
      rejectAmbiguous?: boolean;
    } = {},
  ): Promise<boolean> {
    const secondLoginResponse = await this.sendLoginRequest(username, credentials);
    const redirectLocation = this.extractLocation(secondLoginResponse);
    await this.applyLoginResponseToSession(
      username,
      secondLoginResponse,
      redirectLocation,
    );
    const confirmed = this.loginResponseConfirmsAuthentication(redirectLocation);
    if (confirmed) {
      return true;
    }

    if (options.rejectAmbiguous && !isSsoUrl(redirectLocation)) {
      throw new AuthenticationError(
        "PIUGAME rejected credentials or did not confirm authentication.",
      );
    }

    return false;
  }

  private loginResponseConfirmsAuthentication(redirectLocation: string | null): boolean {
    if (!redirectLocation) {
      return false;
    }

    return !isSsoUrl(redirectLocation) && !/\/bbs\/login\.php/i.test(redirectLocation);
  }

  private buildBrowserNavigationHeaders(
    requestUrl: string,
    options: {
      contentType?: string;
      referer?: string;
    } = {},
  ): Record<string, string> {
    const origin = originFromBaseUrl(requestUrl);
    const headers: Record<string, string> = {
      accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
      "accept-language": "en-US,en;q=0.9",
      "cache-control": "no-cache",
      pragma: "no-cache",
      "sec-ch-ua": '"Not;A=Brand";v="8", "Chromium";v="150", "Microsoft Edge";v="150"',
      "sec-ch-ua-mobile": "?0",
      "sec-ch-ua-platform": '"macOS"',
      "sec-fetch-dest": "document",
      "sec-fetch-mode": "navigate",
      "sec-fetch-site": "same-origin",
      "sec-fetch-user": "?1",
      "upgrade-insecure-requests": "1",
      "user-agent": this.userAgent === "piugame-sdk/0.1" ? DEFAULT_AUTH_USER_AGENT : this.userAgent,
    };

    if (options.contentType) {
      headers["content-type"] = options.contentType;
      headers.origin = origin;
    }

    if (options.referer) {
      headers.referer = options.referer;
    }

    return headers;
  }

  protected async waitForSsoBootstrapCookies(context: any, page: any): Promise<BrowserCookie[]> {
    const deadline = Date.now() + this.ssoTimeoutMs;

    while (Date.now() < deadline) {
      const cookies = await this.getBaseHostBrowserCookies(context);
      const pageUrl = this.getPageUrl(page);
      if (
        cookies.length > 0 &&
        this.isUrlWithinBaseHost(pageUrl) &&
        !this.isLoginPageUrl(pageUrl)
      ) {
        return cookies;
      }

      await this.waitForSsoPoll(page, deadline);
    }

    throw new SSOAutomationError(
      "Automatic SSO did not return PIUGAME bootstrap cookies before timeout.",
    );
  }

  private async trySubmitSsoCredentials(
    page: any,
    credentials: Credentials,
  ): Promise<SsoSubmitResult> {
    try {
      const loginForm = page.locator("form[action*='login_check.php']").first();
      if ((await loginForm.count()) > 0) {
        const idInForm = loginForm.locator("input[name='mb_id']");
        const pwInForm = loginForm.locator("input[name='mb_password']");

        if ((await idInForm.count()) > 0 && (await pwInForm.count()) > 0) {
          await idInForm.fill(credentials.username, { timeout: 5_000 });
          await pwInForm.fill(credentials.password, { timeout: 5_000 });

          const loginResponse = this.createSsoLoginResponseWait(page);
          await loginForm.evaluate((form: HTMLFormElement) => form.submit());
          return { submitted: true, loginResponse };
        }
      }
    } catch {
      // Continue with generic fallback selectors.
    }

    const usernameSelector = await this.findFirstMatchingSelector(page, SSO_USERNAME_SELECTORS);
    const passwordSelector = await this.findFirstMatchingSelector(page, SSO_PASSWORD_SELECTORS);

    if (!usernameSelector || !passwordSelector) {
      return { submitted: false, loginResponse: null };
    }

    await page.fill(usernameSelector, credentials.username, { timeout: 5_000 });
    await page.fill(passwordSelector, credentials.password, { timeout: 5_000 });

    const submitSelector = await this.findFirstMatchingSelector(page, SSO_SUBMIT_SELECTORS);
    if (submitSelector) {
      const loginResponse = this.createSsoLoginResponseWait(page);
      await page.click(submitSelector, { timeout: 5_000 });
      return { submitted: true, loginResponse };
    }

    const loginResponse = this.createSsoLoginResponseWait(page);
    await page.press(passwordSelector, "Enter", { timeout: 3_000 });
    return { submitted: true, loginResponse };
  }

  protected async waitForSsoEntryReadiness(context: any, page: any): Promise<void> {
    const deadline = Date.now() + this.ssoTimeoutMs;

    while (Date.now() < deadline) {
      if (await this.hasAnyMatchingSelector(page, SSO_ENTRY_SELECTORS)) {
        return;
      }

      const cookies = await this.getBaseHostBrowserCookies(context);
      const pageUrl = this.getPageUrl(page);
      if (
        cookies.length > 0 &&
        this.isUrlWithinBaseHost(pageUrl) &&
        !this.isLoginPageUrl(pageUrl) &&
        await this.hasAnyMatchingSelector(page, SSO_AUTHENTICATED_SELECTORS)
      ) {
        return;
      }

      await this.waitForSsoPoll(page, deadline);
    }

    throw new SSOAutomationError("Automatic SSO did not reach a PIUGAME login form before timeout.");
  }

  protected async waitForSsoSessionReadiness(
    context: any,
    page: any,
    submitted: boolean,
    loginResponse: Promise<void> | null = null,
  ): Promise<BrowserCookie[]> {
    const deadline = Date.now() + this.ssoTimeoutMs;
    let loginResponseSettled = !submitted || !loginResponse;
    const trackedLoginResponse = loginResponse?.then(() => {
      loginResponseSettled = true;
    });

    while (Date.now() < deadline) {
      const pageUrl = this.getPageUrl(page);
      const isLoginPage = this.isLoginPageUrl(pageUrl);
      if (submitted && isLoginPage) {
        throw new AuthenticationError(
          "Automatic SSO credentials were rejected (redirected to login page).",
        );
      }

      const cookies = await this.getBaseHostBrowserCookies(context);
      if (
        cookies.length > 0 &&
        loginResponseSettled &&
        this.isUrlWithinBaseHost(pageUrl) &&
        !isLoginPage &&
        await this.hasAnyMatchingSelector(page, SSO_AUTHENTICATED_SELECTORS)
      ) {
        return cookies;
      }

      const poll = this.waitForSsoPoll(page, deadline);
      if (trackedLoginResponse && !loginResponseSettled) {
        await Promise.race([trackedLoginResponse, poll]);
      } else {
        await poll;
      }
    }

    throw new SSOAutomationError("Automatic SSO finished without PIUGAME session cookies.");
  }

  private createSsoLoginResponseWait(page: any): Promise<void> | null {
    if (typeof page.waitForResponse !== "function") {
      return null;
    }

    return page
      .waitForResponse(
        (response: { request?: () => { method?: () => string }; url?: () => string }) => {
          try {
            return (
              response.request?.().method?.().toUpperCase() === "POST" &&
              /\/bbs\/login_check\.php/i.test(response.url?.() ?? "")
            );
          } catch {
            return false;
          }
        },
        { timeout: Math.min(this.ssoTimeoutMs, 10_000) },
      )
      .then(() => undefined)
      .catch(() => undefined);
  }

  private async waitForSsoPoll(page: any, deadline: number): Promise<void> {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      return;
    }

    const waitMs = Math.min(SSO_READINESS_POLL_MS, remainingMs);
    if (typeof page.waitForTimeout === "function") {
      await page.waitForTimeout(waitMs);
      return;
    }

    await new Promise((resolvePromise) => setTimeout(resolvePromise, waitMs));
  }

  private async getBaseHostBrowserCookies(context: any): Promise<BrowserCookie[]> {
    const cookies = (await context.cookies()) as BrowserCookie[];
    return cookies.filter((cookie) => this.isCookieForBaseHost(cookie.domain));
  }

  private mapBrowserCookiesToSessionCookies(browserCookies: BrowserCookie[]): SessionCookie[] {
    return browserCookies.map((cookie) => ({
      name: cookie.name,
      value: cookie.value,
      domain: cookie.domain,
      path: cookie.path || "/",
      expiresAt:
        Number.isFinite(cookie.expires) && cookie.expires > 0
          ? new Date(cookie.expires * 1000)
          : null,
      secure: Boolean(cookie.secure),
      httpOnly: Boolean(cookie.httpOnly),
    }));
  }

  private getPageUrl(page: any): string {
    try {
      if (typeof page.url === "function") {
        return page.url();
      }
    } catch {
      return "";
    }

    return "";
  }

  private async hasAnyMatchingSelector(page: any, selectors: string[]): Promise<boolean> {
    for (const selector of selectors) {
      try {
        const count = await page.locator(selector).count();
        if (count > 0) {
          return true;
        }
      } catch {
        // Ignore selector failures and continue trying alternatives.
      }
    }

    return false;
  }

  private async findFirstMatchingSelector(page: any, selectors: string[]): Promise<string | null> {
    for (const selector of selectors) {
      try {
        const count = await page.locator(selector).count();
        if (count > 0) {
          return selector;
        }
      } catch {
        // Ignore selector failures and continue trying alternatives.
      }
    }

    return null;
  }

  private isUrlWithinBaseHost(urlText: string): boolean {
    try {
      const baseHost = new URL(this.baseUrl).hostname.toLowerCase();
      const targetHost = new URL(urlText).hostname.toLowerCase();
      if (isKnownPiuHostname(baseHost) && isKnownPiuHostname(targetHost)) {
        return true;
      }

      const normalizedBase = baseHost.startsWith("www.") ? baseHost.slice(4) : baseHost;
      const normalizedTarget = targetHost.startsWith("www.") ? targetHost.slice(4) : targetHost;
      return (
        normalizedTarget === normalizedBase ||
        normalizedTarget.endsWith(`.${normalizedBase}`)
      );
    } catch {
      return false;
    }
  }

  private isCookieForBaseHost(domain: string): boolean {
    try {
      const baseHost = new URL(this.baseUrl).hostname.toLowerCase();
      const normalizedBase = baseHost.startsWith("www.") ? baseHost.slice(4) : baseHost;
      const normalizedDomain = domain.toLowerCase().replace(/^\./, "");
      return (
        normalizedDomain === normalizedBase ||
        normalizedDomain.endsWith(`.${normalizedBase}`) ||
        normalizedBase.endsWith(`.${normalizedDomain}`)
      );
    } catch {
      return false;
    }
  }

  private isLoginPageUrl(urlText: string): boolean {
    try {
      const pathname = new URL(urlText).pathname.toLowerCase();
      return pathname.endsWith("/login.php") || pathname.endsWith("/bbs/login.php");
    } catch {
      return /\/login\.php/i.test(urlText);
    }
  }

  private async probeSession(username: string): Promise<ProbeResult> {
    const session = this.sessions.get(username);
    if (!session || session.cookies.length === 0) {
      return { valid: false, ssoRedirectUrl: null };
    }

    const response = await this.requestWithCurrentSession(username, {
      method: "GET",
      path: AUTH_PROBE_PATH,
      redirect: "manual",
    });

    const ssoRedirect = this.extractSsoRedirect(response);
    if (ssoRedirect) {
      return { valid: false, ssoRedirectUrl: ssoRedirect };
    }

    if (this.responseSignalsInvalidSession(response)) {
      return { valid: false, ssoRedirectUrl: null };
    }

    const looksAuthenticated = /subProfile_wrap|play_data_wrap|profile_name/i.test(response.body);
    if (!looksAuthenticated) {
      return { valid: false, ssoRedirectUrl: null };
    }

    return { valid: true, ssoRedirectUrl: null };
  }

  private responseSignalsInvalidSession(response: TransportResponse): boolean {
    const location = this.extractLocation(response);

    if (isRedirectStatus(response.status)) {
      if (isSsoUrl(location)) {
        return true;
      }

      if (location && /\/bbs\/login\.php/i.test(location)) {
        return true;
      }
    }

    if (response.status === 401 || response.status === 403) {
      return true;
    }

    if (/you must be logged in to use many of pump it up online services/i.test(response.body)) {
      const hasAuthenticatedMarkers =
        /subProfile_wrap|play_data_wrap|profile_name|my_best_score_wrap|recently_playeList/i.test(
          response.body,
        );
      if (!hasAuthenticatedMarkers) {
        return true;
      }
    }

    return false;
  }

  private extractSsoRedirect(response: TransportResponse): string | null {
    const location = this.extractLocation(response);
    if (isSsoUrl(location)) {
      return location as string;
    }

    if (isSsoUrl(response.url)) {
      return response.url;
    }

    return null;
  }

  private extractLocation(response: TransportResponse): string | null {
    return this.extractLocationForRequest(response, this.baseUrl);
  }

  private extractLocationForRequest(
    response: TransportResponse,
    requestUrl: string,
  ): string | null {
    const values = getHeaderValues(response.headers, "location");
    if (values.length === 0) {
      return null;
    }

    const location = values[0];
    if (/^https?:\/\//i.test(location)) {
      return location;
    }

    return new URL(location, requestUrl).toString();
  }

  private async requestWithCurrentSession(
    username: string,
    request: {
      method: string;
      path: string;
      body?: string;
      headers?: Record<string, string>;
      redirect?: RequestRedirect;
    },
  ): Promise<TransportResponse> {
    const session = this.sessions.get(username);
    if (!session || session.cookies.length === 0) {
      throw new SessionExpiredError(`No active session for '${username}'.`);
    }

    const url = absoluteUrl(this.baseUrl, normalizePath(request.path));
    const cookieHeader = this.buildCookieHeader(session, url);

    const headers: Record<string, string> = {
      "user-agent": this.userAgent,
      ...(request.headers ?? {}),
    };

    if (cookieHeader) {
      headers.cookie = cookieHeader;
    }

    const response = await this.send({
      method: request.method,
      url,
      headers,
      body: request.body,
      redirect: request.redirect ?? "manual",
      timeoutMs: this.timeoutMs,
    });

    this.applySetCookies(session, getHeaderValues(response.headers, "set-cookie"), url);
    session.expiresAt = this.deriveSessionExpiry(session.cookies);

    this.sessions.set(username, session);
    await this.persistSession(username);

    if (response.status >= 400) {
      throw new NetworkError(response.status, `${request.method} ${request.path} failed with HTTP ${response.status}.`);
    }

    return response;
  }

  private buildCookieHeader(session: SessionState, requestUrl: string): string {
    const url = new URL(requestUrl);
    const host = url.hostname.toLowerCase();
    const path = url.pathname || "/";
    const isSecure = url.protocol === "https:";

    const validCookies = session.cookies.filter((cookie) => {
      if (cookie.expiresAt && cookie.expiresAt.getTime() <= Date.now()) {
        return false;
      }

      if (cookie.secure && !isSecure) {
        return false;
      }

      const normalizedDomain = cookie.domain.toLowerCase();
      const cleanDomain = normalizedDomain.startsWith(".")
        ? normalizedDomain.slice(1)
        : normalizedDomain;

      const domainMatches =
        host === cleanDomain || host.endsWith(`.${cleanDomain}`);

      if (!domainMatches) {
        return false;
      }

      const cookiePath = cookie.path || "/";
      return path.startsWith(cookiePath);
    });

    return validCookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");
  }

  private applySetCookies(session: SessionState, setCookieHeaders: string[], requestUrl: string): void {
    if (setCookieHeaders.length === 0) {
      return;
    }

    const url = new URL(requestUrl);

    for (const rawCookie of setCookieHeaders) {
      const parsed = this.parseSetCookie(rawCookie, url);
      if (!parsed) {
        continue;
      }

      const index = session.cookies.findIndex((cookie) => {
        return (
          cookie.name === parsed.name &&
          cookie.domain === parsed.domain &&
          cookie.path === parsed.path
        );
      });

      const shouldDelete =
        parsed.value.toLowerCase() === "deleted" ||
        (parsed.expiresAt !== null && parsed.expiresAt.getTime() <= Date.now());

      if (shouldDelete) {
        if (index >= 0) {
          session.cookies.splice(index, 1);
        }
        continue;
      }

      if (index >= 0) {
        session.cookies[index] = parsed;
      } else {
        session.cookies.push(parsed);
      }
    }
  }

  private parseSetCookie(rawCookie: string, requestUrl: URL): SessionCookie | null {
    const pieces = rawCookie.split(";").map((piece) => piece.trim());
    if (pieces.length === 0) {
      return null;
    }

    const [nameValue, ...attributePieces] = pieces;
    const splitIndex = nameValue.indexOf("=");
    if (splitIndex <= 0) {
      return null;
    }

    const name = nameValue.slice(0, splitIndex).trim();
    const value = nameValue.slice(splitIndex + 1).trim();

    let domain = requestUrl.hostname.toLowerCase();
    let path = "/";
    let expiresAt: Date | null = null;
    let secure = false;
    let httpOnly = false;

    for (const attribute of attributePieces) {
      const [rawKey, ...rawValueParts] = attribute.split("=");
      const key = rawKey.trim().toLowerCase();
      const rawValue = rawValueParts.join("=").trim();

      if (key === "domain" && rawValue) {
        domain = rawValue.toLowerCase();
      } else if (key === "path" && rawValue) {
        path = normalizePath(rawValue);
      } else if (key === "expires") {
        expiresAt = parseDate(rawValue);
      } else if (key === "max-age") {
        const seconds = Number(rawValue);
        if (Number.isFinite(seconds)) {
          expiresAt = new Date(Date.now() + seconds * 1000);
        }
      } else if (key === "secure") {
        secure = true;
      } else if (key === "httponly") {
        httpOnly = true;
      }
    }

    return {
      name,
      value,
      domain,
      path,
      expiresAt,
      secure,
      httpOnly,
    };
  }

  private deriveSessionExpiry(cookies: SessionCookie[]): Date | null {
    const now = Date.now();
    const futureExpiries = cookies
      .map((cookie) => cookie.expiresAt)
      .filter((value): value is Date => value !== null && value.getTime() > now)
      .sort((left, right) => left.getTime() - right.getTime());

    if (futureExpiries.length > 0) {
      return futureExpiries[0];
    }

    return new Date(now + SESSION_EXPIRY_FALLBACK_MS);
  }

  private isSessionExpired(session: SessionState): boolean {
    if (!session.expiresAt) {
      return false;
    }

    return session.expiresAt.getTime() <= Date.now();
  }

  private async restoreSessionFromMongo(username: string): Promise<void> {
    if (!this.mongoStorage) {
      return;
    }

    const stored = await this.mongoStorage.getSession(username);
    if (!stored) {
      return;
    }

    this.sessions.set(username, this.fromStoredSession(stored));
  }

  private fromStoredSession(stored: StoredSession): SessionState {
    return {
      username: stored.username,
      cookies: stored.cookies.map(fromSerializableCookie),
      expiresAt: parseDate(stored.expiresAt ?? undefined),
      lastValidatedAt: parseDate(stored.updatedAt)?.getTime() ?? 0,
    };
  }

  private async persistSession(username: string): Promise<void> {
    if (!this.mongoStorage) {
      return;
    }

    const session = this.sessions.get(username);
    if (!session) {
      return;
    }

    await this.mongoStorage.setSession(
      username,
      session.cookies.map(toSerializableCookie),
      session.expiresAt ?? new Date(Date.now() + SESSION_EXPIRY_FALLBACK_MS),
    );
  }

  private createSession(username: string): SessionState {
    return {
      username,
      cookies: [],
      expiresAt: null,
      lastValidatedAt: 0,
    };
  }

  private getLock(username: string): Mutex {
    const existing = this.authLocks.get(username);
    if (existing) {
      return existing;
    }

    const created = new Mutex();
    this.authLocks.set(username, created);
    return created;
  }

  private async send(request: TransportRequest): Promise<TransportResponse> {
    try {
      return await this.transport(request);
    } catch (error) {
      throw new NetworkError(0, `Network request failed for ${request.method} ${request.url}.`, {
        cause: error,
      });
    }
  }

}
