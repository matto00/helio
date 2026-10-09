## Why

On 2026-10-09 the dev box (12 threads, 62 GB) hit a global OOM with 3 concertino lanes running: two husky
pre-commit `npm test` runs plus a build. Local jest/Playwright/sbt defaults scale with core count and RAM, so three
lanes multiply an already-large per-lane footprint. The owner ruled that CI's worker counts become a permanent hard
cap for local development, sized so 3 lanes run comfortably, with production untouched.

## What Changes

- Root and frontend jest configs: when `CI` is unset, cap `maxWorkers` (at or below CI's effective 3), set
  `workerIdleMemoryLimit`, and move the jest cache off tmpfs `/tmp` if measurement attributes the incident's shmem
  to it. With `CI` set, the effective config is unchanged.
- `playwright.config.ts`: local `workers` capped at or below CI's 2 (today `undefined` = 50% of cores).
- `backend/build.sbt`: when `CI` is unset, give forked test JVMs and `sbt run`'s forked JVM an explicit `-Xmx`
  (today they inherit the JVM default of 1/4 physical RAM); forked-group concurrency stays at or below CI's 2.
- A one-off override per cap (env var), documented.
- Docs: CONTRIBUTING.md/CLAUDE.md (caps + override), MISTAKES.md (the incident and what actually consumed memory).
- Measured before/after peak RSS + shmem for one lane, a 3-lane simulation or justified extrapolation, and the
  wall-clock cost of the caps.

## Capabilities

### New Capabilities
- `local-dev-resource-caps`: local (non-CI) test and dev entry points run within fixed worker/heap caps no larger
  than CI's, overridable for a one-off run, without changing CI's or production's behaviour.

### Modified Capabilities

## Non-goals

- Any change to CI's effective settings, the Dockerfile, Cloud Run flags, prod `application.conf`, or the frontend
  build output.
- Editing `scripts/concertino/*` (render target) — needed changes there become CON tickets.
- Cleaning up existing `/tmp` contents or caches on the box.

## Impact

`jest.config.cjs`, `frontend/jest.config.cjs`, `playwright.config.ts`, `backend/build.sbt` (Test/run settings only),
helio-mcp test config if it has its own jest entry point, CONTRIBUTING.md, CLAUDE.md, MISTAKES.md.
