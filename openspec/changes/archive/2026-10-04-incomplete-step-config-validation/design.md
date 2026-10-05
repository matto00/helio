## Context

See proposal.md (Why) and repro-findings.md (live repro, 2026-10-04, HEAD 63a0b3ea). Current chain:
`InProcessPipelineEngine.evalOneStep` (~:264) fails a step whose `requiredConfigProblems` is non-empty with a plain
`IllegalArgumentException`; step `evaluate` bodies also throw plain IAE. `StepExecutionException.from` (:48-52) treats
every IAE as client-safe (HEL-859 allowlist) and everything else as an opaque fault. `PipelineRunService` then
`log.error(..., ex)` at previewAtNode source-level (~:524), previewAtNode step (~:623), `executeRunFailure` (~:1095)
and the backfill sites (~:733, ~:756), returning `UnprocessableEntity(see.getMessage)`. The tray
(`useStepCardPreview.ts:101-115`, `StepCard.tsx:439-442`) renders that message verbatim (UUID + lane path).
Not every IAE is a config problem (design-gate round 1): data failures (DateBucketStep:80), reference failures
(Join/Union/Lookup "not found"), and AI-step `fail()` helpers (provider error, quota, unavailable) also throw IAE.

## Goals / Non-Goals

Goals: an explicit step-config marker at the engine seam, consumed by every PipelineRunService failure site; named
422 body; WARN-without-stack logging for config failures only. Non-goals: proposal.md Non-goals, plus: data,
reference, external-provider and root-source failures keep today's ERROR+stack and unnamed 422 exactly.

## Decisions

