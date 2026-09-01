## Skeptic Report — final gate (round 9; scope: round-8 CR1 closure only)

HEAD `31708535`. Scope per orchestrator: verify commit `40d35292` (the round-8 fix) is correct and
complete, and that `40d35292..HEAD` is documentation/bookkeeping only. Everything else was
CONFIRMed at rounds 6–8 and was not re-reviewed.

### Verdict: REFUTE

One required fix. Doc-only again, same three surfaces. The round-8 fix got its **conclusion**
right and its **stated reason wrong**, and the wrong reason is now baked into a binding schema
`description` and a **merged canonical spec**.

---

### What I verified (with evidence)

**A. `40d35292` is genuinely reword-only.** `git show 40d35292 --stat`: 6 files — one Scala file
(`PipelineService.scala`, +9/-6, entirely inside the `//` comment block at `:603-615`; the three
executable lines `listByPipelineInternal` / `trunkOf(current).lastOption` / `spliceInsertAtInternal`
are untouched), `schemas/pipelines/create-pipeline-step-request.schema.json` (one `description`
string), the change-delta `pipeline-steps-persistence/spec.md`, plus `execution-progress.md`,
`files-modified.md`, and the committed `skeptic-final-1.md`. **No test file touched.** The commit
message's "reword-only" claim holds.

**B. `40d35292..HEAD` is archive/spec-bookkeeping only.**
`git diff --name-only 40d35292..HEAD | grep -E '^(backend|frontend|schemas|e2e)/'` → **no matches**;
every path is under `openspec/` (change-dir → `archive/2026-08-31-outputs-model-migration/` rename,
delta→canonical spec merge, `.openspec.yaml`, tasks/design bookkeeping). No functional regression
possible from those four commits.

**C. Gates re-run fresh by me.**
- `node scripts/check-schema-drift.mjs` → `schemas in sync with JsonProtocols (60 checked across
  46 protocol files)`, `panel-type enums in sync (7 surfaces checked)`.
- `git status --porcelain` → only `?? openspec/changes/outputs-model-migration/` (this round's
  untracked auditor artifact), no modified tracked files.

**D. The round-8 conclusion is correct.** `position = count` and the `position`-absent default are
NOT equivalent on a tail-bearing pipeline. Traced fresh:
`PipelineService.persistNewStep` `case Some(index)` → `anchorParentId = Some(current(index - 1).id)`
where `current = listByPipelineInternal` = `executionOrder(...)`; `case None` →
`trunkOf(current).lastOption`. Since the trunk-last node has no trunk continuation, its tail
expansion ends the execution order, so `current(count - 1)` is a tail, not trunk-last. That part of
the reworded text is right, and the schema/spec/comment now correctly stop asserting unconditional
equivalence. This was the substance of round-8 CR1 and it **is** addressed.

---

### Change Requests

**1. The round-8 fix's justification clause states `executionOrder`'s emission order backwards, in
all three surfaces — and directly contradicts `executionOrder`'s own scaladoc.**

The sentence added in `40d35292` (verbatim, present in all three places):

> `executionOrder` emits a node's tails **after its trunk continuation**

Ground truth — `PipelineStepRepository.scala:583-589`:
```scala
def walk(node: PipelineStep): Vector[PipelineStep] = {
  val children   = childrenOf(steps, Some(node.id))
  val tails      = children.filter(_.position != 0).flatMap(expandBranch)
  val trunkChild = children.find(_.position == 0)
  node +: (tails ++ trunkChild.toVector.flatMap(walk))
}
```
Tails are concatenated **before** the trunk continuation. The function's own scaladoc
(`PipelineStepRepository.scala:566-568`) says exactly that:

> each node's own tail branches … are emitted **immediately after that node and before the trunk
> continues past it**

So the new text asserts the opposite of both the code and the sibling doc-comment. The conclusion
survives only because for the **trunk-last** node there is no continuation left — but the rule as
written is false for every mid-trunk node with a tail, and this sentence's entire job is to explain
how an execution-order index maps to a splice anchor (i.e. exactly the mid-trunk case a reader would
use it for).

Locations (all three still carry it at HEAD):
1. `schemas/pipelines/create-pipeline-step-request.schema.json:5` — inside the `description`,
   `"… — \`executionOrder\` emits a node's tails after its trunk continuation, so on a tail-bearing
   pipeline …"`. **Binding contract surface.**
2. `openspec/specs/pipeline-steps-persistence/spec.md:116-119` (merged canonical spec, the
   `position` present bullet) and `:164-168` (the "Insert at count equals append" scenario body,
   "per `executionOrder`'s trunk-then-tails emission order"). **Binding spec.** Note `:167`'s
   "trunk-then-tails" phrasing is *also* inverted — the actual order is node-then-tails-then-trunk.
3. `backend/src/main/scala/com/helio/services/pipelines/PipelineService.scala:608-610` — `//
   \`executionOrder\` emits a node's tails // AFTER its trunk continuation`.

Required (doc-only, mechanical, no code/test change): replace the inverted clause with the actual
rule, which is already stated correctly at `PipelineStepRepository.scala:566-568` — a node's tail
branches are emitted immediately after the node and **before** the trunk continues past it;
consequently the trunk-last node's tails end the whole execution order, which is why
`current(count - 1)` is a tail rather than trunk-last whenever the trunk-last step bears tails.
Keep the (correct) conclusion sentences as-is.

---

### Non-blocking notes

1. `openspec/specs/pipeline-steps-persistence/spec.md:116-119` says `position = count` anchors on
   "that trunk-last step's **last tail**". Strictly it anchors on the last element of the trunk-last
   node's depth-first tail expansion (a tail branch's deepest leaf), and — in the defensive
   root-level-tail case `executionOrder:592-595` handles — on a root tail. Real migrated data has
   neither shape, so this is imprecision, not falsehood. Worth tightening in the same pass.
2. `node scripts/check-openspec-hygiene.mjs` currently fails with `change "outputs-model-migration"
   has no tasks` because of the untracked `openspec/changes/outputs-model-migration/` directory left
   behind by this round's auditor artifact. Untracked, not a committed regression, but it will fail
   the pre-commit hygiene hook in this worktree until removed.
3. Round-8's own report contains the same inverted phrasing ("a node's tails are emitted after that
   node's trunk continuation"); its worked example (`A → B`, tail on `B`) was trunk-last, so the
   error was invisible there and the executor copied it verbatim. Worth mentioning in the fix
   commit so the provenance is clear.
