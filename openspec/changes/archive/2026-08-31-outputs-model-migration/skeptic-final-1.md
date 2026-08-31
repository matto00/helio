## Skeptic Report — final gate (round 8; axes: migration-correctness + deletion-sweep)

HEAD `90cd5741592b89ffd9b8b91aef8fabc7a9bd8941`, `git status --porcelain` empty before and after
every probe. Written to `skeptic-final-1.md` rather than this change's usual per-axis name because
`scripts/concertino/next-report-number.sh` only accepts `evaluation|skeptic-design|skeptic-final`
as a kind; this is the collision-safe path it returned. It covers BOTH axes for round 8.
Wire-contract-diff was CONFIRMED at round 6 and this cycle's diff touches no routing or
response-shape code (`git show 90cd5741 --stat`: one scaladoc block, one prompt string object, one
test, one schema `description`, one new spec delta, plus change-dir bookkeeping) — not re-checked.

### Verdict: REFUTE

One required fix, on the migration-correctness axis. The deletion-sweep axis is **CONFIRM**.

The finding is contained, documentation-only, and is a factual error introduced *by the round-7 fix
itself* — not new scope. It is the exact claim round 7 flagged as an overclaim in a code comment
(non-blocking note 1), which this commit then propagated verbatim into two **binding** contract
surfaces (`schemas/` and a new spec delta). It needs no code change, no test, no design decision.

---

### What I verified (with evidence)

**A. Deletion-sweep — round-7 CR1 is genuinely fixed. CONFIRM.**
Read the current `AssistantSystemPrompt.scala` in full, not the diff alone:
- `:40-43` worked `propose_dashboard` example now emits `"type": "output"` with `dataTypeId` only;
  `fieldMapping`/`aggregation` gone. `PanelType.fromString("output")` → `Right`, and it now agrees
  with the sibling tool schema `AssistantProposalToolSchemas.scala:51`
  (`enum ["text","markdown","image","output"]`). The two halves of the prompt no longer disagree.
- `:63` `find` description → "sources, DataTypes, pipelines, and dashboards" — "and metrics"
  removed, matching `WorkspaceAssistantTools`' real `ResourceTypeEnum`.
- `:101` "never fabricate a resource id" list → `metricId` removed.
- `:84` `propose_patch_set` target list → "a panel, dashboard, data source, pipeline, or pipeline
  step"; `DataType` removed, matching `PatchSetProtocol.recognizedKinds`.
- Fresh grep over the file for `metric|Metric` → **zero** hits. Remaining `DataType` hits
  (`:47`, `:63`, `:65`, `:75`, `:77`, `:80`) are all the surviving, still-live resource-type name
  and the `dataTypeId` wire field kept for schema stability (design.md Exemptions 1–4); none is
  factually false. `panelCapabilities` (`:66`) is still live — `AssistantToolExecutor.scala:169`
  emits it. Non-blocking wording only.

**B. The three new prompt pins are genuinely failable — mutation-proved by me, not taken on report.**
Restored `AssistantSystemPrompt.scala` to its `1e56bc04` (pre-fix) content and ran
`sbt -batch 'testOnly …AssistantSystemPromptSpec'`:
```
- should never mentions deleted panel kinds or retired Metrics/DataType resource ids *** FAILED ***
- should retargets the worked propose_dashboard example to the output panel kind    *** FAILED ***
- should does not offer DataType as a propose_patch_set edit target                 *** FAILED ***
Tests: succeeded 9, failed 3
```
Restored; `git status --porcelain` empty. All three regression guards are real, not vacuous.

**C. Gates re-run fresh by me.**
- `openspec validate outputs-model-migration --type change --strict` → `Change
  'outputs-model-migration' is valid`, `EXIT=0`.
- `node scripts/check-schema-drift.mjs` → in sync (60 protocols / 46 files; 7 panel-type surfaces).
- `node scripts/check-openspec-hygiene.mjs` → `openspec/ is clean`.
- `sbt -batch 'set Test/parallelExecution := false' 'testOnly …AssistantSystemPromptSpec
  …PipelineStepRoutesSpec'` → `Tests: succeeded 76, failed 0`, `All tests passed.` (scoped to the
  areas this cycle touched; the full 3367-test suite was run fresh at rounds 6 and 7 and no
  production code changed in this commit beyond two doc/prose strings).

**D. The new `pipeline-steps-persistence` delta does not collide with `pipeline-step-tree`.**
They are distinct capabilities in distinct delta directories. The tree delta contains only `ADDED
Requirements` (`A step records its parent step`, `Position orders siblings, not the whole pipeline`,
`The repository exposes tree-ordered reads`, `Deleting a step splices the tree`, `At most one trunk
child per node`) — no requirement header overlaps the persistence delta's single `MODIFIED`
requirement. That `MODIFIED` header string (`POST /api/pipelines/:id/steps appends a new step`)
matches `openspec/specs/pipeline-steps-persistence/spec.md:91` byte-for-byte, and every scenario
title is preserved verbatim from the live spec, so the merge target resolves; strict validate
agrees. The delta's own preamble correctly defers to the tree delta for splice semantics rather
than restating them, so there is no second, divergent definition.

