# PIUGame SDK

[![CI](https://github.com/austinkimchi/piugame-sdk/actions/workflows/ci.yml/badge.svg)](https://github.com/austinkimchi/piugame-sdk/actions/workflows/ci.yml)
[![Node.js >=18](https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-blue.svg)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

SDK package for Pump It Up (ANDAMIRO).

## Features

- Login/logout with session reuse
- Automatic session validation + relogin
- Typed APIs for:
  - player data
  - recent plays
  - top pumbility-contributing plays
  - titles
  - title updates
  - top score history
- Optional MongoDB persistence for:
  - session cookies (TTL)
  - response cache (TTL)
  - title catalog metadata
- Multi-user support (per-username sessions, locks, and cache keys)

## Install

```bash
npm install piugame-sdk
```

## Quick Start (`PiuClient`)

```ts
import { PiuClient } from "piugame-sdk";

const client = new PiuClient();

await client.login("username", "password");
const profile = await client.getPlayerData("username");
console.log(profile.gameIdTag, profile.rating);
```

By default, `PiuClient` queries PHOENIX on `https://phoenix.piugame.com`.
To query PHOENIX 2 on the main PIUGAME domain:

```ts
const client = new PiuClient({ version: "phoenix2" });
```

Advanced callers can still pass `baseUrl` directly; when provided, it overrides `version`.

## API

### `PiuClient`

- `login(username, password)`
- `logout(username)`
- `getPlayerData(username)`
- `getRecentPlays(username)`
- `getTopPlays(username)`
- `getTitle(username)`
- `setTitle(username, titleName)`
- `refresh(username)`
- `fetchAllPlays(username)`
- `setDatabase(mongoUri)`

`fetchAllPlays` fetches detected score pages concurrently. The default is bounded at 8 requests; tune it with `new PiuClient({ fetchAllPlaysConcurrency: 4 })` if you want a gentler crawl.

### Top-level wrappers

Also exported for convenience:

- `login`, `logout`, `get_player_data`, `get_recent_plays`, `get_top_plays`, `get_title`, `set_title`, `refresh`, `fetch_all_plays`, `set_database`

## MongoDB Cache + Session Persistence

For session persistence, set `MONGODB_URI`.

Stored collections:

- `piugame_sdk.sessions`
  - keyed by `username`
  - TTL index on `expiresAt`
- `piugame_sdk.cache`
  - keyed by cache key (`username:endpoint[:suffix]`)
  - TTL index on `expiresAt`
- `piugame_sdk.titles`
  - keyed by normalized title name
  - stores title name, unlock description, and last update time
  - no TTL; refreshed from freshly scraped title pages

### Multi-user / concurrency

Already supported:

- Session state is per username
- Auth lock is per username (prevents relogin storms)
- Cache keys are username-scoped
- Mongo session docs are username-scoped

So concurrent calls across multiple users are isolated.

## Examples

See `example/`:

- `basic-api.ts`
- `client-refresh-and-history.ts`
- `mongo-cache.ts`

## Development

```bash
npm run build
npm run test
```

## Song Media Collection

The media collector targets `piugame_sdk.song_catalog_2` by default.

```bash
npm run collect:media:audio
npm run collect:media:youtube-index
npm run collect:media:youtube
npm run collect:media:youtube-reconcile
npm run collect:media:youtube-backfill -- --youtube-search-budget=25
npm run review:media-ui
```

- Audio previews are crawled from PumpPro+ with Playwright/Chromium and written to each song as `audioPreview`.
- YouTube chart videos are searched in priority order: Nevsister, Pump It Up Official, then general YouTube. General or ambiguous matches are marked for review.
- YouTube channel videos are first cached from the YouTube Data API. Set `YOUTUBE_API_KEY` in `.env` before running `collect:media:youtube-index`.
- General YouTube fallback search is disabled unless `--youtube-search-fallback` is passed; `youtube-backfill` enables a song-level fallback automatically and reuses one search across that song's missing chart tokens. Cap it with `--youtube-search-budget` to protect the 100/day search quota.
- `youtube-reconcile` removes non-manual auto links whose video title does not contain the chart token, refreshes match statuses from `chartsFull[].links`, and deletes stale YouTube match rows for charts no longer in the catalog.
- Per-chart general search remains disabled unless `--youtube-chart-search-fallback` is passed.
- Chart links are written to the matching `chartsFull[]` entry by `token` as an ordered `links` array.
- Raw matches and review state are stored in `song_catalog_2_media_matches`; YouTube channel cache is stored in `song_catalog_2_youtube_videos`; manual UI overrides are stored in `song_catalog_2_media_overrides`.
- The media review UI supports dragging local audio files onto an audio item; uploads are copied to `data/audio_previews/manual/` and saved as a manual audio override.
- Useful flags: `--phase=audio|youtube-index|youtube|youtube-reconcile|youtube-backfill|all`, `--dry-run`, `--max-pages=20`, `--limit-charts=100`, `--youtube-search-fallback`, `--youtube-search-budget=25`, `--youtube-chart-search-fallback`, `--download-audio`, `--show-browser`, `--playwright-timeout-ms=45000`.

## Environment Variables (For Development)

- `PIU_TEST_USERNAME`, `PIU_TEST_PASSWORD` (required for tests/examples)

- `PIU_INSECURE_TLS=1`: disable TLS cert verification globally in SDK defaults
- `PIU_TLS_FALLBACK_INSECURE=1`: allow TLS fallback retry when cert validation fails
- `PIU_SONG_ASSET_ENABLE=1`: ensure song jacket PNGs referenced by recent plays exist under `data/song_img/` (download only when missing)
- `PIU_PROFILE_ASSET_ENABLE=1`: ensure profile avatar PNGs referenced by player-data responses exist under `data/avatar_img/`
- `PIU_GRADE_PLATE_ASSET_ENABLE=1`: ensure grade/plate PNGs referenced by recent and best-play responses exist under `data/l_img/`
- `PIU_SONG_MAP_ENABLE=1`, `PIU_SONG_MAP_AUTO_FETCH=1`: backward-compatible aliases for song-jacket ensure mode
- `PIU_ASSET_MAP_ENABLE=1`: backward-compatible aggregate fallback for profile avatar plus grade/plate asset ensure mode; explicit split flags above override it
- `PIU_MONGO_URI` or `MONGODB_URI`: used by one-time scripts that seed MongoDB data

## License

MIT. See [LICENSE](LICENSE).
