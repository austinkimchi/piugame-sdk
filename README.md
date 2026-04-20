# PIUGame SDK

SDK package for Pump It Up (ANDAMIRO).

## Features

- Login/logout with session reuse
- Automatic session validation + relogin
- Typed APIs for:
  - player data
  - recent plays
  - top pumbility-contributing plays
  - titles
  - top score history
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
## API

### `PiuClient`

- `login(username, password)`
- `logout(username)`
- `getPlayerData(username)`
- `getRecentPlays(username)`
- `getTopPlays(username)`
- `getTitle(username)`
- `refresh(username)`
- `fetchAllPlays(username)`
- `setDatabase(mongoUri)`

### Top-level wrappers

Also exported for convenience:

- `login`, `logout`, `get_player_data`, `get_recent_plays`, `get_top_plays`, `get_title`, `refresh`, `fetch_all_plays`, `set_database`

## MongoDB Cache + Session Persistence

For session persistence, set `MONGODB_URI`.

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

## Development

```bash
npm run build
npm run test
```

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


