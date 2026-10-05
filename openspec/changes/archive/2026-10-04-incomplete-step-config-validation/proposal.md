## Why

Previewing a half-configured step (HEL-1147: an `upsertsource` step with an empty `target.name`) returns a 422, but the
server logs it at ERROR with a full stack trace, and the client receives a step-UUID/lane-path-prefixed string rather
than a named result. A live repro (repro-findings.md) shows the defect is class-wide: every step kind's
missing-config check, and every step-config `IllegalArgumentException` raised inside a step, take the same path on
step preview, Output preview, dry run, real run and proposal apply. This user-caused noise masks real engine failures
in production logs.

## What Changes

- Step-configuration failures (a step kind's required-config check, or an invalid config value a step detects while
  evaluating) are marked explicitly at the engine seam, distinct from data, reference, provider and engine failures,
  which keep today's behaviour.
- A stored `upsertsource` config with an absent new-source `name` reads as an empty name (named result) instead of
  breaking the step listing; create still rejects it.
- Those failures are logged as a single WARN line (pipeline, step id, kind, reason) with no stack trace on every
  pipeline-execution surface (step preview, Output preview, dry run, real run, backfill). Engine faults keep ERROR +
  stack.
- Step preview, Output preview and run submission return a named 422 body for them: the existing `message` (unchanged)
  plus `code: "STEP_CONFIG_INVALID"`, `stepId`, `stepKind`, `reason`.
- The step card's preview tray renders the clean reason (attributed to an upstream step when the failing step is an
  ancestor) instead of the UUID/path-prefixed message.

## Non-goals

- Moving evaluate-time checks (fillnull/window/pivot) into `requiredConfigProblems` so analyze reports them.
- `costVerdict.canRun` ignoring `validationError`; an `existingSource` target pointing at a non-dataset source passing
  every check until a real run; apply-proposal pre-checking validation. Candidate follow-ups.
- HEL-1256 (PatchSetUndoService silent-null). Changing the persisted run `errorLog` text or the SSE error string.

## Capabilities

### New Capabilities

### Modified Capabilities
- `pipeline-step-preview`: preview of a step whose closure has invalid step configuration returns a named 422.
- `pipeline-step-config-runtime-completeness`: step-config failures are logged as user errors, not server faults.

## Impact

Backend: `InProcessPipelineEngine` (`StepExecutionException`), `PipelineRunService` failure/recover sites,
`ServiceError`/`ServiceResponse`, JSON protocol + `schemas/` error body. Frontend: step-card preview hook/tray and
Output preview error extraction. No migration. MCP tools unchanged (they read `message`, which is preserved).
