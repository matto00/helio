## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD: 1788b013aba7251a6206e4060a507c4db73ee265. Diff base resolved live with `resolve-review-base.sh` (main/origin): dfb65eebb2dac32afbd1eaeb7fd6e94b369d0369. The spawn-cwd guard returned READY. The only untracked file is evaluation-2.md.

### What I verified (with evidence)

**AC1: a test that fails first, in which an assistant proposal with an `insight` Output validates and applies.**
- `PatchSetInsightOutputSpec` "RED: preview and apply a valid insight" previews and applies a patch-set insight create. It asserts the stored kind is `Insight`, `refresh` is `manual`, and `reads.outputs` holds the table id.
- red-run.md records 11 failures on main, and its cause is a real probed defect. On main, a patch-set create runs `PipelineCreatePreflight`'s new-pipeline rule, which refuses any `reads.outputs`. So a valid read was refused at preview.
- The fix is in `PatchSetOutputResolvers.resolveOutputCreate`. It strips `reads` before `OutputFieldMappingCheck` and judges `reads` with the stored-id `InsightReadsCheck` against `listByPipelineInternal`.
- The pipeline-proposal path is covered by `AssistantInsightNoRenderSpec`: a manual insight applies, and a non-empty `reads.outputs` gets a 400.

**AC2: kind list and docs come from one source, and the drift spec checks positively.**
- `AssistantProposalToolSchemas` now builds the kind enum as `OutputKind.all.map(OutputKind.asString)`. The six-kind literal is gone.
- `DocumentedKnownKeys` is deleted, and `KeysDoc` iterates `KnownKeys`.
- The insight sentence interpolates its values from constants: `InsightPreset.all`, `InsightRefresh.all`, `MaxPromptChars`, `MaxReadOutputs`, `MaxReadWindows`, `MaxSentencesRange`, `MaxCharsRange` and the defaults.
- `OutputKindDriftSpec`'s exclusion block is replaced by positive checks. These read the built tool `inputSchema` value, not source text, and check every `OwnKeys` key and every preset and refresh value inside the `insight:` segment.
- `check-schema-drift.mjs` resolves the derived enum from `OutputKind.fromString`, and its stale `insight` allowance is deleted. I ran `node scripts/check-schema-drift.mjs` fresh: exit 0, "AssistantProposalToolSchemas.scala in sync with schemas/ (14 surfaces checked)".
- I confirmed the "no fieldMapping (leave it out)" doc claim against `InsightConfig.Keys`/`OwnKeys` (InsightConfig.scala:35-37) and findings.md (`OutputBindingSpec.Insight` has no slots).

**AC3: creating the insight through a proposal does not render it.**
- `AssistantInsightNoRenderSpec` wires a REAL `InsightRenderService` through `RecordingTrigger`, over a `FakeInsightModel` that fails on every call. It does not use the NoOp trigger.
- Patch-set path: an `on_run` insight is created on a pipeline that has already succeeded once. After the bounded registration poll and the backfill await, the spec asserts 0 model sends and 0 rows. Its control is a following real run, which yields 1 send.
- Pipeline-proposal path: a manual insight gets 0 sends, and its `on_run` control gets 1 send.
- The apply run rendering an `on_run` insight is existing HEL-1743 behaviour, settled at the design gate. The tool docs and system prompt now tell the model to use `refresh: "manual"`.
- Recorded mutations M1–M6 (drift-mutations.md) go red. The evaluator's independent scratch-worktree delay probe and M1 re-run are logged in `.concertino/scratch/HEL-1779/eval2-probe-*.txt`. I did not repeat them: the assertions are content assertions (counts and rows), not timing or mtime claims.

**AC4: no live model call.**
- All three model-reachable tests use `FakeInsightModel`. None of the new specs constructs a `ClaudeClient` or transport.

**Preview/apply parity.**
- Preview and apply share one resolver: both `PatchSetPreviewService:49` and `PatchSetApplyService:87` call `PatchSetApplyResolvers.resolveAll`.
- The update path now checks reads against the pipeline's Outputs, which matches `OutputService.update`.
- `rejectReadsOfDeletedOutputs` is a set-level pass next to `rejectEditedOutputNodes`. By reading the logic, its removal would let the per-edit check pass (X is still stored), so M5's red is discriminating.

**Gates, run fresh by me at 1788b013a:**
- I ran `sbt -J-Xmx3g testOnly` (nice 19) on six specs: PatchSetInsightOutputSpec, AssistantInsightNoRenderSpec, OutputKindDriftSpec, AssistantProposalToolSchemasSpec, OutputConfigValidationSpec and RefinementEditShapeSpec. Result: "Tests: succeeded 97, failed 0", exit 0. Log: `.concertino/scratch/HEL-1779/skeptic-targeted.txt`.
- `npm run check:scala-quality`: "clean (287 soft warning(s))", exit 0.
- `git diff --check base...HEAD`: clean.
- I relied on the evaluator's pasted full-suite totals (10,069 passed, 0 failed, with logs in scratch) rather than re-running about 40 minutes of sbt. They are concrete and unambiguous.

**UI:** N/A. There is no `frontend/**` change. D8 was checked by the executor (`PipelineProposalSummary` prints `kind` as text, and there is no kind-keyed map).

### Verdict: CONFIRM

### Non-blocking notes
- `rejectReadsOfDeletedOutputs` on an output UPDATE judges any `reads` present in the patch, even one identical to the stored value. Apply's tolerance rule (`readsChanged`) would accept that case and leave the reads dangling. So preview is marginally stricter than apply in this one edge, which fails closed. Not worth a cycle.
- The double-update-of-one-Output edge was recorded by the executor as pre-existing, and it is.
- findings.md records a single unexplained failure of `AssistantInsightNoRenderSpec` in a very large combined shard, before the cycle-2 wait fix. That fix addressed a real registration race, and the spec has been green in every run since, including mine. Watch CI for a recurrence.
