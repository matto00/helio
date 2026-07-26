## Why

`helio-news` (and future scheduled workflows) authenticate to Helio with a full-access PAT handed
to an MCP process over stdio. There is no way to mint a credential that can *only* trigger a
specific pipeline rebuild, no stable HTTP entrypoint an external scheduler can call, and no audit
trail tying an external rebuild to the credential that launched it. This is the trigger + auth half
of the external-automation story (HEL-340 owns the scheduler itself).

## What Changes

- Extend `api_tokens` with an optional `scoped_pipeline_ids` allow-list. Absent = today's
  full-access PAT (unchanged). Present = the token is restricted to **only** calling the new hook
  endpoint, and only for pipelines in its list — least privilege without a general permission system.
- Add `POST /api/hooks/run` (body `{ "pipelineId": "<id>" }`), authenticated by session or PAT
  (scoped or unscoped), returning `{ runId, pipelineId, status }`. Delegates to the existing
  `PipelineRunService.submit(..., triggerSource = TriggerSource.External)` — the same
  run-lifecycle path the HEL-415/417 scheduler uses — rather than a second one.
- Record `triggered_by_token_id` on `pipeline_runs` for external-triggered rows, readable via the
  existing `GET /api/pipelines/:id/run-history`.
- `CreateApiTokenRequest` gains an optional `scopedPipelineIds` field; `ApiTokenResponse` surfaces it
  read-only for audit/visibility.
- Docs: `docs/agent-native.md` gains a section on minting a scoped token and wiring an external
  scheduler to the hook endpoint.

## Non-goals

- No general resource/verb permission system — scope is a single capability (`hooks:run`) plus a
  pipeline allow-list, nothing more granular.
- No rate limiting or replay-window enforcement — documented as a known exposure (revocation +
  narrow scope + idempotent-by-nature reruns are the mitigations for this ticket).
- No scheduler, cron parsing, or auto-refresh UI (HEL-340).

## Capabilities

### New Capabilities
- `external-run-hooks`: the `/api/hooks/run` trigger endpoint, its request/response contract, and
  scoped-token enforcement (403 outside scope) for it.

### Modified Capabilities
- `request-authentication`: PATs gain an optional scope; a scoped PAT is confined to the hook
  capability and MUST be rejected (403) on every other authenticated route.

## Impact

- Backend: `ApiTokenService`/`ApiTokenRepository`/`ApiTokenProtocol`, `AuthDirectives`, new
  `HookTriggerService` + `HookRoutes`, `PipelineRunService`/`PipelineRunRepository`
  (`triggeredByTokenId` threading), `ApiRoutes` wiring.
- DB: Flyway `V74` (scoped_pipeline_ids on api_tokens, triggered_by_token_id on pipeline_runs).
- Schemas/openspec: `schemas/create-api-token-request.schema.json`, `api-token.schema.json`,
  new `schemas/hook-run-request.schema.json` / `hook-run-response.schema.json`.
- Docs: `docs/agent-native.md`.
