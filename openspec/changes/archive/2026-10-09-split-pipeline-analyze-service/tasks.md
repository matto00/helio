## Standing Constraints

- [C1] Zero diff under `backend/src/test` except import-line reordering in `AutoRunTriggerServiceSpec.scala`; total and related-suite test counts equal the ecaa1a53 baseline.
- [C2] `stepConfigProblem` stays in `PipelineAnalyzeService` with an unchanged signature and is the single entry point; analyze, `AutoRunTriggerService` and `RunConfigGate` keep reaching the same `validateStepConfig`; no caller outside `domain/engine` changes.
- [C3] Every moved log site logs under `com.helio.domain.engine.PipelineAnalyzeService$`.
- [C4] Moved bodies are byte-identical apart from design D3's listed categories; defects found become follow-ups, not fixes.
- [C5] Synthetic-filtered `javap -public` of the D6b classes is unchanged.
- [C6] New objects get a logger only via `LoggerFactory.getLogger(PipelineAnalyzeService.getClass)`; the entry point's `log` stays `private`; `inferOutputSchema` is never imported into the entry point, whose forwarder body is receiver-qualified.

## 1. Baseline

- [x] 1.1 On the unmodified worktree run `nice -n 19 sbt testFull` backgrounded to a scratchpad log; record total + D6d per-suite counts
- [x] 1.2 Record `javap -public` of the D6b classes from the baseline build to the scratchpad
- [x] 1.3 Write the D6a member inventory (every original member -> destination)

### Backend

## 2. Split

- [x] 2.1 Create `SchemaField.scala` with the case class moved verbatim; compiles
- [x] 2.2 Create `StepConfigValidation.scala` (D2); compiles
- [x] 2.3 Create `StepSchemaInference.scala` and the four family objects (D2) with members moved verbatim; compiles
- [x] 2.4 Reduce `PipelineAnalyzeService.scala` to D1 (kept members, `stepConfigProblem` delegation, `inferOutputSchema` forwarder, named imports); `node scripts/check-scala-quality.mjs` passes and every `s"${...}"` is eyeballed for inline FQNs
- [x] 2.5 Update `domain/engine/README.md` Holds list
- [x] 2.6 D7 nits: sort `AutoRunTriggerServiceSpec.scala` imports; reflow `PipelineAnalyzeProtocol.scala:237` and `AutoRunTriggerService.scala:122` comments to <= 120 chars, words unchanged

### Tests

## 3. Evidence

- [x] 3.1 Write `move-evidence.md` (D6a): inventory, forward + positional reverse checker, allow-listed lines, two red runs, color-moved summary
- [x] 3.2 Write `api-evidence.md` (D6b): filtered `javap -public` before/after diff empty, plus its red run
- [x] 3.3 Logger grep over every new file + red run (D6c), reverted, recorded in `move-evidence.md`
- [x] 3.4 Run `nice -n 19 sbt testFull` again; counts equal baseline; write `test-count-evidence.md` (note any `AutoRunGuardBurstProofSpec` re-run)
- [x] 3.5a D6e nit checks: word-diff of both comment reflows, sorted import comparison for the spec
- [x] 3.5 Confirm `git diff <base>...HEAD -- backend/src/test` touches only `AutoRunTriggerServiceSpec.scala` import lines; pre-commit hooks pass on commit
- [x] 3.6 List any defects/oddities found during the move as follow-up candidates in `files-modified.md` (not fixed)
