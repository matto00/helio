## Skeptic Report — final gate (round 5, axis: deletion-sweep completeness)

HEAD verified `d12b19b2`, `git status --porcelain` empty. Every command below re-run fresh in this
worktree. No conclusion inherited from the executor's report or from rounds 1–4; round 4's report was
read as a set of claims to re-test, not as fact.

### What I verified (with evidence)

**1. Round-4 CR2 (`patch-set-preview` stale scatter `SHALL`) — FIXED, and replaced with something true.**
- `specs/patch-set-preview/spec.md:5-19`: the positive ADDED requirement now enumerates only
  blank-title/cross-type-PATCH (`PanelServiceHelpers.resolvePatch`) and pipeline-rename blank-name
  (`PipelineService.updateName`). The scatter+aggregation clause is gone from the `SHALL` list and is
  now explicitly recorded as no-longer-applying, with the deletion reason and a source citation.
- The closing sentence was corrected too: it now reads "The blank-title/cross-type-PATCH and
  pipeline-rename checks … are unchanged and restated here" — no longer the false "the panel/pipeline
  checks it also covered are unchanged".
- **I verified the two surviving `SHALL`s are actually true of shipped code**, not just plausible:
  `PatchSetPreviewProjection.scala:113-115` routes panel-update through
  `PanelServiceHelpers.resolvePatch` and returns `ServiceError.BadRequest` on `Left`;
  `PatchSetPreviewProjection.scala:237-239` `pipelineRenameAfter` does
  `if (request.name.trim.isEmpty) Left(ServiceError.BadRequest("name must not be empty"))`, which
  matches `PipelineService.scala:100-102` verbatim. Both checks genuinely run.
- Scaladoc at `PatchSetPreviewProjection.scala:34-45` is likewise corrected: it now states the scatter
  check "is ALSO gone, not just no-longer-mirrored", and its positive list matches the code above.
- Deletion claims confirmed independently: `find backend/src -name "ChartPanel*"` → nothing;
  `grep -rn "def validateScatterAggregationConflict" backend/src` → nothing. The only surviving
  in-source mentions are the three *explanatory* comments (`PatchSetPreviewProjection.scala:39,117`,
  `PanelServiceHelpers.scala:191`), all of which describe the symbol as removed. Correct.

**2. Round-4 CR1 (`"type": "metric"` examples contradicting the `output` enum) — FIXED.**
`AssistantProposalToolSchemas.scala:51` enum is `("text","markdown","image","output")`; both worked
examples now read `"type": "output"` (`:88` `DashboardProposalExample`, `:207` `propose_combined`).
I checked the binding actually routes: `ProposalPanelSupport.buildDataConfig` (`:168-176`) branches
`if (panel.`type` == "output") JsObject("outputId" -> JsString(dataTypeId))` — so the flat
`dataTypeId` wire field name in the examples is the correct carrier, exactly as the adjacent comment
claims. The self-contradiction round 4 found is resolved. (Sub-item on `fieldMapping`/`aggregation`
not done — non-blocking note 1.)

**3. AC 6.1 grep, run verbatim and fresh.** 7503 raw hits; excluding `db/migration/**`,
`hel904-real-dump.sql`, `backend/src/test`, and comment-only lines leaves **exactly 15 code hits in
6 files** (`PipelineProposalProtocol`, `WorkspaceContextProtocol`, `PipelineProposalService`,
`CombinedProposalService`, `WorkspaceContextService`) plus one history sentence in
`services/panels/README.md`. Byte-for-byte the same wire-field-NAME set rounds 2/3/4 found, and each
is covered by design.md's Exemption 1–4 / value-exemption list (`design.md:317-380`, which I confirmed
exists rather than taking the citation on trust). **AC 6.1 holds.**

**4. `openspec validate outputs-model-migration --type change --strict` → `Change
'outputs-model-migration' is valid`** (exit 0), fresh.

