## Why

The backend currently hard-codes port 8080 and reads DB credentials only from a `.env` file, which prevents Cloud Run deployment. Cloud Run injects `PORT` at runtime and expects the container to bind to it; without reading it from the environment the service fails to start.

## What Changes

- Read `PORT` env var in the Akka HTTP server entry point; default to `8080`
- Read DB connection details (`DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`) from env vars with sensible local-dev defaults
- Read `LOG_LEVEL` env var to control Akka/root log level; default to `INFO`
- Read `CORS_ALLOWED_ORIGINS` env var (comma-separated) for allowed origins; default to `http://localhost:5173`
- Local dev continues to work via `.env` file (dotenv loading is preserved)

## Capabilities

### New Capabilities

- `backend-env-config`: All runtime configuration (port, DB, log level, CORS origins) is sourced from environment variables with local-dev defaults

### Modified Capabilities

<!-- None — no existing spec-level requirements change -->

## Impact

- `backend/src/main/scala/helio/Main.scala` (or server entry point) — port binding
- `backend/src/main/resources/application.conf` — DB and Akka config wired to env vars
- `.env.example` — document all new env vars
- No API contract changes; no frontend changes required

## Non-goals

- Secret management / vault integration
- Kubernetes ConfigMap or Helm values
- Runtime config reloading without restart
