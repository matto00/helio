## Why

`backend/build.sbt` copies every line of the developer's `backend/.env` into both the forked test JVMs (`Test / envVars`) and the forked `sbt run` JVM (`Compile / run / envVars`). That `.env` holds real credentials (Google OAuth secret, Anthropic key, a Cloud SQL password no code reads, the dev connector master key), so any agent that runs `sbt "show Test/envVars"` prints them into a transcript — which happened on 2026-10-09 (HEL-1429 lane), followed the same night by a `source backend/.env` exposure. Tests never needed those values: CI runs the whole backend suite with only fixed, test-only `CONNECTOR_MASTER_KEY`/`_ID` values.

## What Changes

- Forked test JVMs no longer read `backend/.env` at all. `Test / envVars` becomes a fixed set of test-only values (the same public CI test `CONNECTOR_MASTER_KEY`/`_ID` the `backend` CI job uses), so `show Test/envVars` can print nothing secret.
- `sbt run` keeps loading `backend/.env` (the local dev server needs Google OAuth, Anthropic, connector key, owner emails, DB URL) but (a) drops keys on an explicit never-forward list (`GCLOUD_DB_PASSWORD` — read by no backend code), and (b) never overrides a variable already exported in the sbt process's own environment (HEL-1454 item 3: shell `HELIO_OWNER_EMAILS` now wins).
- The env-selection logic moves into a pure, sbt-free object under `backend/project/`, unit-tested red-first by a ScalaTest spec that asserts on KEY NAMES only (and a value hash where a value must be proven absent), using a fixture `.env` with dummy values — never the developer's real file.
- A key-names-only sbt check task reports which keys the live `Test / envVars` and `Compile / run / envVars` carry, so humans and agents have a safe alternative to `show`.
- `MISTAKES.md`: a new entry — never `show Test/envVars`, `printenv`, `env`, `cat`/`source` `.env`; inspect by key name.
- A Concertino ticket for the same rule in lane-brief guidance.
- Unchanged: production secret handling (Secret Manager via `infra/deploy-backend.sh`), CI workflow env, and the owner's `.env` file (removing `GCLOUD_DB_PASSWORD` from it is an owner action, escalated separately).

## Capabilities

### New Capabilities
- `local-dev-env-loading`: what the local build forwards from `backend/.env` (and the shell) into forked test JVMs and the forked dev server, and the guarantee that test env carries no developer secrets.

### Modified Capabilities
<!-- none -->

## Impact

- `backend/build.sbt` (env wiring around L140), new `backend/project/DevEnv*.scala`, new test spec under `backend/src/test/scala/...`, a fixture file.
- `MISTAKES.md`, possibly `CLAUDE.md`/`.env.example` comments.
- Local developers: tests that silently depended on a `.env` value now get only the fixed test values (CI already proves the suite passes with exactly these). A shell-exported var now beats `.env` for `sbt run`; sbt 2's long-lived server captures its environment at server start, so a newly exported var needs a server restart (documented).
- No production, CI-workflow, schema, or API change.
