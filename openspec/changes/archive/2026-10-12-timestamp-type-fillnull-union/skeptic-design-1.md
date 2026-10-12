## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed HEAD 62164029270bcaadfc0fde2b0f43263cd1314b03 (planning artifacts untracked in the change dir).

### What I verified (with evidence)

Factual claims in design.md, checked against the tree:

- **fillnull is projected as identity.** Confirmed: `StepSchemaInference.scala:27`
  (`case "filter" | "limit" | "sort" | "dedupe" | "fillnull" | "upsertsource" => (inputSchema, None)`).
- **mean/median coerce through `toDouble`.** Confirmed: `FillNullStep.scala:175-184`. HEL-1314's probe
  transcript shows a `Double` written under `ts: timestamp`.
- **inferUnion: the parent type wins a name collision.** Confirmed: `MultiInputSchemaInference.scala:59-68`.
- **Run time is untyped.** Confirmed: `PipelineStep.evaluate(rows: Seq[Map[String, Any]], ctx)` (`PipelineStep.scala:80`).
- **The save path is schema-free.** Confirmed: `PipelineStep.rawConfigProblem(kind, raw)` (`PipelineStep.scala:289`).
  `PipelineCreateTransaction` does call `analyzeNodes`, but it uses the result only for Output
  schemas and never rejects on a `validationError`. I grepped every `validationError`
  consumer in `backend/src/main/scala` and found no write path that gates on one.
- **validationError only clears `canRun`/`autoRunnable`.** Confirmed: `PipelineAnalyzeReads.scala:186-192`.
  The scheduler and the dataset auto-run use `RunConfigGate.stepConfigReasons`, which is
  schema-free (`RunConfigGate.scala:10-23`, `AutoRunTriggerService.scala:103-110`). HEL-1280 policy confirmed.
- **Precedent for a schema-typed analyze error on a step whose run succeeds.** Confirmed: the HEL-1423 coalesce mixed-type error in
  `ColumnSchemaInference.inferCompute:71-74`. The `step-config-invalid` UI copy
  (`denyReasonCopy.ts:56-57`, "results may be wrong or missing") fits this new class.
- **The ExpressionTypeInference `+` rule.** Confirmed: `ExpressionTypeInference.scala:11,30-34`
  (`TextLike = {string,timestamp,boolean}`, and `+` with a TextLike side gives `string`).
  D2's argument against widening holds.
- **`date` canonicalises to `timestamp`.** Confirmed: `model.scala:449-454`.
- **The decode-failure fallback.** `FillNullConfig.decode` is tolerant (`FillNullStep.scala:27-32`), and `checkEnabledStep`
  runs `validateStepConfig` first (`PipelineAnalyzeService.scala:33-41`). Sound.

Red-first design (D3):
- The fillnull case is genuinely red pre-fix. Its run half passes (the probe shows a Double), and its
  analyze half fails (err=None today).
- The **union case is not.** See CR1.

### Verdict: REFUTE

### Change Requests

1. **D3's run harness cannot execute a lane-kind union, so the union "red" would be red for the
   wrong reason.**
   - design.md D3 and tasks 1.2 name `InProcessPipelineEngine.executeWithStepCounts`. That is the
     flat fold (`InProcessPipelineEngine.scala:216-232`), and it is test-only.
   - It builds its context through `makeContext` with the default `resolveLane = (_: String) => None`
     (`InProcessPipelineEngine.scala:698`, `PipelineStep.scala:118`).
   - So `UnionStep.evaluate` with `SecondaryInput.Lane` fails with "Lane reference not found for union"
     (`UnionStep.scala:85-88`). The run-characterisation assertion would throw before the analyze
     assertion is ever reached. That red is counterfeit, and it would stay red after the fix.
   - Required fix: specify `executeTree` (the production path) for the union parity case.
     `InProcessPipelineEngineTreeWalkSpec.scala:21-50` already runs it purely, with
     `new PipelineStepRepository(null)` and `new DataSourceRepository(null)`.
   - Also amend C1 / task 1.3: `red-evidence.md` must show, for each RED test, that the failing
     assertion is the analyze `validationError` assertion, and that the run-characterisation
     assertion passed. It can split them into two tests, or assert run-first with an explicit clue.