**5. Compile + full suite, fresh single-threaded clean run (HEL-924 protocol).**
`sbt -batch 'set Test/parallelExecution := false' clean compile Test/compile test` →
`Total number of tests run: 3354`, `Tests: succeeded 3354, failed 0, canceled 0, ignored 0`,
`All tests passed.`, `EXIT=0`. (+2 vs round 4's 3352.)

**6. Repo quality gates, all fresh, all green.**
- `node scripts/check-schema-drift.mjs` → `schemas in sync with JsonProtocols (60 checked across 46
  protocol files)`, `panel-type enums in sync with backend canonical sets (7 surfaces checked)`, exit 0.
- `node scripts/check-openspec-hygiene.mjs` → `openspec/ is clean`, exit 0.
- `npm run check:scala-quality` → `Scala code-quality check: clean (130 soft warning(s))`, exit 0.
  All 130 are pre-existing test-file soft line-budget warnings, no hard failures.

**7. Independent phantom-deferral / stale-claim sweep (the eighth-instance check).**
Rather than eyeball 5–6 files, I ran two mechanical sweeps over surfaces I was not pointed at:

- **Every `Type.method` reference across all 71 spec deltas.** Extracted 35 unique backticked
  `Foo.bar` identifiers and tested each method name against `backend/src`. **Exactly one did not
  resolve:** `InProcessPipelineEngine.applyCompute` (`specs/pipeline-compute-op/spec.md:7`). I chased
  it down: no `applyCompute` exists anywhere in `backend/src`, and the compute op actually lives in
  `domain/steps/ComputeStep.scala` (dispatch at `PipelineAnalyzeService.scala:239`). **But this is
  pre-existing base-spec drift, not a HEL-904 regression** — `openspec/specs/pipeline-compute-op/spec.md:10`
  already carried the identical stale name before this ticket, the delta is a `## MODIFIED` block whose
  header explicitly states requirement text is preserved verbatim and only retargeted, and
  `git log -S` confirms HEL-904 only moved the pre-existing line. Non-blocking note 3. The other 34
  identifiers all resolve.
- **Every deferral/future-work claim in the diff's added lines** (`deferred to`, `will be handled by`,
  `follow-up ticket`, `tracked in HEL-`, `see HEL-`, `TODO`, `TBD`, `not yet`). After filtering grep
  noise, three real ones, all checked and all honest:
  - migration-SQL comments deferring to tasks 2.9 / 2.10 / 3.6 / 1.6 — **all four exist in `tasks.md`
    and are `[x]`** (lines 107, 121, 294, 27); no deferral points at a non-existent task.
  - `PipelineStepRepositoryTreeOrderingSpec.scala:17` defers DB-backed splice/reorder coverage to land
    alongside the V94 migration (task 2.2, real) — accurate, and that coverage did land.
  - `specs/workspace-resource-search/spec.md:14` defers the `dataType` wire-value rename to "whichever
    P1.4-adjacent ticket…" — deliberately names **no** ticket id (so it cannot be a phantom) and cites
    design.md's exemption list, which exists. I also verified its factual claims against source:
    `WorkspaceSearchService.scala:38,76-77` really does source `dataType`-kind results from
    `outputRepo.findAllByOwner`, and `:21` records the Metric kind as removed outright.
- **Two additional doc spot-checks, both accurate against ground truth:**
  `services/panels/README.md` — `find backend/src -iname "*BoundPanel*"` → nothing (claim true), and
  its "Holds:" file list matches `ls services/panels/` exactly (6 files, no drift).
  `domain/panels/package.scala:8` — `grep -rn "dataTypeIdFormat\|metricIdFormat" backend/src` returns
  only that comment itself; both formats really are gone.

**No eighth instance of the phantom-deferral / false-assertion defect class was found.** The one
non-resolving identifier is inherited pre-existing drift, not something this ticket asserted.

### Verdict: CONFIRM

Both round-4 change requests are genuinely fixed — and fixed correctly, not merely deleted: the
`patch-set-preview` requirement and the `PatchSetPreviewProjection` scaladoc now describe checks I
confirmed actually execute in shipped code, and the agent-facing examples now validate against the
enum published beside them. The AC grep is unchanged from rounds 2–4, `openspec --strict` passes, all
three repo gates are green, and the full suite is 3354/3354 on a fresh clean single-threaded run.

**Nothing found in this round raises a DESIGN question or changes live-execution semantics.** The
three items below are inert documentation/example polish. Per the coordinator's standing instruction,
they are within the orchestrator's judgment to close out (or defer) without another round-trip.

### Non-blocking notes

1. **Round-4 CR1's sub-item was not done:** both examples still carry `"fieldMapping"` and
   `"aggregation"` keys (`AssistantProposalToolSchemas.scala:90-91`, `:209-210`) on an `output`-kind
   panel. These are **inert, not invalid** — `ProposalPanel` still declares both as `Option[JsObject]`
   so the JSON decodes, and `buildDataConfig`'s `output` branch emits only `outputId`, discarding
   them. So nothing breaks; the example merely shows a model two keys that no longer do anything on a
   placed Output. Worth deleting, but it cannot cause a validation failure the way the `"type":
   "metric"` defect could.
2. `AssistantProposalToolSchemas.scala:60` still advertises a `metricId` property, and `:80-81`'s
   comment still describes the placeholder as "never a real DataType id". Both inert; carried from
   rounds 3 and 4 and still open.
3. `pipeline-compute-op/spec.md:7` names `InProcessPipelineEngine.applyCompute`, which does not exist
   (the op is `domain/steps/ComputeStep.scala`). **Pre-existing in the base spec at
   `openspec/specs/pipeline-compute-op/spec.md:10`, inherited verbatim — not introduced here.** Since
   this delta rewrites that requirement anyway, correcting the name in the delta is nearly free and
   would stop the wrong name from being re-published into the base spec on archive. Otherwise it is a
   fair spinoff.
4. `RefinementEditShape.scala`'s ~8 worked examples for deleted panel kinds (round 4's note) remain,
   correctly scoped to HEL-907 per `tasks.md:260` and the remodel design doc; still worth carrying
   explicitly on that ticket rather than leaving it to be rediscovered.
5. `metric-crud-api/spec.md`'s five identical pasted Migration sentences (rounds 2/3/4) remain; cosmetic.
