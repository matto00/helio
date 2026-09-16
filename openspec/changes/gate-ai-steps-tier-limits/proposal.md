## Why

Two AI pipeline steps (`analyzewithai`, `generatetext`) are live on `main` and **ungated**: every
pipeline-triggered model call bypasses the beta daily cap that already protects chat. The v0.8.2
release is held on this. The writeback design spec asserts these steps route through a
`ClaudeClient` that "already enforces ... tier gating (`HELIO_BETA_DAILY_MESSAGE_LIMIT`)" — that is
**false**: `com.helio.ai` has no tier/user awareness at all, and `ClaudeAiStepClient.complete`
documents the gate as deliberately unimplemented. A beta user can currently spend unlimited model
budget through a pipeline.

## What Changes

- Thread the owning user into the AI seam so the gate has an identity to key on:
  `PipelineExecutionContext` carries the pipeline owner, and both AI steps populate
  `AiStepRequest.ownerUserId` (today always `None`, so the gate is unreachable).
- Enforce the tier/quota check at `ClaudeAiStepClient.complete` — the single call point every
  pipeline AI model call passes through. Over-cap calls are denied **before** the model request.
- Reuse the existing chat counter (`assistant_daily_usage`) and limit, so one beta user has **one**
  daily AI budget rather than two. `owner` stays uncounted; a limit below 1 stays "always capped".
- Surface a **clear error**, never a silent no-op: a new closed-set `AiStepFailure` variant that
  both steps map to a named step failure, reaching the caller as a 422 with a verbatim reason plus
  the run's `error_log`/SSE failure event.
- Count every trigger path (manual, scheduled, hook, preview) against the **pipeline owner**,
  reusing HEL-1100 D5's already-ruled semantics.
- Close a viewer-drain hole this creates: preview-triggered AI calls become authorized like `submit`
  (owner or editor grantee), so a read-only grantee cannot drain the owner's budget.
- Correct the writeback design spec's false claim that `ClaudeClient` already enforces tier gating.
- Close a spec asymmetry: `pipeline-generatetext-op` states it is never auto-runnable;
  `pipeline-analyzewithai-op` does not.

## Capabilities

### New Capabilities
- `pipeline-ai-tier-gating`: tier/quota enforcement of pipeline-triggered AI model calls, keyed on
  the pipeline owner across every trigger path, with a clear denial error.

### Modified Capabilities
- `pipeline-analyzewithai-op`: add the missing never-auto-runnable (`ai-step`) requirement.
- `tier-gated-assistant-access`: the beta daily cap now counts pipeline AI calls, not only converse
  sends.

## Non-goals

- The auto-run deny verdict itself — already shipped and probed (HEL-1092); only the analyzewithai
  spec gap is closed here.
- Step-card UI (HEL-1109), op-menu rework (HEL-1136), AI-backed conversion (HEL-1135).
- Per-row batching, retry, or caching of model calls.
- Any new migration: V107 already admits all four ops.

## Impact

`ClaudeAiStepClient` (gate becomes a required constructor param, so its three existing test
construction sites change), `AiStepClient`/`AiStepRequest`/`AiStepFailure` (new closed-set variant),
`PipelineExecutionContext`, and the three per-execution signatures the owner travels through:
`PipelineExecutionBackend.execute`, `InProcessExecutionBackend.execute` and
`InProcessPipelineEngine.executeTree` (into `makeContext`). Also `PipelineRunService` — the run
path, preview authorization, AND both Output-backfill execute sites in
`evaluateNodeRowsForBackfill`, which must be threaded or fail-closed silently breaks every
AI-pipeline backfill (including for uncapped owners) — both AI step files, `ApiRoutes` wiring, and
one sentence in
`docs/superpowers/specs/2026-09-10-interactive-data-writeback-design.md`.
No schema change; reuses `assistant_daily_usage` (V88) and `HELIO_BETA_DAILY_MESSAGE_LIMIT`.