**E. `PipelineStepProtocol.scala` scaladoc and the schema `description` were both updated** and are
correct on the `position`-absent branch: "trunk continuation … persisted `position = 0` — not the
old MAX(position)+1". Verified against `PipelineService.persistNewStep`'s `case None` branch
(`:608-610`: `listByPipelineInternal` → `trunkOf(current).lastOption` → `spliceInsertAtInternal`).
That half of the round-7 CR is correct.

---

### Change Requests

**1. The round-7 fix carried the "`position = count` is equivalent to append/trunk continuation"
overclaim into two binding contract surfaces, where it is factually false for tail-bearing
pipelines — which real migrated data has.**

Ground truth, traced in code:
- `PipelineService.persistNewStep`, `case Some(index)` (`:637`):
  `val anchorParentId = if (index == 0) None else Some(current(index - 1).id)`.
- `current` is `pipelineStepRepo.listByPipelineInternal(...)`, which is
  `executionOrder(...)` (`PipelineStepRepository.scala:160-163`) — **whole-pipeline execution
  order**, not the trunk.
- `executionOrder` (`:580-595`) is `node +: (tails ++ trunkChild.flatMap(walk))`, so a node's tails
  are emitted **after** that node's trunk continuation. For a trunk `A → B` where `B` bears a tail
  `T`, execution order is `A, B, T` and `current.last` is `T`. (This ordering is independently
  pinned by a passing test in `PipelineStepRoutesSpec`: *"duplicate … WITH a tail-bearing anchor
  splices the clone directly after the original, **before the pre-existing tail**"*.)
- Therefore `position = count` anchors on `T` (a **tail**), while the `position`-absent branch
  anchors on `trunkOf(current).last` = `B`. The two are **not** equivalent whenever the pipeline
  ends in a tail. Round 7's own probe against the real scrubbed dump shows exactly this shape:
  `EXEC b6ac->b98b->18ed->41a4->dbd7->d3a0->hel9` (`hel9` a tail, last in execution order).

The two false statements, both authored in `90cd5741`:
- `schemas/pipelines/create-pipeline-step-request.schema.json:5` — *"`position = count` is
  equivalent to trunk continuation"*.
- `openspec/changes/outputs-model-migration/specs/pipeline-steps-persistence/spec.md`, the
  `position`-present bullet (*"`position = count` is equivalent to trunk continuation (append)"*)
  and the scenario **"Insert at count equals append"**, whose body asserts *"the created step is
  spliced onto the current trunk-last step (identical to the position-absent, trunk-continuation
  behavior above)"*. This is a **binding spec scenario asserting behavior the code does not have**
  — the precise defect class round 7's CR existed to close, reintroduced one layer up.

Required (doc-only, mechanical): state the actual anchor rule — an explicit `position` resolves to
the step at whole-pipeline execution-order index `position - 1` (`position = 0` → the pipeline
root), which coincides with trunk continuation **only when the pipeline's execution order ends on
the trunk**, i.e. when the trunk-last step bears no tails. Reword the schema sentence, the spec
bullet, and the "Insert at count equals append" scenario body accordingly (the scenario *title* is
preserved from the live spec and can stay; its body must stop claiming identity). Existing tests
already pass under the corrected wording — their fixtures are tail-free, so no test change is
needed.

Note the same overclaim still sits in `PipelineService.persistNewStep`'s `case None` comment
(`:606-607`, *"so 'append with no position' and 'append at position == count' behave identically"*)
— round 7's non-blocking note 1, still open. Worth softening in the same pass since it is the
source the schema and spec prose were derived from.

---

### Non-blocking notes

1. `AssistantSystemPrompt.scala:65-66` (`get_resource` → "For a DataType … panelCapabilities menu")
   and `:74-75` ("bound to EXISTING pipeline-output DataTypes") still say DataType where the new
   model says Output. Round 7 raised these as "for consistency", not as errors, and they are not
   factually false: `panelCapabilities` is live (`AssistantToolExecutor.scala:169`), `dataType`
   is still in `find`'s `ResourceTypeEnum`, and `dataTypeId` is a deliberately retained wire name
   (design.md Exemptions 1–4). Genuinely non-blocking.
2. Round-7 non-blocking notes carried forward unchanged, all re-read and all still correctly
   classified non-blocking: undo/rollback restoring a deleted mid-trunk step at the trunk end
   (follow-up ticket material — needs `parentStepId` on the wire); `ProposalPanelSupport`'s two
   stale scaladoc blocks (`:28-31`, `:46-53`); `AssistantProposalToolSchemas`' inert
   `metricId`/`fieldMapping`/`aggregation` properties and worked-example keys (its `type` enum is
   correct, so nothing is broken); `tasks.md`'s stale `PatchSetApplyContext` justification;
   `metric-crud-api/spec.md`'s duplicate Migration sentences; flat-sibling route fixtures.
3. The new spec delta's "Insert renumbers pre-existing gaps contiguously" scenario is now a
   somewhat strained fit for a model with no whole-pipeline renumbering (its body essentially says
   "gaps cannot occur"). It is not false, and the title is preserved from the live spec for
   MODIFIED-merge fidelity, so this is style only.