**D1 — Explicit marker, not the IAE allowlist.** New `class StepConfigError(msg) extends IllegalArgumentException`
in `domain/steps` (so HEL-859's IAE message pass-through is unchanged). `StepConfigTypeMismatch` is re-parented onto
it (it is config by definition). The engine's `requiredConfigProblems` branch (~:266) throws `StepConfigError`.
`StepExecutionException` gains `val isStepConfigError: Boolean`, true exactly when the cause is a `StepConfigError`;
the nested pass-through (`case already: StepExecutionException`) keeps the inner flag. Plain IAE stays false.
Alternative rejected (round 1): keying on any IAE — mislabels data/external failures.

**D2 — Per-site classification table (only "config" rows change to `StepConfigError`).**

| Site | Class | Action |
|---|---|---|
| engine `requiredConfigProblems` branch | config | `StepConfigError` |
| FillNull:85 (strategy), :92 (constant w/o value) | config | `StepConfigError` |
| Window:100 (fn), :107 (field), :115 (offset) | config | `StepConfigError` |
| Window:143 (unreachable default) | invariant | `IllegalStateException` |
| Pivot:81, Aggregate:96/:119, GroupBy:74 (unsupported fn) | config | `StepConfigError` |
| StringOps:100/110/113/118/162/165 (op, separator, index, pattern, regex) | config | `StepConfigError` |
| Join:71, Union:70 (type/mode), ChunkByTokenCount:107 (encoding) | config | `StepConfigError` |
| DateBucket:63 (`floorFn` granularity Left) | config | `StepConfigError` |
| DateBucket:80 (no parsable timestamps) | data | unchanged (plain IAE) |
| Join:96/104, Union:88/99, Lookup:116/127 (lane/source not found) | reference | unchanged |
| GenerateText/AnalyzeWithAi/ConvertFormat `fail()` | external/data | unchanged |
| root-source loaders (engine ~:534-789) | source | unchanged (not wrapped by `from`) |

The executor re-greps `IllegalArgumentException`/`require(` under `domain/steps/**` and `domain/engine/**`; any site
not in this table is reported with a proposed class before changing it (no silent reclassification).

**D3 — Logging.** One private helper in `PipelineRunService`: `isStepConfigError` → one `log.warn` (pipeline id, run
id where present, step id, kind, reason), no throwable; anything else → existing `log.error(msg, ex)`. Used at all five
sites. `pipeline_runs.error_log`, SSE `errorLog` and run-status text stay byte-identical.

**D4 — Named 422 as a sibling ServiceError.** New `ServiceError.StepConfigInvalid(stepId, stepKind, reason, message)`.
`ServiceResponse.statusCodeFor` maps it to 422 (compile-forced, also covers `DashboardAuthoringRoutes`' reuse);
`ServiceResponse.completeError` gets an explicit arm emitting `StepConfigErrorResponse{message, code:
"STEP_CONFIG_INVALID", stepId, stepKind, reason}` — not compile-checked, so a route test asserts the full body and that
`message` is byte-identical to today's. Returned by both previewAtNode arms and `executeRunFailure` only when
`isStepConfigError`; otherwise `UnprocessableEntity` as today. Apply-proposal forwards `Left(err)` unchanged.
Existing tests asserting `a[ServiceError.UnprocessableEntity]` on a failed run/preview
(`PipelineRunServiceSpec.scala:505, :920, :937, :976, :1009`): the executor classifies each; those whose failure is a
D2 "config" row are deliberately updated to `StepConfigInvalid` with `message` asserted unchanged and the reason
recorded in the report; the rest must stay green untouched. Route `startWith` pins (`PipelineRunRoutesSpec`
:736/:851/:1053) stay green untouched. `schemas/` gets the body schema (pattern: `shared/field-validation-error-response`).

**D5 — Refuse, not empty preview.** Preview is refused (422). A 200 with zero rows is indistinguishable from "filter
matched nothing"; the engine already refuses before evaluating the step. Self-approved.

**D6 — Frontend.** `useStepCardPreview` reads the structured body with a narrow typed guard (or the existing
error-envelope helper if it exposes response data). Own step → tray shows `reason`; ancestor → "Upstream <stepKind>
step is not fully configured: <reason>". Other errors keep `extractErrorMessage` + "Preview failed — try again.".
No client-side skipping on analyze `validationError`. `outputsSlice.ts:218-227` prefers `reason` the same way.

**D7 — Absent `target.name` on the read path.** Create already rejects an absent name (422,
"'target' with kind 'newSource' requires a string 'name'."). A stored row with an absent name is reachable only by
bypassing every write path, but today it would fail `PipelineStepRepository.rowToDomain` with `IllegalStateException`
(breaking the whole step listing) and `requiredConfigProblems` swallows the decode failure via `Try`. Fix: the
tolerant READ decode (`UpsertSourceConfig.decode`, used by `rowToDomain` and `requiredConfigProblems`) maps a
`newSource` with absent/non-string `name` to `NewSource("")`, mirroring the existing absent-`target` →
`ExistingSource("")` tolerance; the strict write-path `validateRawConfig` is unchanged (create still 422). The
executor first probes current behaviour with a test (red) and records it. If decode and validation share one reader,
split them rather than loosening the write path.

## Risks / Trade-offs

- [A config row misclassified hides a real bug's stack] → table is explicit; WARN still names step/kind/reason;
  tests pin that data (DateBucket:80) and external (AI `fail()`) failures keep ERROR+stack and the unnamed 422.
- [Body shape drift] → route test asserts the whole body; `message` byte-identical for MCP consumers.
- [Shared dev DB] → specs use their own fixtures; any live check records and deletes ids exactly.

## Planner Notes

- Premise correction (self-approved): route is GET not POST; the client already gets 422. Real defects: ERROR+stack
  logging, unnamed/prefixed body, tray text, and the absent-name read path (D7).
- Scope widened per driver instruction to the shared seam (all step kinds, all execution surfaces); the seam is one
  marker class + one service + one hook, so not escalated. No migration (V118 unused).
- Round 1 REFUTE addressed in place: D1 (marker), D2 (table), D4 (completeError arm, listed test updates), D7.
