## Why

`pipeline-run-guard`'s own spec already states the guard "applies uniformly regardless of trigger
source," but its scenarios only cover hook and scheduled triggers — auto-run (HEL-1093's
dataset-write trigger) is never explicitly proven against it. Premise validation for this ticket
confirmed in code that every auto-run fire already reaches the guard unconditionally (it shares
`PipelineRunService.submit`/`executeRun` with every other trigger, and production wiring confirms
the same guard-repo instance is used) — so the risk here is an unproven guarantee, not a missing
one. The owner ruled (2026-09-24) that per-principal charging stays owner-attributed as already
specified in `dataset-write-auto-run`; the cross-principal fairness question is deferred to
HEL-1173. This change closes the remaining gap: explicit spec coverage plus a mutation-tested proof
that the AC ("a burst of writes cannot exceed the per-principal run budget") holds even when the
debounce coalescing that would otherwise mask the guard's own necessity is defeated.

## What Changes

- Add an explicit auto-run scenario to `pipeline-run-guard`'s "guard applies uniformly" requirement.
- Add a scenario to `dataset-write-auto-run` making explicit that a guard-rejected auto-run's
  debounce claim is released without retrying the same denial every subsequent tick.
- Add a mutation-tested backend test suite proving the AC from `pipeline_runs` rows and guard state
  (never logs): burst-with-debounce-defeated, a guard-bypassed red case, and the no-retry-storm
  behavior across several ticks.
- If a real gap is found during execution (not expected, per premise validation), close it with a
  targeted fix — this proposal does not pre-commit to a specific code change beyond the tests.

## Capabilities

### New Capabilities
(none)

### Modified Capabilities
- `pipeline-run-guard`: adds an explicit auto-run scenario under "The guard applies uniformly
  regardless of trigger source."
- `dataset-write-auto-run`: adds a scenario under the guarded-submission requirement making the
  no-retry-storm debounce-release behavior an explicit, testable guarantee.

## Non-goals

- The per-(pipeline, writer) sub-limit / cross-principal fairness question — deferred to HEL-1173
  per the owner's ruling.
- Any new user-facing surfacing of a guard-rejected auto-run beyond the existing server log, unless
  execution finds the AC cannot otherwise be honestly proven met — decided explicitly during
  execution, not assumed here.

## Impact

Backend only: `backend/src/test/scala/...` (new/extended specs), `openspec/specs/pipeline-run-guard/spec.md`
and `openspec/specs/dataset-write-auto-run/spec.md` (delta additions). No frontend impact expected.
Migration ledger: V111 remains free — no schema change anticipated for this ticket.
