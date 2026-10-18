## Why

`DraftSaveDeadlockSpec` failed on 2 of 3 CI attempts for a PR with zero backend diff, reporting that a concurrent writer committed while the draft save was "parked" holding its locks, with `blockedObserved=false`. That is either a real hole in HEL-1629's verified lock protocol (a lost-update bug on main) or a race in the test harness's notion of "parked". HEL-1631 builds on this save path, so it must be settled with evidence before more work lands on it.

## What Changes

- Root-cause the failure with a probe: reproduce under CI-like load and capture `pg_locks`/`pg_stat_activity`/`pg_blocking_pids` at the moment the harness declares the save parked and at the writer's commit. Record the evidence durably.
- Leading hypothesis (to be confirmed or refuted by the probe, not assumed): the race fixture's save hook completes its `parked` promise when the hook's `DBIO` is *constructed*, and `PipelineDraftWrites.lockDefinition` constructs the per-site `afterLock(site)` actions eagerly, before any lock statement runs. For `parkAfter = Some(<site>)` the harness would then declare the save "parked past its compare" before it holds any lock.
- If the probe confirms a harness race (b): make `DraftRaceFixture`'s park signal fire only when the save's transaction has actually executed up to the hook point, and gate the oracle on observed database state (the save backend idle in transaction holding the expected locks; the writer observed waiting via `pg_blocking_pids`) rather than on wall-clock windows that can expire on a slow runner. Apply the same correction to every race/duel/three-session path in the fixture that shares the weakness.
- If the probe shows a real protocol gap (a): stop and escalate to the owner with the evidence and options before changing any production lock code.
- No production behavior change is planned under (b).

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

(none — under (b) this is a test-harness correction with no spec-level behavior change; `skip_specs: true`. If the probe finds (a), the plan is revised after the owner escalation and a delta to `pipeline-definition-lock-protocol` is added then.)

## Impact

- `backend/src/test/scala/com/helio/testsupport/DraftRaceFixture.scala` (oracle/park synchronisation).
- Possibly `DraftSaveDeadlockSpec`, `DraftSaveRaceSpec`, `DraftSaveSetRaceSpec` (only if their own choreography shares the weakness).
- `docs/live-draft-preview.md` §8.3.1: a short note on the harness correction and where its evidence lives.
- Evidence under the change's `evidence/` directory and `.concertino/runs/HEL-1654/evidence/`.
- Release exposure: none — v0.9.8 (29cb0a60f) predates HEL-1629 (544bd79ea) and has no V137.
