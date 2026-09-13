## Skeptic Report — final gate (round 2, skeptic-final-2.md)

Reviewed HEAD: `181f537fb6b2c0d70aa7e3dc10a7bb4479b35565` (clean working tree). Base resolved live via
`resolve-review-base.sh` = `0cc7aef797be23b6358266daf9a96f3b96f9b7ff` (3 commits: cb7d1a8d, 6adc97c0, 181f537f).

### What I verified (with evidence)

**Gates, re-run fresh by me**
- Run A: `sbt testOnly *ApplyWriteBacks* *UpsertSource* ... *PatchSetPreview*`. Exit 0: `Suites: completed 10, aborted 0`,
  `Tests: succeeded 74, failed 0`. Suites that ran: DataSourceRepositoryApplyWriteBacks{,Rls}Spec,
  PatchSetPreviewProjectionStepsUpsertSourceSpec, PatchSetPreviewRoutesSpec, PatchSetPreviewServiceSpec,
  PipelineAnalyzeUpsertSourceSpec, PipelineRunServiceUpsertSource{,Rls}Spec, UpsertSourceConfigSpec, UpsertSourceStepSpec.
  - The bare (non-glob) class names in run A matched nothing. I noticed this from the suite list and re-ran them:
- Run B: `sbt testOnly *.PipelineCycleDetectionServiceSpec *.PipelineCreateTransactionalSpec *.PipelineStepSpec
  *.PipelineAnalyzeServiceSpec *.PipelineStepRequiredConfigSpec *.PipelineRunServiceSpec *PipelineStepConfigCodec*`. Exit 0:
  `Suites: completed 7, aborted 0`, `Tests: succeeded 354, failed 0`.
- Frontend: `jest stepNarrowing|useStepCardState|StepCard.test` 3 suites / 75 passed (exit 0); `npm run lint` exit 0;
  `npm run typecheck` exit 0.
- I did not re-run the full backend suite.

**CR1 (analyze 500): FIXED, reproduced live**
- Code: `PipelineService.toAnalyzeStepResponse` now has a `case Success(cfg: UpsertSourceConfig)` arm.
  `UpsertSourceAnalyzeStepResponse` was added, and `PipelineAnalyzeProtocol` has both write and read arms for it.
- Freshness of the running backend: the process started 13:33, before HEAD's 13:45 commit, so I did not rely on mtime. The 200s
  below are self-authenticating: the pre-fix code throws on this input, and the working tree is clean.
- Live (backend :9439, CSRF header set), with a pipeline created via `POST /api/pipelines` (201) with one `upsertsource`
  existingSource/append step:
  - `GET /analyze` returned 200 on 3 of 3 tries. Step `upsertsource` in=[id,label,note], out=[id,label,note], validationError=None
    (pass-through).
  - `POST /api/pipelines/analyze-proposal` with an upsertsource step returned 200 on 2 of 2 tries.
  - The control (`limit` step) returned 200 as well.
- Editor: loading `/pipelines/<id>` in the browser issues `GET .../analyze` → 200. The only console error is
  `GET .../schedule` 404, the normal no-schedule response, and it is unrelated to this change.
- `PipelineAnalyzeUpsertSourceSpec` drives `PipelineService.analyze` and `analyzeProposal` with a real embedded DB. It
  asserts output==input and that the downstream select's input == the upsertsource input. It passed in run A.
- Both probe pipelines were deleted afterwards (204, 204).

**CR2 (patch-set preview MatchError): FIXED**
- `PatchSetPreviewProjectionSteps.scala`: arms were added in `withPosition` (`case s: UpsertSourceStep`) and in
  `withDecodedConfig` (`(UpsertSourceStep, UpsertSourceConfig)`). `PatchSetPreviewProjectionStepsUpsertSourceSpec` calls both
  helpers directly (position updated; Right with the new config). It passed.

