export type EndpointName =
  | "player_data"
  | "recent_plays"
  | "title"
  | "best_score_page";

export interface CacheTtlConfig {
  playerDataMs: number;
  recentPlaysMs: number;
  titleMs: number;
  bestScorePageMs: number;
}

export interface PiuClientOptions {
  baseUrl?: string;
  timeoutMs?: number;
  cacheTtl?: Partial<CacheTtlConfig>;
  userAgent?: string;
  rejectUnauthorized?: boolean;
  allowInsecureTlsFallback?: boolean;
  ssoAutoResolve?: boolean;
  ssoHeadless?: boolean;
  ssoTimeoutMs?: number;
  transport?: HttpTransport;
}

export interface PlateCounts {
  [plateCode: string]: number;
}

export interface PlayerData {
  username: string;
  titleName: string | null;
  gameIdTag: string | null;
  gameId: string | null;
  gameTag: string | null;
  avatarUrl: string | null;
  pp: number | null;
  lastAccess: string | null;
  recentArcade: string | null;
  playCount: number | null;
  rating: number | null;
  clear: {
    cleared: number | null;
    total: number | null;
    raw: string | null;
  };
  progressPercent: number | null;
  plateCounts: PlateCounts;
}

export interface JudgmentCounts {
  perfect: number | null;
  great: number | null;
  good: number | null;
  bad: number | null;
  miss: number | null;
}

export interface RecentPlay {
  songName: string;
  songImageUrl: string | null;
  mode: string | null;
  level: number | null;
  score: number | null;
  grade: string | null;
  plate: string | null;
  stageBreak: boolean;
  judgments: JudgmentCounts;
  playedAt: string | null;
}

export interface TitleEntry {
  name: string;
  description: string | null;
  className: string;
  owned: boolean;
  locked: boolean;
  inUse: boolean;
  settable: boolean;
  unlockable: boolean;
  statusText: string | null;
}

export interface BestPlay {
  songName: string;
  mode: string | null;
  level: number | null;
  score: number | null;
  grade: string | null;
  plate: string | null;
  page: number;
}

export interface BestScorePage {
  page: number;
  total: number | null;
  lastPage: number | null;
  plays: BestPlay[];
}

export interface FetchAllPlaysResult {
  username: string;
  total: number | null;
  totalPages: number;
  pagesFetched: number[];
  plays: BestPlay[];
}

export interface TransportRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: string;
  redirect?: RequestRedirect;
  timeoutMs?: number;
}

export interface TransportResponse {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
  url: string;
}

export type HttpTransport = (
  request: TransportRequest,
) => Promise<TransportResponse>;

export interface SerializableCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  expiresAt: string | null;
  secure: boolean;
  httpOnly: boolean;
}

export interface StoredSession {
  username: string;
  cookies: SerializableCookie[];
  expiresAt: string | null;
  updatedAt: string;
}
