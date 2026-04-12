# PIUGame SDK Examples

This folder contains practical usage examples of the SDK.

## Files

- `basic-api.ts`: Uses `PiuClient` for login + basic profile/recent/title reads.
- `client-refresh-and-history.ts`: Uses `PiuClient` directly with `refresh` and `fetchAllPlays`.
- `mongo-cache.ts`: Demonstrates optional MongoDB session/cache persistence.

## Environment

Set these variables in `.env`:

- `PIU_TEST_USERNAME`
- `PIU_TEST_PASSWORD`
- `PIU_TEST_SSO_USERNAME` (optional)
- `PIU_TEST_SSO_PASSWORD` (optional)
- `PIU_INSECURE_TLS` (optional, `1` only if your environment cannot validate PIUGAME TLS cert chain)
- `PIU_MONGO_URI` (only for `mongo-cache.ts`)

## Notes

- These examples import from `../src` for local development in this repository.
- For published package usage, change imports to `piugame-sdk`.
- Automatic SSO resolution needs Playwright browser binaries. If missing, run `npx playwright install chromium`.