**C4: independent audit of per-kind exhaustive matches (my own grep, not the executor's table)**
- Every `backend/src/main` file naming a sibling kind type (`AssertStep`/`AssertConfig`, cross-checked with
  `LimitStep`/`LimitConfig`), with UpsertSource occurrence counts: `domain/package.scala` 4/4, `PipelineStepProtocol` 3/3,
  `PipelineStepConfigCodec` 2/4 (has `case c: UpsertSourceConfig`), `PipelineStep.scala` 3/2 (registry),
  `PipelineAnalyzeProtocol` 2/2, `PipelineService` 2/4, `PipelineStepRepository` 1/13, `PatchSetPreviewProjectionSteps` 2/2.
  The remaining hits are the kinds' own files or README, or `shapes/*`, `DedupeStep`, `StepCodecUtil`, which construct
  `LimitStep` rather than match across all kinds.
- String-kind matches (`PipelineStepKind.Assert` vs `.UpsertSource`): `PipelineStepProtocol` 2/2, `PipelineAnalyzeProtocol` 2/2.
  `PipelineStepConfigCodec` 1/0 is an encode dispatch whose adjacent `case c: UpsertSourceConfig` arm covers the kind.
- Frontend: the only per-op `case "assert"`/`"lookup"` switch is `stepNarrowing.ts`, and it is guarded by the D9
  `isUnsupportedOpType` fallback, which is tested.
- The only per-kind match still missing an upsertsource arm is `SparkJobSubmitter.applyStep`, ruled on below. I found no
  remaining defect of the CR1/CR2 class.

**Ruling on the deliberate non-fix: `SparkJobSubmitter.applyStep` partial match. ACCEPTED.**
- `applyStep` (`SparkJobSubmitter.scala:220`) already has a `case _` fallthrough for the ops Spark does not support
  (it handles roughly 10 of 23). Adding an arm there would mean silently dropping the write, which is worse than the current
  behaviour.
- Reachability: `execute` (:159) is only reached via `PipelineRunService.runPipeline`, which rejects at submit time
  (`PipelineRunService.scala:323`) when `!backend.supportsWriteBack` and any enabled step is upsertsource. The trait default is
  `false`; only `InProcessExecutionBackend` overrides it to `true`. The other entry point (:78, `submit`) has no route caller
  (documented as dormant, HEL-202). The ops-not-supported class is pre-existing and out of scope.

**CR3 (deferral scenarios)**
- New tests exist and passed in run A: `PipelineRunServiceUpsertSourceSpec:202` "a later-failing sibling step ... leave the target
  byte-identical" and `:223` "previewStep on an upsertsource step ... leave the target unchanged".
- I did not re-execute the mutations. The red-then-green claims rest on files-modified.md.

**CR4 (concurrent reader)**
- `DataSourceRepositoryApplyWriteBacksSpec:83-133` now asserts every read `== oldNames || == newNames` (`invalidReads`), and asserts
  `overlappingReads > 0`. That is the required strength. It passed.
- As with CR3, I did not re-run the split-transaction mutation myself.

**AC trace (spot-level):** append preserves rows (RunService spec :157); atomic replace (CR4 test); fault injection
(ApplyWriteBacksSpec :140); validator failure (:185 RunService); RLS under NOSUPERUSER (both Rls specs, run A); cycle guard
across paths (PipelineCycleDetectionServiceSpec, run B); op wiring + three rejections kept (PipelineCreateTransactionalSpec, run
B; grep above); editor fallback (jest + live editor load with analyze 200).

**UI:** the diff's only UI change is the round-1-verified read-only fallback notice, which reuses the existing
`pipeline-detail-page__step-card-desc` class and adds no new styling. The one visual gap is unchanged from round 1: light theme
was not checked visually. I took no screenshots, and no screenshot or mtime evidence is load-bearing here.

### Verdict: CONFIRM

### Non-blocking notes
- The mutation red-then-green records for CR3/CR4 were not independently re-executed. The test assertions are the right shape to
  fail under the named mutations.
- When HEL-202 wires `SparkJobSubmitter.submit` (:78) into a real route, that path must apply the same `supportsWriteBack` guard.
  Today it bypasses `runPipeline`.
- Housekeeping: `/home/matt/Development/helio/hel1100-skeptic-unsupported-step-{collapsed,expanded}.png` at the main checkout root
  are left over from round 1. I did not create or delete them. This round's Playwright accessibility snapshot landed in the
  main-root `.playwright-mcp/` (an MCP default location).
- No gate defect: no mtime-ordering claim was accepted.
