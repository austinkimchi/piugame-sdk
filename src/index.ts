import { PiuClient } from "./client";
import type {
  FetchAllPlaysResult,
  PlayerData,
  RecentPlay,
  TopPlay,
  TitleEntry,
} from "./types";

export { PiuClient } from "./client";
export {
  AuthenticationError,
  NetworkError,
  ParseError,
  PiuError,
  SSOAutomationError,
  SessionExpiredError,
  SSORequiredError,
} from "./errors";
export type {
  BestPlay,
  BestScorePage,
  CacheTtlConfig,
  EndpointName,
  FetchAllPlaysResult,
  HttpTransport,
  JudgmentCounts,
  PiuClientOptions,
  PlayerData,
  RecentPlay,
  SerializableCookie,
  StoredSession,
  TopPlay,
  TitleEntry,
  TransportRequest,
  TransportResponse,
} from "./types";

const defaultClient = new PiuClient();

export async function set_database(mongoURI: string): Promise<void> {
  await defaultClient.setDatabase(mongoURI);
}

export async function login(username: string, password: string): Promise<void> {
  await defaultClient.login(username, password);
}

export function set_sso_credentials(
  username: string,
  ssoUsername: string,
  ssoPassword: string,
): void {
  defaultClient.setSsoCredentials(username, ssoUsername, ssoPassword);
}

export async function logout(username: string): Promise<void> {
  await defaultClient.logout(username);
}

export async function get_player_data(username: string): Promise<PlayerData> {
  return defaultClient.getPlayerData(username);
}

export async function get_recent_plays(username: string): Promise<RecentPlay[]> {
  return defaultClient.getRecentPlays(username);
}

export async function get_top_plays(username: string): Promise<TopPlay[]> {
  return defaultClient.getTopPlays(username);
}

export async function get_title(username: string): Promise<TitleEntry[]> {
  return defaultClient.getTitle(username);
}

export async function refresh(username: string): Promise<PlayerData> {
  return defaultClient.refresh(username);
}

export async function fetch_all_plays(username: string): Promise<FetchAllPlaysResult> {
  return defaultClient.fetchAllPlays(username);
}
