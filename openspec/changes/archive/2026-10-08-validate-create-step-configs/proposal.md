## Why

`POST /api/pipelines` (single-call create, `PipelineService.buildStepsAction`) never calls the step kind's
`validateRawConfig`, so it stores configs every other write surface rejects with 422 — e.g. a `compute` expression
calling an unknown function returns 201. The defect surfaces only later as an analyze `step-config-invalid` issue, and
since HEL-1279 such a pipeline silently never auto-runs. The gap covers every step kind, not only compute.

## What Changes

- `buildStepsAction` runs `PipelineStep.companionFor(type).validateRawConfig(config)` for every step, after the
  type check and before the tolerant decode (mirroring `addStepReporting`), failing the whole create with
  **422** `UnprocessableEntity("Step '<clientId>': <message>")`. Nothing is persisted (one transaction).
- The patch-set `pipeline` create edit's resolver (`resolvePipelineCreate`) runs the same check over the edit's inline
  steps, so it rejects at resolve time with 422 (`"edit N: Step '<clientId>': <message>"`) like patch-set step update edits,
  instead of failing at forward-apply (which reports HTTP 200 with `failure` set).
- Every write path that takes a caller-supplied step config is enumerated (below); each newly validated one gets a
  red-first test.
- No read-path or analyze change: legacy stored invalid steps keep loading and analyzing as today.
- Client-visible: MCP `create_pipeline` / REST callers sending a config another surface already rejects now get 422
  instead of 201. helio-news' literal configs are proven still accepted.

| Write path | Entry | Validates today? |
|---|---|---|
| Single-call create | `POST /api/pipelines` (REST + MCP `create_pipeline`) → `create` → `buildStepsAction` | **No — fixed here** |
| Patch-set `pipeline` create edit | resolve `resolvePipelineCreate` (roots only) → forward `pipelineService.create` | **No — fixed here (resolve-time 422; create also checks)** |
| Proposal validate / apply (incl. first-run, persona templates) | `PipelineProposalService.validateSteps` (422) → `create` | Yes (HEL-814); create now re-checks |
| REST step create / update | `addStepReporting` / `updateStep` (422) | Yes (HEL-860) |
| Patch-set step update | `PatchSetApplyResolvers` resolve-time (422) | Yes (HEL-814) |
| Patch-set step create, undo, rollback | forward apply via `addStep` / `updateStep` (200 + `failure`) | Yes, at apply time — unchanged |
| MCP `add_outputs_from_shape` (shape expansion) | per-step `addPipelineStep` → `addStep` | Yes — not a create-path writer |
| Step duplicate | `duplicateStep` re-writes a stored config | No — out of scope (Non-goals) |

## Capabilities

### New Capabilities

### Modified Capabilities
- `pipeline-step-config-rejection`: the single-call pipeline create surface joins the surfaces that apply
  `validateRawConfig`, for every step kind.

## Non-goals

- Read-time or analyze-time behavior changes; migrating/repairing stored invalid steps.
- Validating `duplicateStep` (it copies an already-stored config; a legacy invalid step stays duplicable). Undo and
  rollback already validate via `addStep`/`updateStep` — unchanged here.
- Changing any message text or status of the existing validated paths.

## Impact

`backend/.../services/pipelines/PipelineService.scala` (`buildStepsAction`),
`backend/.../services/patchsets/PatchSetApplyResolvers.scala` (`resolvePipelineCreate`), backend specs, `schemas/`/OpenAPI and
`helio-mcp` tool docs only if they enumerate create's error statuses. No migration, no frontend change expected.
