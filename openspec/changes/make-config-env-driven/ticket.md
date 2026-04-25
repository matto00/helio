# HEL-120: Make port and all config env-driven

## Title
Make port and all config env-driven

## Description
Read `PORT` env var in the app entry point, fall back to 8080 for local dev. Cloud Run injects `PORT` and expects the container to bind to it. Also read DB connection details, log level, and CORS allowed origins from env.

## Acceptance Criteria
- The backend reads `PORT` from the environment and falls back to 8080 if not set
- DB connection details (host, port, database name, user, password) are read from env vars
- Log level is configurable via env var
- CORS allowed origins are configurable via env var
- Local dev continues to work without setting any env vars (sensible defaults for all values)
- The `.env` file approach for local dev is preserved/supported

## Context
- Parent: HEL-81 (Deployment milestone)
- Priority: High
- Project: Deployment / Setup milestone
- Cloud Run deployment requires PORT binding from env injection
