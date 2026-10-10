# HEL-1450: Dev .env secrets printed into an agent transcript via `sbt show Test/envVars`: stop loading prod-grade secrets into test env, and guard against printing it

## Description

Incident (2026-10-09, HEL-1429 lane): the executor ran `sbt "show Test/envVars"` during a baseline run, which printed the local `backend/.env` contents into its tool output (the agent transcript under ~/.claude and /tmp task output). The lane named GOOGLE_CLIENT_SECRET and GCLOUD_DB_PASSWORD as exposed; `.env` also holds ANTHROPIC_API_KEY and CONNECTOR_MASTER_KEY. They are not in any file, commit, log or PR. Rotation is the owner's call (see the driver chat).

Per the driver brief, a second exposure happened on 2026-10-09 via an agent running `source backend/.env` (ticket comment; not directly readable from this session — taken from the driver brief).

## Acceptance criteria

- Explain why tests receive the full `.env` (build.sbt `Test / envVars` loads `.env`) and why local `.env` holds a GCLOUD DB password and a real Anthropic key. Tests should get only what they need: CI already uses fixed test-only values (e.g. CONNECTOR_MASTER_KEY).
- Narrow `Test / envVars` to an allowlist (or test-only values), so printing it can't leak real secrets. Red-first: a test asserting the computed `Test/envVars` contains no key from a denylist (GCLOUD_DB_PASSWORD, GOOGLE_CLIENT_SECRET, ANTHROPIC_API_KEY, …), asserted by KEY NAME only.
- MISTAKES.md entry: never `show Test/envVars` / `printenv` / `env` / `source`/`cat` `.env` in agent sessions; inspect `.env` by key names only.
- File a Concertino (CON) ticket for the same rule in lane-brief guidance.
- Don't change prod secret handling (Secret Manager via infra/deploy-backend.sh).
- Driver scope addition: HEL-1454 item 3 (`backend/.env` silently overrides a shell-exported `HELIO_OWNER_EMAILS` for `sbt run`) is the same mechanism — include if it falls out naturally.
- Whether GCLOUD_DB_PASSWORD should leave the owner's `.env` is an OWNER action, escalated, never performed by the lane.

## Absolute rule

Never print, cat, source, grep-with-values, `show Test/envVars`, `printenv`, `env`, or otherwise echo the contents of `backend/.env` or any secret. Inspect `.env` only by KEY NAMES, e.g. `sed -E 's/=.*//' backend/.env`. Tests that need to prove a value is absent must assert on key names or on a hash, never print the value.
