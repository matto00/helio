## Skeptic Report — final gate, dimension `migration-correctness` (round 6, HEAD `0ac6c4ec`)

### Verdict: REFUTE

Both round-5 findings **are** genuinely fixed, and I reproduced both mutation proofs myself
(red → restored → green). The exhaustive `position` inventory is genuinely exhaustive for
**writes of the `position` column**. But item 8's "is there any remaining writer this pass
missed?" turned up a different, larger hole the inventory's own framing let through: the
inventory audited *`position` writers* and never audited the **`parent_step_id` writers** — and
the single most-used step-creation path in the product (`addStep` with no `position`, i.e.
`insertInternal`'s default `parentStepId = None`) creates a **root sibling, not a trunk
continuation**. On a post-V94 world that silently breaks the run-result node key and the
Output→rows binding on every pipeline built through the ordinary path.

Reproduced independently on a fresh embedded Postgres with the real `db/migration` set, three
probes, output pasted below.

---

### What I verified (with evidence)

**0. Ground truth.** `git show HEAD` read in full; `PipelineStepRepository.scala` (`insert`,
`insertInternal`, `update`, `updateInternal`, `positionScopedUpdateAction`, `insertAtInternal`,
`spliceInsertAtInternal`, `reorderInternal`, `deleteInternal`, `siblingsQuery`, `childrenOf`,
`trunkOf`, `tailsOf`, `executionOrder`), `PipelineService.persistNewStep`/`updateStep`,
`PipelineProposalService.createPipeline`/`addSteps`, `PatchSetApplyRollback`,
`PatchSetUndoService`, `PipelineRunService.onUnblockedRunSuccess`, `PanelCapabilityService`
all read from the files. Working tree clean apart from the sibling skeptics' round-6 reports.

**1. Redid the inventory myself — the executor's `position`-writer list is complete.**
`grep -rn "stepsTable\|pipeline_steps" backend/src/main/scala --include=*.scala` confirms
`stepsTable` appears in **exactly one file**: `PipelineStepRepository.scala`. No raw
`sql"..."`/`sqlu` anywhere in main writes `pipeline_steps` (`grep` for `sqlu|sql"` ∩
`position|pipeline_step` → zero hits). `DemoData.scala` contains no `position` write for steps.
Within the repository the six writers are `insert`, `insertInternal`, `insertAtInternal`,
`spliceInsertAtInternal`, `positionScopedUpdateAction` (via `update`/`updateInternal`),
`reorderInternal`, plus `deleteInternal`'s splice-on-delete (`:459-460`, writes the head child
into the deleted row's own `parentStepId`/`position` slot — sibling-scoped, correct). All are
sibling-scoped. **The executor's writer inventory is CONFIRMED complete.**

**2. `positionScopedUpdateAction` genuinely re-scopes rather than luck-clamping.**
(`:251-276`.) On a pure trunk each node has exactly one child, so `others.size == 0` and
`clamped = requested.max(0).min(0) == 0` **by construction** — trunk severing is structurally
impossible, not avoided by coincidence. Verified empirically in Probe C below and by the
mutation proof in item 6.

**3. Real-shape exercise — the round-5 collapse no longer reproduces.**
`V94OutputsMigrationSpec` (33/33) runs the mid-trunk-PATCH invariant and the run-result-node-key
stability assertion against the real 20-step migrated pipeline `6ba5075b-…` and is green on my
own fresh run. Probe C (below) additionally exercises the PATCH on a synthetic trunk+tail shape
the migration produces.

**4. MCP / patch-set call chains traced myself — all really route through the fixed path.**
- `helio-mcp/src/tools/write.ts:1075` → `api.updatePipelineStep` →
  `helio-mcp/src/helioApi.ts:965`: `this.http.patch('/api/pipeline-steps/${stepId}', patch)`.
- `PatchSetApplyRollback.scala:180` and `:285` (`fullPipelineStepInverse`, `position =
  Some(prior.position)`) → `pipelineService.updateStep`.
- `PatchSetUndoService.scala:250` → `pipelineService.updateStep`.
- `PipelineService.updateStep:665` and `:732` → `pipelineStepRepo.updateInternal` → the new
  `positionScopedUpdateAction`. No second write path exists (item 1 proves `stepsTable` is
  single-file). **CONFIRMED transitively fixed.**

**5/6. Both mutation proofs reproduced by me, not taken on report.**

Mutation A — unscope the clamp (`clamped = requested.max(0).min(others.size)` → `= requested`):
```
- should never sever a trunk: PATCHing position on a mid-trunk step re-scopes ... *** FAILED ***
- should MUTATION PROOF: the unscoped write this replaced would have severed the trunk *** FAILED ***
Tests: succeeded 42, failed 2
```
Mutation B — revert the splice fix (`siblingsQuery(...).result` → `.filter(_.position === 0).result`):
```
- should reparent a tail-only anchor's tail onto the new step ... *** FAILED ***
- should reparent BOTH the old trunk continuation and an existing tail onto the new step *** FAILED ***
- should MUTATION PROOF: reverting to position-0-only reparenting reproduces the misplacement *** FAILED ***
- should POST with position: 0 inserts before all existing steps and shifts them down *** FAILED ***
- should POST /pipeline-steps/:id/duplicate ... tail-bearing anchor ... *** FAILED ***
Tests: succeeded 69, failed 5
```
Restored (`git checkout` the one file) → `PipelineStepRepositorySpliceSpec` +
`PipelineStepRoutesSpec` + `V94OutputsMigrationSpec`: `Suites: completed 3, aborted 0` /
`Tests: succeeded 107, failed 0`. Both guards are genuinely failable. **CONFIRMED.**

**7. Full suite, fresh, single-threaded.**
`sbt -batch 'set Test/parallelExecution := false' test`:
```
[info] Tests: succeeded 3365, failed 0, canceled 0, ignored 0, pending 0
[info] All tests passed.
EXIT=0
```
(First attempt aborted in 5s with `FileNotFoundException: target/test-reports/TEST-…DataSourceServiceSpec.xml`
— a missing-directory environmental flake, **not** a code failure. Re-run after `mkdir -p
target/test-reports` was fully green, so per the reproduce-before-refuting rule this is a
measurement artifact, not a finding.)

**8. Final broad sweep — FOUND THE FINDING BELOW.** No sixth *`position`* writer exists (item 1).
But the sweep's real yield is that `insertInternal`'s **default `parentStepId = None`** is the
`addStep` path, and it makes new steps root siblings rather than trunk continuations. Probes:

```
PROBE A: three addStep-without-position calls (the exact PipelineService.persistNewStep
         `req.position == None` branch, PipelineService.scala:595) on a fresh pipeline
  positions/parents: 826a(p=0,par=None) 5940(p=1,par=None) 1677(p=2,par=None)
  executionOrder:    826a -> 5940 -> 1677          <- looks right
  trunkOf:           826a                          <- trunk is ONE step
  RUN-RESULT NODE KEY (trunkOf.lastOption) = Some(826a)   <- the FIRST step
  LAST step in exec order                  = Some(1677)

PROBE B: post-V94 migrated pure trunk a->b->c, then one addStep-without-position
  BEFORE trunk: a70a -> 29c5 -> 8dda     BEFORE node key: Some(8dda)
  NEW step d=39f7 position=1 parent=None                  <- a ROOT TAIL, not on the trunk
  AFTER execOrder: a70a -> 29c5 -> 8dda -> 39f7
  AFTER trunk:     a70a -> 29c5 -> 8dda   AFTER node key: Some(8dda)   <- unchanged

PROBE C: PATCH position=1 on a trunk step that has a sibling tail (non-blocking note 1)
  BEFORE trunk: 9b95 -> 1df9 -> fb67      BEFORE node key: Some(fb67)
  AFTER  trunk: 9b95 -> 3a95              AFTER  node key: Some(3a95)
```
Probe source: `…/scratchpad/SkepticProbeSpec.scala`, run as a temporary spec under
`backend/src/test/.../pipelines/` and **deleted afterwards** (`git status` verified clean of my
changes). Same harness as `PipelineStepRepositorySpliceSpec` (EmbeddedPostgres + real Flyway
`classpath:db/migration`).

---

### Change Requests

**1. `addStep` without a `position` creates a ROOT SIBLING, not a trunk continuation — so the
run-result node key and the Output→rows binding diverge on the primary creation path.**

`PipelineService.persistNewStep` (`PipelineService.scala:595`), the `req.position == None`
branch, calls `pipelineStepRepo.insertInternal(pipelineId, type, config, enabled)` — leaving
`parentStepId` at its `None` default (`PipelineStepRepository.scala:181-186`), so every step
after the first becomes a root-level tail at `position = 1, 2, 3…`.

Consequences, all reproduced above:

- **Probe A (pipelines created after this ticket):** all steps are flat root siblings, so
  `trunkOf` returns exactly one step and `PipelineRunService.scala:632-636`'s
  `trunkOf(steps).lastOption` — the key `nodeSnapshotRepo.overwriteRows` and
  `binaryRefRepo.overwriteForNode` write the run's rows under — is the **first** step of the
  pipeline. Meanwhile `PipelineProposalService.scala:363` binds the created Output to
  `createdSteps.lastOption` ("the Output attaches to the LAST trunk step created"), and
  `PanelCapabilityService.scala:50` reads rows with
  `nodeSnapshotRepo.listRows(output.node.pipelineId, output.node.stepId)`. Writer key ≠ reader
  key ⇒ every proposal-created pipeline's Output reads a node nothing was ever written under.
- **Probe B (migrated pipelines):** adding a step to a real V94-migrated pipeline leaves the
  trunk and the node key unchanged — the new step is off-trunk and can never affect what the
  pipeline produces, while `executionOrder` still lists it last so it *looks* correct in the API.
- This also contradicts `executionOrder`'s own scaladoc
  (`PipelineStepRepository.scala:576-579`): "real migrated data never produces these [root-level
  tail branches] (every pipeline has exactly one root child)". The primary add path produces
  exactly that on the very next add.

