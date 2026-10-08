## Standing Constraints

- [C1] Zero diff under `backend/src/test`; total and related-suite test counts equal the 4db9730fd baseline.
- [C2] Both `ServiceError.Forbidden(` producers stay in `PipelineRunService.scala`; no other file gains one.
- [C3] Moved code logs via the `classOf[PipelineRunService]` logger.
- [C4] Moved bodies are byte-identical apart from design D3's listed categories; defects found become follow-ups, not fixes.
- [C5] Synthetic-filtered `javap -public` of `PipelineRunService` (class + companion), `CachedRunStatus`, `TriggerSource` is unchanged.

## 1. Baseline

- [x] 1.1 On the unmodified worktree run `nice -n 19 sbt testFull` backgrounded to a scratchpad log; record total + related-suite counts (design D6d)
- [x] 1.2 Record `javap -public` of the D6b classes from the baseline build to the scratchpad
- [x] 1.3 Write the D6a member inventory (every original class-body `def`/`val` -> destination)

### Backend

## 2. Split

- [x] 2.1 Create `PipelineRunSupport` with its D2 members moved verbatim; compiles
- [x] 2.2 Create `PipelineRunTerminalWrites` with its D2 members moved verbatim; compiles
- [x] 2.3 Create `PipelineRunSucceededWrites` with its D2 members moved verbatim; compiles
- [x] 2.4 Create `PipelineRunExecutor` with its D2 members moved verbatim; compiles
- [x] 2.5 Create `PipelineRunBackfill` and `PipelineRunQueries` with their D2 members moved verbatim; compiles
- [x] 2.6 Reduce `PipelineRunService` to D1: constructor, kept members, D4 wiring, one-line delegations; `node scripts/check-scala-quality.mjs` passes and every `s"${...}"` is checked by eye for inline FQNs
- [x] 2.7 Update `services/pipelines/README.md` Holds list

### Tests

## 3. Evidence

- [x] 3.1 Write `move-evidence.md` (D6a): inventory, forward + reverse checker, allow-listed non-move lines, two red runs, color-moved summary
- [x] 3.2 Write `api-evidence.md` (D6b): synthetic-filtered `javap -public` before/after diff empty, plus its red run
- [x] 3.3 Logger grep over every new file + logger-name red run (D6c), reverted, recorded in `move-evidence.md`
- [x] 3.4 Run `nice -n 19 sbt testFull` again; counts equal baseline incl. TerminalOrdering/Guard/ExistenceNotLeaked specs green; write `test-count-evidence.md`
- [x] 3.5 Confirm `git diff <base>...HEAD -- backend/src/test` is empty, `grep -c "ServiceError.Forbidden(" ` counts per file unchanged, and pre-commit hooks pass on commit
- [x] 3.6 List any defects/oddities found during the move as follow-up candidates in `files-modified.md` (not fixed)
