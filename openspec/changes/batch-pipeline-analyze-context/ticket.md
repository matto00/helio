# HEL-1625: helio-mcp: batch the per-pipeline analyze read so get_workspace_context stays under 120/60s beyond ~100 pipelines

## Description

HEL-1619 (PR #1048, 83cbfc022) cut one `get_workspace_context` call from 339 to 84 requests at 55 pipelines, using
the new `GET /api/pipelines/context-details` batch read. The bound is now 8 + 1 + P + placed Outputs + distinct
dashboards, because `analyzePipeline` is still one request per pipeline. From roughly 100 pipelines up, a single call
exceeds the default 120/60s rate limit again. The helio-mcp README documents this.

**Fix:** extend the batch read, or add a sibling one, to return each caller-visible pipeline's analyze result in one
call. It must stay additive and owner-scoped like `/api/pipelines/context-details`, keep the MCP payload
byte-identical against the HEL-1619 golden, and fall back on a 404.

origin_kind: followup
origin_ticket: HEL-1619

## Acceptance Criteria

- The request-count test pins a constant-in-P bound, plus a 200-pipeline fixture under 120.
- The golden, the seam schema guards and a `TwoUserRlsApiFixture` isolation test all follow the HEL-1619 pattern.
- Evidence (HEL-1619): `openspec/changes/archive/2026-10-16-bound-workspace-context-requests/measurements.md`
  (the ticket's `.concertino/runs/HEL-1619/evidence/...` path does not exist; this is the in-repo copy).

## Driver context (verified at Setup, see premise-validation.md)

- get_workspace_context uses the FULL analyze shape (no `?concise=true`); it reads `steps[].position`, `type`,
  `outputSchema[].name`, `validationError` and `warnings[].stepId/code/message`.
- `GET /api/pipelines` and `GET /api/pipelines/context-details` are owner-only (`ownerId === caller`), so every
  pipeline the MCP analyzes is caller-owned: the HEL-1661/HEL-1799 grantee shaping is never on this path. The
  batch must still equal the per-pipeline route for that caller, and a grantee's batch must not include the
  shared pipeline (owner + editor + viewer on a non-BYPASSRLS role).
- The batch read's own server cost at 200 pipelines must be bounded (constant statement count, not N+1) and measured.
- helio-mcp: source change only, no MCP deploy; the PR notes the redeploy. New response schema in `schemas/` with a
  seam test. No migration.