Why the green 3365-test suite misses it: every test that asserts trunk/node-key behavior seeds
its parent chain explicitly via `insertInternal(..., parentStepId = Some(...))`, and every test
that exercises `addStep` asserts only `executionOrder`/ids — which are coincidentally correct
here. No test crosses the two.

Required:
1. Make the no-`position` `addStep` append onto the **trunk end** (parent = `trunkOf(current).last`,
   `position = 0`) rather than the pipeline root — i.e. the same splice primitive the explicit-
   `position` branch already uses, with the anchor resolved to the last trunk node. `insertInternal`'s
   `parentStepId = None` default should stop being the append path.
2. A regression test that goes end-to-end across the two halves the suite currently never joins:
   build a pipeline the ordinary way (`addStep` × 3, no `position`), then assert
   `trunkOf(listByPipelineInternal(pid)).lastOption` **is the last-added step** — i.e. that the
   node key run results are written under is the node an Output would be bound to. Mutation-check
   it by reverting the fix.
3. Re-check `PipelineProposalService`'s "LAST trunk step created" comment against the fixed
   behavior so the Output binding and the snapshot key are provably the same id.

**Classification:** I read this as an **ordinary implementation defect, contained** — `design.md`'s
trunk model and `executionOrder`'s own scaladoc both already assert the intended behavior ("every
pipeline has exactly one root child"), so no new product decision is needed and the orchestrator's
close-it-out discretion applies. The one thing that would make it a design question is if
"append with no `position`" is *intended* to create a root branch rather than extend the trunk —
nothing in `design.md` or the spec says so, and Probes A/B show the resulting state is incoherent
with the run/Output binding either way, so I do not think it is.

