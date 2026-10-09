## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD `ed35e9c831a415d8817e1da62d421e0e340434e7` against the live base resolved by
`resolve-review-base.sh` (`ecaa1a532dcbf10b8d7f3664335bff392fd59554`, exit 0). Backend-only refactor, so no UI
step and no servers started. Cwd guard: `READY ambient=/home/matt/Development/helio branch=task/split-pipeline-analyze-service/HEL-1385`.

### What I verified (with evidence)

- **Diff scope.** `git diff --name-only BASE...HEAD` outside openspec: the 8 engine files, engine `README.md`,
  `PipelineAnalyzeProtocol.scala`, `AutoRunTriggerService.scala`, `AutoRunTriggerServiceSpec.scala`. Nothing else.
- **Test diff (C1).** `git diff BASE...HEAD -- backend/src/test` is one line in `AutoRunTriggerServiceSpec.scala`
  line 5: `ComputeConfig, AnalyzeWithAiOutputField` becomes `AnalyzeWithAiOutputField, ComputeConfig`. Same names,
  now sorted. No other test change.
- **Byte-move (C4), my own check, not the executor's checker.**
  (1) Line-multiset diff of base `PipelineAnalyzeService.scala` (1201 lines) against the concatenation of the 8 new
  files. The only removed lines are the 3 old import lines, 23 `private def` declaration lines (each reappears as
  `private[engine] def`), and the `stepConfigProblem` line (reappears as
  `= StepConfigValidation.validateStepConfig(op, rawConfig)`). The added lines are package/imports, blank lines,
  closing braces, one file-doc per new object, 4 canonical logger lines, the D1 scaffolding comment and the 7
  forwarder lines. That is exactly the set D3 allows.
  (2) I also checked contiguity: with `private[engine] def` normalized back to `private def`, every new file is made
  of maximal runs that appear contiguously in base. Coverage: PAS 305/318, SchemaField 27/30, StepConfigValidation
  132/142, StepSchemaInference 63/81, Column 182/196, Text 201/215, Reshape 204/219, MultiInput 81/93. The lines
  left over are headers. So bodies were not reordered internally.
- **Public API (C5).** I ran the executor's `javap.sh` on the classes from my own `testFull` build of HEAD and diffed
  it, filtered, against the executor's `javap-before.txt`. Result: `diff` exit 0, 174 lines on each side.
  Provenance of the baseline does not rely on mtime. In `javap-before.txt`, `SchemaField` reports
  `Compiled from "PipelineAnalyzeService.scala"`, which can only be a pre-split build. `inferOutputSchema` and
  `inferOutputSchema$default$4` are both present on `PipelineAnalyzeService$`.
- **Single entry point (C2).** `stepConfigProblem` stays in `PipelineAnalyzeService` with the same signature
  (PAS.scala:25) and delegates to `StepConfigValidation.validateStepConfig`. `analyze` (:119) and `analyzeNodes`
  (:275) reach the same function through `import StepConfigValidation.validateStepConfig`. No other definition
  exists. `RunConfigGate.scala:20` still calls `PipelineAnalyzeService.stepConfigProblem`, and `AutoRunTriggerService`
  and `PipelineService` still use `PipelineAnalyzeService.StepConfigInvalidCode`. No caller outside `domain/engine`
  changed.
- **Logger (C3/C6).** Column, Text, Reshape and StepSchemaInference each declare exactly
  `private val log = LoggerFactory.getLogger(PipelineAnalyzeService.getClass)`, and that class is
  `PipelineAnalyzeService$`, the same as the base's in-object `getClass`. The entry point's `log` stays `private`.
  `MultiInputSchemaInference` and `StepConfigValidation` have no logger and still compile, so they have no `log`
  sites. The forwarder body is receiver-qualified (PAS.scala:316). `inferOutputSchema` is not imported into the
  entry point.
- **Init safety (D5).** The new objects' vals are only the loggers and Reshape's two assert `Set`s. The entry
  point's vals (`log`, `StepConfigInvalidCode`, `schemaFieldJsonFormat`, `DefaultRootKey`) touch no new object, so
  there is no init cycle in which `PipelineAnalyzeService.getClass` could see a null module.
- **Wire.** Protocol and service edits are comment reflows only. Both have the same words; each splits one line in
  two. No JSON shape changed.
- **Gates.** `node scripts/check-scala-quality.mjs` reports clean, exit 0 (soft warnings only).
  `nice -n 19 sbt testFull` on HEAD gave 6436 tests, 462 suites, 0 failed, 0 aborted, 4 canceled, EXIT=0. That
  matches the baseline in `test-count-evidence.md`. All 22 related suites ran. `AutoRunGuardBurstProofSpec` passed
  on the first run, so no re-run was needed.
- **Inline FQNs, checked by eye including `s"${...}"`.** No `${...}` interpolation in the new or kept files holds an
  FQN. Four `scala.util.Try` remain (MultiInputSchemaInference:86 in moved code; PAS:203 and :217 in kept code) plus
  `scala.collection.mutable.LinkedHashMap` at PAS:253. All four are byte-identical pre-existing text. The checker
  does not flag `scala.util.`/`scala.collection.`, and design D3 made converting them optional. The AC (as measured
  by check:scala-quality) is met.

### Acceptance criteria

1. *Behaviour-preserving; analyze and auto-run specs pass with import-only changes; no wire change.* Met: byte-move
   check, javap diff empty, full suite green with equal counts, test diff limited to one import selector line, and
   no protocol shape change.
2. *No inline FQNs (check:scala-quality).* Met by the checker (exit 0). See note 1 for the residual
   `scala.util.Try`.
3. Ticket nits: spec imports sorted; `PipelineAnalyzeProtocol.scala:237` and `AutoRunTriggerService.scala:122`
   reflowed so each new line is 120 characters or fewer, with the same words. Met.

### Verdict: CONFIRM

### Non-blocking notes
1. `MultiInputSchemaInference.scala:86` puts an inline `scala.util.Try` into a brand-new file. CONTRIBUTING's
   Imports & Qualifiers rule ("never inline a fully-qualified name when an import would do") covers it in spirit,
   even though the checker does not. Design D3 allowed it as an import conversion. Worth a one-line follow-up,
   together with PAS:203/217/253, and possibly widening the checker's prefixes to `scala.util.`/`scala.collection.`.
2. `PipelineAnalyzeService.scala:25` is a newly introduced 127-character line (`stepConfigProblem` delegation). That
   is the same kind of over-long line this ticket fixes elsewhere. D1 mandated the qualified form; the unqualified
   `validateStepConfig(op, rawConfig)` is already in scope through the named import and would have kept the line
   under 120.
3. `PipelineAnalyzeService.scala:10-12`: three blank lines between the imports and `object`. Cosmetic.
4. The reflowed `PipelineAnalyzeProtocol.scala` comment now has a short, ragged line
   (`autoRunnable` too; a permission denial). Words are unchanged, as D7 requires. Cosmetic.
5. The stale doc references to `PipelineAnalyzeService.inferX` in other files are already recorded as follow-up
   candidates in `files-modified.md`.
