## Standing Constraints

- [C1] Red first: every behavioural test is shown failing on the unfixed tree before the fix; guards are labelled GUARD and mutation-proven.
- [C2] New DB-backed specs use `VerifiedEmbeddedPostgres.start`; `[hel1468-guard]` must appear in sbt test output.
- [C3] No inline FQNs, no new `eslint-disable`, no `--no-verify`.
- [C4] Probes use a throwaway @example.test user registered by the agent; verify identity via `/api/auth/me` first.

### Backend

## 1. Duplicate write validation

- [x] 1.0 Make `ConvertFormatConfig`'s JSON writer omit `from`/`to` when empty (design D2); do this AFTER 1.1 so 4.2's convertformat case is first shown red on a D1-only tree; record that draft responses now omit from/to and the analyze draft message wording change.
- [x] 1.1 In `PipelineStepWrites.duplicateStep`, run `PipelineStep.rawConfigProblem(existing.kind, PipelineStepConfigCodec.encode(existing))` after the editor check and return 422 on `Some` (design D1); verify with task 4.1 going green.

### Frontend

## 2. Cast picker

- [x] 2.1 Set `CAST_TARGET_TYPES` to the backend `SupportedTargets` list, same order; verify via task 4.4.
- [x] 2.2 Render a stored unsupported target as a disabled `<value> (unsupported)` option for that row only (design D5); verify via task 4.5.
- [x] 2.3 Confirm a duplicate 422 message is surfaced visibly by the StepCard duplicate action; fix only if swallowed; verify via a test or UI probe.

### Specs

## 3. Spec purpose

- [x] 3.1 Replace the `TBD` Purpose in `openspec/specs/pipeline-cast-op/spec.md` with a real one-to-two-sentence Purpose; verify `grep -c TBD` is 0 for that file.

### Tests

## 4. Tests and evidence

- [x] 4.1 RED-first route spec: duplicating a stored legacy-target cast via `POST /api/pipeline-steps/:id/duplicate` returns 422 naming the target and creates no step; plus every other kind with a reachable stored-invalid shape (design D3); record the per-kind enumeration in the run evidence dir.
- [x] 4.2 Route test: duplicating incomplete drafts returns 201 — `{"casts":{}}`, a convertformat step created from `{"field":""}` (must be RED on a D1-only implementation), and one HEL-1416 draft of another kind.
- [x] 4.2a Per-kind table-driven check: every kind's create-accepted draft shapes (frontend seeds + HEL-1416 drafts, generatetext/analyze_with_ai explicit) pass `rawConfigProblem` after `encode(decode(draft))`.
- [x] 4.3 Extend `CastPipelineRunSpec`: a directly-stored legacy-target cast run through `PipelineRunService.submit` passes the value through unchanged.
- [x] 4.4 GUARD jest test pinning `CAST_TARGET_TYPES` to `CastStep.SupportedTargets`; record mutation (both sides) red evidence.
- [x] 4.5 RED-first component test: all nine targets offered; stored `binary-ref` renders as unsupported, not keep-as-is.
- [x] 4.6 Verify in the running app (worktree dev ports): picker shows the nine targets, selecting `timestamp` persists, a stored legacy cast shows as unsupported, duplicate of a legacy cast shows the 422 error; screenshots into the run evidence dir.
- [x] 4.7 Gates: lint, typecheck, format, jest (affected), `sbt testFull` (nice -n 19, `[hel1468-guard]` present).
