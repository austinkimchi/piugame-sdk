# PIUGame SDK

TypeScript-first Node.js SDK for PIUGAME session auth, SSO handling, and play-data scraping.

## Features

- Login/logout with automatic session reuse
- Automatic session validation + relogin
- Automatic AM-PASS SSO resolution (Playwright, headless-first)
- Typed APIs for:
  - player data
  - recent plays
  - titles
  - full best-score history (paged)
- Optional MongoDB persistence for:
  - session cookies (TTL)
  - response cache (TTL)
- Multi-user support (per-username sessions, locks, and cache keys)

## Install

```bash
npm install piugame-sdk
```

For SSO automation:

```bash
npx playwright install chromium
```

## Quick Start (`PiuClient`)

```ts
import { PiuClient } from "piugame-sdk";

const client = new PiuClient();

await client.login("username", "password");
const profile = await client.getPlayerData("username");
console.log(profile.gameIdTag, profile.rating);
```

## Environment Variables (Common)

- `PIU_INSECURE_TLS=1` (optional): disable TLS cert verification globally in SDK defaults
- `PIU_TLS_FALLBACK_INSECURE=1` (optional): allow TLS fallback retry when cert validation fails
- `PIU_SONG_MAP_ENABLE=1` (optional): persist `songName -> song_img` mappings from recent plays to `data/song-map.json`
- `PIU_SONG_MAP_AUTO_FETCH=1` (optional): when `PIU_SONG_MAP_ENABLE=1`, auto-download newly discovered song jacket PNGs to `data/song_img/`
- `PIU_ASSET_MAP_ENABLE=1` (optional): persist global asset maps to `data/avatar-map.json`, `data/grade-map.json`, and `data/plate-map.json`, and auto-recover referenced avatar/grade/plate PNGs under `data/`
  - Grade map stores both normalized code keys (example: `aa_p`) and display alias keys (example: `AA+`)
- `PIU_MONGO_URI` or `MONGODB_URI` (optional): used by one-time scripts that seed MongoDB data
- `PIU_TEST_USERNAME`, `PIU_TEST_PASSWORD` (tests/examples)
- `PIU_TEST_SSO_USERNAME`, `PIU_TEST_SSO_PASSWORD` (optional override if SSO creds differ)

## API

### `PiuClient`

- `login(username, password)`
- `logout(username)`
- `getPlayerData(username)`
- `getRecentPlays(username)`
- `getTitle(username)`
- `refresh(username)`
- `fetchAllPlays(username)`
- `setDatabase(mongoUri)`
- `setSsoCredentials(username, ssoUsername, ssoPassword)`

### Top-level wrappers

Also exported for convenience:

- `login`, `logout`, `get_player_data`, `get_recent_plays`, `get_title`, `refresh`, `fetch_all_plays`, `set_database`, `set_sso_credentials`

## SSO Behavior

When PIUGAME redirects to AM-PASS SSO:

1. SDK attempts browser-driven SSO resolution (Playwright)
2. Extracts PIUGAME cookies from browser context
3. Reuses those cookies in HTTP session flow

If SSO cannot be resolved, typed errors are thrown:

- `SSORequiredError`
- `SSOAutomationError`
- `AuthenticationError`

## MongoDB Cache + Session Persistence

Enable once:

```ts
await client.setDatabase("mongodb://127.0.0.1:27017");
```

Stored collections:

- `piugame_sdk.sessions`
  - keyed by `username`
  - TTL index on `expiresAt`
- `piugame_sdk.cache`
  - keyed by cache key (`username:endpoint[:suffix]`)
  - TTL index on `expiresAt`

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

## One-Time Song Catalog Seed

Build MongoDB `song_catalog` from `scraped/SONG_LIST_042026.php`:

```bash
npm run build
npm run seed:song-catalog
```

Optional overrides:

- `--input path/to/file.php`
- `--input path/to/file-a.php --input path/to/file-b.php`
- `--inputs path/to/file-a.php,path/to/file-b.php`
- `--db piugame_sdk`
- `--collection song_catalog`
- `--mongo-uri mongodb://127.0.0.1:27017`
- `--allow-skipped-rows`
- `--dry-run`

Multiple input files are merged into one catalog build before Mongo upsert, so you can combine incomplete snapshots.

## Song Series Labeling Pipeline

Build Namu reference rows and assign series labels to existing `song_catalog` documents.

Series values used in storage:

- `1st`
- `NX`
- `FIESTA`
- `PRIME`
- `PRIME2`
- `XX`
- `PHOENIX`

### 1) Seed reference rows

```bash
npm run build
npm run seed:series-reference
```

Defaults:

- primary input: `scraped/Pump It Up_Songs - NamuWiki.html`
- secondary input: `scraped/Pump It Up PHOENIX - NamuWiki.html`
- collection: `piugame_sdk.song_catalog_series_reference`

Options:

- `--primary-input path/to/file.html`
- `--secondary-input path/to/file.html`
- `--db piugame_sdk`
- `--collection song_catalog_series_reference`
- `--mongo-uri mongodb://127.0.0.1:27017`
- `--dry-run`

### 2) Assign series labels to catalog

```bash
npm run assign:song-series
```

Defaults:

- catalog: `piugame_sdk.song_catalog`
- references: `piugame_sdk.song_catalog_series_reference`
- manual overrides: `piugame_sdk.song_catalog_series_overrides`
- unresolved report file: `output_data/song-series-unresolved.json`

Updated fields on `song_catalog`:

- `series`
- `seriesSource`
- `seriesRule`
- `seriesConfidence`
- `seriesAssignedAt`

Options:

- `--catalog-collection song_catalog`
- `--reference-collection song_catalog_series_reference`
- `--override-collection song_catalog_series_overrides`
- `--unresolved-output output_data/song-series-unresolved.json`
- `--refresh-reference` (rebuild references from HTML and upsert before assignment)
- `--mongo-uri mongodb://127.0.0.1:27017`
- `--dry-run`

## Development

```bash
npm run build
npm run test
```
