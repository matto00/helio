## Skeptic Report — final gate, dimension `migration-correctness` (round 4, HEAD `139bea00`)

### Verdict: REFUTE

One reproduced, empirically-demonstrated defect (Finding 1) plus one unacknowledged
product consequence of the binding ruling that needs a human call (Finding 2). The
round-3 bug itself **is** genuinely fixed — findings below are a different, adjacent
index-space defect that the round-3 rewire's own sibling-scoping introduced/exposed and
that no test in the suite covers.

---

### What I verified (with evidence)

**Ground truth re-established.** `git log`/`git show --stat HEAD` (`139bea00`), the full
diff of `PipelineStepRepository.scala`, `PipelineService.scala`,
`PipelineRunService.scala`, `RefinementPrompt.scala`, `V94__outputs_model.sql`, and
design.md's two binding rulings (lines 440–560) read directly — not from the executor's
narrative.

**1. `executionOrder` (claim: correct for arbitrary tree shapes).** Read the
implementation (`PipelineStepRepository.scala:459-475`). Logic is sound for the shapes
reachable in this codebase: trunk = position-0 child chain from the virtual root; each
node's `position != 0` children expanded depth-first immediately after it; root-level
tails appended last. `childrenOf` sorts siblings by position, so tail order is
deterministic. Verified there is no reachable way to produce two position-0 siblings
(`reorderInternal` renumbers `0..k-1` per group; `insertAtInternal` renumbers `0..n`
per group; `deleteInternal` splices into the vacated slot), so the `find(_.position == 0)`
cannot silently drop a subtree. **CONFIRMED.**

**2. `reorderInternal` (claim: sibling-scoped, invariant survives a real reorder).**
Exercised the **real repository method against a real Postgres** (embedded PG + real
Flyway `db/migration` through V94), seeding a migrated-shape pipeline by raw SQL
(4-step `parent_step_id` chain, every `position = 0`, one root child) and calling
`reorderInternal` with the ids fully reversed:

```
PRE  executionOrder = 0,1,2,3      positions = 0,0,0,0   rootChildren = 1
REORDER requested   = 3,2,1,0
REORDER result      = 0,1,2,3      positions = 0,0,0,0
REORDER trunkOf     = 0,1,2,3
```

The position-0 trunk-continuation invariant survives a real reorder call intact, and
`trunkOf` still walks the full trunk. **The invariant claim CONFIRMED** (see Finding 2
for the consequence).

**3. The three additional latent copies + fresh 4th-site sweep.** Read all three fixes in
place: `PipelineRunService.scala:266`, `PipelineService.scala:854`,
`RefinementPrompt.scala:87` — each now consumes `listByPipelineInternal`'s order with the
`.sortBy(_.position)` removed. My own fresh sweep:

```
grep -rn "sortBy(_.position)\|sortBy(.*position)\|sortWith.*position\|orderBy(.*position" backend/src/main/scala
```

Remaining hits are all legitimately **sibling-scoped or a different table**:
`OutputRepository:68,75` (outputs, not steps), `PipelineStepRepository:253`
(`siblingsQuery`), `:331` (children of the deleted row), `:412` (`childrenOf`), plus
three comment lines. **No fourth whole-pipeline site. CONFIRMED.**

