## Why

The live draft preview evaluates most steps in the browser (HEL-1581), but server-only kinds (`chunkbytokencount`,
`convertformat`) and configs `clientEvaluable` declines need a server fallback. Today's preview runs only the saved config,
re-reads the source and sits in the general `/api` bucket, so a drag would starve the page (`docs/live-draft-preview.md` §6).

## What Changes

- New `POST /api/pipelines/:id/draft-preview`: evaluates draft step configs over client-supplied frames and streams NDJSON
  (`step` / `unavailable` / `error` lines per step, then one final `rows` line). Never reads a data source, never calls the
  AI client, never touches the HEL-505 run guard or run history.
- Owner-or-editor only (viewer 403); the HEL-1516 access re-check runs before every evaluation.
- Body caps (rows and bytes) with a JSON 413; request rows never logged.
- Its own `RateLimitDirective` instance and env var `DRAFT_PREVIEW_RATE_LIMIT_PER_WINDOW` (default 120 per
  `RATE_LIMIT_WINDOW_SECONDS`), and a path exemption inside the general `/api` directive so the general bucket is untouched.
  CSRF and `confineScopedToken` still apply.
- Server observes client abort and stops evaluating further steps.
- Frontend client (`draftPreviewClient`): fetch + `ReadableStream` NDJSON reader, single-flight `AbortController`,
  trailing debounce and send floor. Not wired into UI (HEL-1631).
- JSON Schemas for the request and each NDJSON line type, with seam tests on both sides.

## Capabilities

### New Capabilities
- `pipeline-draft-preview-api`: the draft-preview endpoint, its stream contract, access, caps and guarantees.
- `pipeline-draft-preview-client`: the client's stream reader, single-flight and send pacing.

### Modified Capabilities
- `rate-limiting-directive`: the general directive can exempt a route that carries its own limiter.

## Non-goals

- Wiring into the draft UI (HEL-1631), Output render from draft rows (HEL-1632).
- Previewing AI steps or anything downstream of them (ruling F).
- Reading any source server-side, including partially cached secondaries (owner ruling 2).
- Cross-instance limiting (in-memory per instance, like every other limiter); IP keying (HEL-837).

## Impact

Backend: `ApiRoutes`, `RateLimitDirective`, new route/service under `pipelines/draft`, engine context hook.
Frontend: `features/pipelines/services`. `schemas/pipelines/`. `CLAUDE.md` env table. No migration.
