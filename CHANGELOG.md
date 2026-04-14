# Changelog

## 1.0.0

- Breaking: removed `PiuClient#setSsoCredentials(username, ssoUsername, ssoPassword)`.
- Breaking: removed top-level `set_sso_credentials(...)` export.
- SSO automation now always uses credentials passed to `login(username, password)`.
- Migration: delete `setSsoCredentials(...)` calls and use `login(...)` credentials for both PIUGAME and AM-PASS SSO.