### Non-blocking notes

- **PATCH `position` on a trunk step that has sibling tails swaps trunk and tail** (Probe C:
  node key `fb67` → `3a95`). This is inherent to — and consistent with — the coordinator's binding
  sibling-scoped ruling (it is the same semantics `reorderInternal` has), so it is a deliberate
  reorder, not a defect. Worth documenting on the wire contract that a `position` PATCH within a
  branching node can change which branch is the trunk, and therefore which node run results land on.
- `deleteInternal` (`:450-460`) promotes `childrenSorted.headOption` — the *lowest-position*
  child — into the deleted step's slot. When a node's only child is a migration-created tail
  (`position >= 1`), deleting the node promotes that tail onto the trunk. Defensible splice
  semantics, but it is the one place still using "lowest position" where `trunkOf`/`tailsOf`
  deliberately use an exact `position == 0` match. Worth an explicit comment either way.
- `DemoData.scala:56` seeds an Output with `nodeStepId = None` while the writer keys on
  `Some(trunk-last)`; demo-only, but the same reader/writer key mismatch shape as Change Request 1.
- The executor's own residual note (`PatchSetPreviewProjection` echoes the raw requested
  `position` rather than the clamped one) is real; I agree it is follow-up-ticket material,
  not blocking.

### Reproduction artifacts

- Probe spec: `/tmp/claude-1000/-home-matt-Development-helio/2179eccd-d39c-47cc-8d27-ea431f13eae6/scratchpad/SkepticProbeSpec.scala`
- Full-suite logs: `…/scratchpad/fulltest6.log` (environmental flake), `…/scratchpad/fulltest6b.log` (3365/3365, exit 0)
