## Why

A self-registered `free`-tier account can call `POST /api/authoring/dashboard` and `POST /api/refinements`, both of
which reach `ClaudeClient` on the production API key, with no tier check and no daily-usage accounting. The workspace
assistant and pipeline AI steps are already gated (HEL-703, HEL-1108); these two routes were missed.

## What Changes

- Gate `POST /api/authoring/dashboard` (buffered and `?stream=true`) and `POST /api/refinements` through the existing
  `ChatAccessService` tier + beta daily-cap mechanism: `free` gets 403 `TIER_FORBIDDEN`, `beta` is counted against the
  shared `assistant_daily_usage` counter and gets 429 `CHAT_LIMIT_REACHED` past the limit, `owner` is unlimited.
- Wire shape is identical to the assistant's (`TierErrorResponse`: `code`, `message`, optional `limit`).
- A missing `ANTHROPIC_API_KEY` still yields 503 (the 503 check runs before the gate, so it never charges).
- Surface 403/429 in the refinement UI (the only frontend caller) and document the codes in the helio-mcp
  `propose_patch_set` tool copy, probed live.
- Sweep of every `ClaudeClient` construction/caller, classified gated/ungated in design.md.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `tier-gated-assistant-access`: ADDED requirement that the authoring and refinement routes enforce the same tier gate
  and shared daily cap as the assistant.

## Impact

- Backend: `ChatAccessService` (one new combined entry point), `DashboardAuthoringRoutes`, `RefinementRoutes`,
  `ApiRoutes` wiring, and their specs. No migration.
- Frontend: `features/dashboards` refinement error rendering. helio-mcp: `propose_patch_set` tool description.

## Non-goals

- Removing `/api/authoring/dashboard` (no frontend/MCP caller exists; removal is a scope decision reserved for the
  owner, so it is gated here instead).
- Changing the beta limit, the tier model, or the general `/api` rate limiter.
- IP-based limiting for unauthenticated callers (HEL-837).