**4. Mutation proof (spot-check, honoring read-only by immediate restore).** Reverted
`listByPipelineInternal` to `.sortBy(_.position).result` → `PipelineRunServiceSpec`
"resolves the target step's index from executionOrder…" went **red** (1 failed / 71),
restored → green. Note for the record: `V94OutputsMigrationSpec` did **not** go red under
this particular mutation; the run-service test is the load-bearing guard for it.
Working tree restored clean (`git status` shows only sibling skeptics' round-4 reports).

**5. Real fixture, real DB, all 15 pipelines.**
`sbt "testOnly …V94OutputsMigrationSpec …PipelineStepRepositoryTreeOrderingSpec"` → 39/39
green, including "should yield the pre-migration linear order for the pipeline's ORIGINAL
steps, for every one of the 15 real multi-step pipelines", "should place every real
migration-created aggregate tail immediately after its parent step's index, never before
it or as a trunk member", and "should walk the FULL, ORIGINAL-ORDER trunk … for every one
of the 15". **CONFIRMED, no regression from the prior cycle.**

**6. HEL-905 boundary.** `PipelineRunServiceSpec.scala:909` exists and is real (seeds a
trunk-plus-tail tree with deliberately-scrambled insertion order and asserts the previewed
prefix's row count composes the tail's limit step). It is the guard that went red under
my mutation, so it is genuinely load-bearing. Nothing in this rewire re-implements a tree
walk; `executionOrder` orders the flat list the pre-905 engine folds over. **Boundary
claim CONFIRMED.**

**7. Full suite, fresh.** `sbt -batch test` → `Tests: succeeded 3352, failed 0`,
`All tests passed`, exit 0. **No `SparkJobSubmitterSpec` failure recurred**, so I have
nothing to spot-check on that classification.

---

### Change Requests

**1. `insertAtInternal`'s index space no longer matches its callers' — `duplicateStep`
and `addStep(position=…)` place the new step at the END of every migrated pipeline, and
the API response reports a position the row does not have.**

`PipelineService.duplicateStep` (`PipelineService.scala:861`) and `persistNewStep`
(`:610`) both compute an index against the **whole-pipeline** list
(`listByPipelineInternal` / `executionOrder`) and pass it to
`insertAtInternal(..., index, parentStepId = None)`. Since HEL-904, `insertAtInternal`
splices within the **root sibling group only** (`siblingsQuery(pipelineId, None)`,
`:253`). `V94__outputs_model.sql:49-53` backfills a single parent chain, so every
migrated pipeline has **exactly one root child** — the root sibling group has size 1
while the caller's index ranges over 0..N. `Vector.patch` clamps, so the step is appended
instead of spliced.

Reproduced twice, against a real Postgres with the real V94 schema, on a migrated-shape
4-step chain, calling `insertAtInternal(index = 2)` — exactly what `duplicateStep` of the
3rd step issues:

```
PRE  executionOrder = 0,1,2,3   positions = 0,0,0,0   rootChildren = 1
RETURNED position (what the API responds with) = 2
POST executionOrder = 0,1,2,3,NEW
POST index of NEW   = 4  (requested 2)
POST persisted position of NEW = 1
POST trunkOf        = 0,1,2,3      <- NEW is not on the trunk
```

Three distinct wrongs, all user-visible:
- `POST /pipeline-steps/:id/duplicate` no longer "clones the step directly after the
  original" (its own documented contract, `PipelineService.scala:822`) — the clone lands
  at the end of the pipeline.
- `POST /pipelines/:id/steps` with an explicit `position` validates `0 <= index <= count`
  against the whole-pipeline count (`:605`) and then silently clamps into a 1-element
  space; the requested insertion point is ignored.
- `insertAtInternal` returns `rowToDomain(newRow.copy(position = index))` (`:270`) — the
  **requested** index — while the row persisted with `position = 1`. The 201 response
  body states a position the database does not contain.

This is a regression introduced by this change: on `main`,
`insertAtInternal` sorted/renumbered the **whole pipeline**
(`git show main:…/PipelineStepRepository.scala:214-229`), so caller index == sibling
index and all three behaviors were correct.

Why the green suite missed it: the only coverage is
`PipelineStepRoutesSpec.scala:934` (a pipeline built entirely through the API, where every
step is a flat root sibling, so sibling group == whole pipeline) and
`PipelineStepRepositorySpliceSpec.scala:83` (calls `insertAtInternal` with an **explicit**
`parentStepId`, i.e. not the live caller shape). Neither exercises the
migrated/parent-chained shape through the live caller path.

Required: make the caller's index space and `insertAtInternal`'s agree — either resolve
the target's real `parentStepId` and a sibling-relative index in
`duplicateStep`/`persistNewStep` before calling, or have `insertAtInternal` accept a
whole-pipeline `executionOrder` index and derive the parent/sibling slot itself. Add a
guard that seeds a parent-chained (migrated-shape) pipeline and asserts, through the real
route, that a duplicate lands immediately after its original and that the response's
`position` equals the persisted `position`.

**2. `PUT /api/pipelines/:id/steps/order` is now a silent no-op for every migrated
pipeline — please confirm this is the intended accepted consequence, and document it.**

Empirically demonstrated above (item 2): a fully-reversed reorder of a migrated 4-step
chain returns `200` with the order completely unchanged. This follows directly and
correctly from the human's binding ruling (each trunk step is the sole member of its own
sibling group, so sibling-scoped renumbering has nothing to permute) — I am not proposing
to overturn the ruling. But design.md's follow-on section describes `reorderInternal` as
continuing to serve reorder, and nowhere records that user-facing step reordering becomes
inert for all 15 real pipelines until re-parenting exists (HEL-905 territory). This
needs an explicit human decision — accept and document the dead feature, or scope the
re-parenting reorder — rather than an implementation guess.

### Non-blocking notes

- `PatchSetApplyRollback.scala:177,180`, `PatchSetUndoService.scala:244`, and
  `PatchSetUndoConflictCheck.scala:181` compare a recreated step's `position` against a
  journaled one to detect drift. With every trunk step's `position` pinned to `0`, those
  comparisons are now near-vacuously true for migrated pipelines. Not a defect this
  ticket introduces a wrong behavior with, but the checks have lost most of their
  discriminating power and are worth revisiting alongside Finding 1's fix.
- `PipelineStepRepository.insert` (the owner-scoped, non-internal variant, `:68`) was not
  sibling-scoped along with `insertInternal` — it still takes `max(position)` across the
  whole pipeline and never sets `parentStepId`. It appears to have no live caller
  (`grep` for `stepRepo.insert(` in `backend/src/main` returns nothing), so this is
  latent, not live; consider deleting it or scoping it for consistency.

### Reproduction artifacts

Probe sources (outside the repo, no worktree files modified):
`/tmp/claude-1000/-home-matt-Development-helio/2179eccd-d39c-47cc-8d27-ea431f13eae6/scratchpad/{probe.scala,probe2.scala,Probe.scala,Probe2.scala}`,
compiled against `Test/fullClasspath` and run against embedded Postgres with the real
`db/migration` set. Full-suite log: `…/scratchpad/fulltest.log`.
