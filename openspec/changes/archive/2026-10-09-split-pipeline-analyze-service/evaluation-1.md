## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD: `ed35e9c831a415d8817e1da62d421e0e340434e7`. Base resolved live: `ecaa1a532dcbf10b8d7f3664335bff392fd59554` (origin/main).
I treated all executor evidence as claims and re-derived it myself (details below).

### Phase 1: Spec Review — PASS
Issues: none.

- AC "Behaviour-preserving: analyze and auto-run specs pass with import-only changes; no wire change": met. The only test
  diff is the one-line import-selector sort in `AutoRunTriggerServiceSpec.scala:5`. The only changes outside
  `domain/engine/` are comments (`PipelineAnalyzeProtocol.scala:237`, `AutoRunTriggerService.scala:122`), so there is no
  wire change.
- AC "No inline FQNs (check:scala-quality)": `npm run check:scala-quality` is clean. See Phase 2 for the pre-existing
  `scala.util.Try` the guard does not cover.
- The ticket's stale "cost/canRun" seam was dropped with a documented premise note (ticket.md, proposal Non-goals). This
  is not a silent reinterpretation.
- All tasks.md items are `[x]` and match the diff. README Holds list is updated. No scope creep.
- CONSTRAINTS C1-C6 all hold:
  - **C1:** test diff is the import sort only. Totals equal the claimed baseline (my run: 6436 tests, 462 suites).
  - **C2:** `stepConfigProblem` is unchanged in `PipelineAnalyzeService`. `RunConfigGate.scala:20`, analyze and
    analyzeNodes all reach the same `StepConfigValidation.validateStepConfig`. No caller outside `domain/engine` changed
    in code.
  - **C3/C6:** all 4 new loggers use `LoggerFactory.getLogger(PipelineAnalyzeService.getClass)`. There are 12 moved
    `log.` sites plus 1 kept, matching base's 13. The entry-point `log` is still `private`.
  - **C4:** independent byte-move check, below.
  - **C5:** independent javap, below.
  - **C6, import rule:** `inferOutputSchema` is not imported into the entry point (only
    `import StepConfigValidation.validateStepConfig`). The forwarder body is receiver-qualified
    (`PipelineAnalyzeService.scala:316`).

### Phase 2: Code Review — PASS
Gates (run fresh in WORKTREE_PATH):
- `nice -n 19 sbt testFull`: exit 0. "Total number of tests run: 6436 / Suites: completed 462, aborted 0 / succeeded
  6436, failed 0, canceled 4 / All tests passed." `AutoRunGuardBurstProofSpec` (HEL-1439 flake) passed first time, so no
  re-run was needed.
- `npm run check:scala-quality`: clean (222 pre-existing soft size warnings).
- `npm run format:check`: clean. Not strictly triggered because there are no `frontend/**` changes; run because of the
  README edit.

Independent move check (my own script, not the executor's `check_moves.py`):
- **Method:** greedy longest contiguous-run matching of every line in the 8 resulting files against base
  `PipelineAnalyzeService.scala` @ ecaa1a53 (runs of 4 or more lines). Every uncovered base line and every unmatched new
  line was then reconciled.
- **Result:** every base line outside the header imports is reproduced byte-for-byte, except 29 member-definition lines
  whose only change is `private def` -> `private[engine] def` (D3 category). The one other edited line is
  `stepConfigProblem`'s body, `validateStepConfig(...)` -> `StepConfigValidation.validateStepConfig(...)` (D1).
- **Non-move lines:** all fall in D3 categories: package/imports, object headers and closing braces, 4 logger lines, the
  forwarder body line, 5 one-line `HEL-1385:` object docs, and the allow-listed dispatch scaffolding comment.
- **Duplication:** only the HEL-872 comment and forwarder signature (base 464-475) appear twice, by design (D1).
- **Missing code:** none. No base code line goes missing.

Independent javap (C5):
- **Method:** compiled base ecaa1a53 from a `git archive` copy in the scratchpad (since deleted). Ran `javap -public` on
  the 10 D6b classes from both builds and filtered `$anonfun$`/`$deserializeLambda$`/`$$`/`Compiled from`.
- **Filtered result:** filtered diff is empty (164 = 164 lines, `diff` exit 0).
- **Unfiltered diff:** only the moved synthetic lambdas, plus `Compiled from "SchemaField.scala"`.
- **Private members:** in the `javap -p` view of `PipelineAnalyzeService$`, the only member change is the removed
  private `validateStepConfig`. `inferOutputSchema` (with `$default$4`) and `laneDependencyOf` are unchanged.

Other checks:
- **Init safety:** the new objects' only cross-object val is the logger, which reads `PipelineAnalyzeService.getClass`.
  `PipelineAnalyzeService`'s own init touches no new object, so there is no init cycle.
- **Interpolations and FQNs:** I eyeballed every `s"${...}"` in the 8 files: no FQNs. The remaining FQN-like tokens are
  all pre-existing and byte-identical:
  - kept code: `PipelineAnalyzeService.scala:203,217` (`scala.util.Try`) and `:253` (`scala.collection.mutable`)
  - moved code: `MultiInputSchemaInference.scala:86` (`scala.util.Try`)

  D3 made converting these optional, and the guard does not cover `scala.*`. Not a blocker.
- **Comment reflows:** a word-diff of both reflowed comments shows only added `*` continuation markers, so the words are
  unchanged. Both reflowed lines are 120 characters or fewer.

Issues: none blocking.

### Phase 3: UI Review — N/A
No changes under `frontend/**`, `ApiRoutes.scala`, `schemas/**` or `openspec/specs/**`. The backend-only, comment-only
protocol edit has no wire effect, so dev servers were not started.

### Overall: PASS

### Change Requests
None.

### Non-blocking Suggestions
- `PipelineAnalyzeService.scala:10-12`: three consecutive blank lines are left where `SchemaField` used to be. Collapsing
  them to one is cosmetic.
- `PipelineAnalyzeService.scala:9/25`: `validateStepConfig` is imported by name but `stepConfigProblem` calls it
  receiver-qualified. Harmless (this is design D1's literal shape); just a small inconsistency.
- `PipelineAnalyzeProtocol.scala:237-238` and `AutoRunTriggerService.scala:122-123`: the reflows leave a short ragged
  line mid-paragraph. They are within the rule; re-wrapping the paragraph would read better but would move more lines.
- `StepConfigValidation.scala:4` and `StepSchemaInference.scala:9`: the import lines are very long (about 230 and 150
  characters). Base used a multi-line brace import. No repo rule is violated.
- The follow-up candidates in `files-modified.md` are reasonable (stale `PipelineAnalyzeService.inferX` doc references,
  and the `scala.util.Try` FQNs, which `check:scala-quality` does not cover).