2. **The union fix silently leaves the source-kind secondary on the bug path, but the AC says
   "secondary input".**
   - `analyzeNodes` resolves a source-kind secondary only through `sourceDependencyOf`, which covers
     `join` only (`PipelineAnalyzeService.scala:247-251`).
   - `resolveSecondarySourceSchemas` fetches only what `secondarySourceIdOf` returns, which is `join`
     and `lookup` only (`PipelineAnalyzeService.scala:196-201`, `PipelineServiceSupport.scala:100-107`).
   - So for a `union` with `SecondaryInput.Source(...)` (the original union shape and the decode
     default, `SecondaryInput.scala:25`), `secondarySchema` is always `None`. D2 never fires, while
     the run still stacks the source's numeric `ts` under the parent's `timestamp` projection.
   - design.md treats this only as a guard ("unresolved (source-kind) secondary reports no error").
     Its Goals still claim analyze "no longer silently projects `timestamp`" on these two paths.
     That claim is false for source-kind unions.
   - Required fix: take an explicit decision and record it. Either:
     - (a) extend `secondarySourceIdOf`/`sourceDependencyOf` to `union`. State the side effect:
       source-kind union projections then gain the secondary's new fields, which is a projection
       change for existing pipelines and needs its own guard/note. Or:
     - (b) list "source-kind union secondary" explicitly as a residual in Non-Goals, in the
       `pipeline-union-op` spec delta, in the `docs/compute-expression-grammar.md` rewrite (task 4.1),
       and in the PR's OWNER REVIEW section.

3. **Describe "reject at analyze" honestly. It is a diagnostic. It does not close the
   analyze-vs-run disagreement.**
   - proposal.md says "analyze refuses it" and calls both choices "reject". In fact:
     - The always-visible **Run pipeline** and **Dry run** buttons are not gated by `canRun`
       (`PipelineDetailFooter.tsx:317-331`; they are disabled only on run status). `canRun: false`
       hides only the denial block's "Run to update" button (`PipelineDetailFooter.tsx:149`).
     - Scheduled runs and dataset auto-runs are ungated (verified above).
     - The projection stays `timestamp` (D1 identity, D2 "projection unchanged"). A downstream
       `$ts + …` therefore still infers `string`, while every run still produces a number.
   - The ticket's literal symptom is "analyze says string while the run produces a number". That
     symptom remains. It is now accompanied by an error on the upstream step.
   - I judge that an acceptable assumed product call. Given HEL-1280 and the untyped run time, it is
     the only reversible one available. But proposal.md "What Changes", design.md Goals/Risks, the
     doc rewrite (task 4.1) and the PR OWNER REVIEW text must state all three facts above. That way
     the owner rules on the actual behaviour, not on "reject".

### Non-blocking notes

- A step with a `validationError` is marked `Incomplete` in `AnalyzeSchemaWarnings.scala:106`, and
  is skipped at `:133`. So the new errors also suppress downstream schema warnings for an affected
  pipeline. That is worth one line in Risks, and task 3.4's re-run of `AnalyzeSchemaWarningsSpec`
  should cover it.
- The D1 GUARD for "listed column absent from the input schema → no error" is in the spec delta, but
  it is missing from the task 3.1 list. Add it.
- Ticket citation staleness (already noted in premise-validation.md): `probe-timestamp-paths.txt` lives
  in `.concertino/runs/HEL-1314/evidence/`, not in the archive dir. design.md already cites it correctly.
- The stale "union analyze is a passthrough" requirement in `openspec/specs/pipeline-union-op/spec.md:38`
  is correctly out of scope. But the new ADDED requirement now contradicts it more sharply. Consider a
  MODIFIED delta, or a follow-up ticket.
