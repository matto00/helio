## Skeptic Report — final gate, dimension `migration-correctness` (round 5, HEAD `d12b19b2`)

### Verdict: REFUTE

The round-4 defect **is** genuinely fixed for the pure-trunk case, and `spliceInsertAtInternal`'s
re-parenting logic is correct as written. But exercising it against the **real scrubbed fixture**
(not the tests' hand-built pure chains) reproduces the *same bug class a third time*, on 3 of the
6 largest real migrated pipelines — and the sweep in item 7 turned up a second, worse instance
through a public `PATCH` endpoint that silently re-roots a migrated pipeline's trunk and changes
which node run results are written under.

**Finding 2 is escalation-class, not orchestrator-discretion-class**: it is a live
execution/data-binding semantics change through an already-shipped public endpoint, and it rests
on an unanswered design question (what `position` means on the wire now that it is sibling-scoped).
Per the coordinator's own instruction, the orchestrator's close-it-out discretion must NOT be
applied to it.

---

### What I verified (with evidence)

**0. Ground truth.** `git log`/`git show HEAD` read directly; full text of
`spliceInsertAtInternal`, `insertAtInternal`, `siblingsQuery`, `trunkOf`, `tailsOf`,
`executionOrder`, `updateInternal`, and both changed `PipelineService` call sites read from
the files, not from the executor's narrative. Working tree clean apart from sibling skeptics'
round-5 reports.

**1. `spliceInsertAtInternal`'s implementation — CORRECT as written.**
(`PipelineStepRepository.scala:263-311`.) Reads the anchor's `position == 0` occupant *before*
inserting, inserts the new row (`position = 0`, `parent = anchor`), then re-parents the occupant
onto the new row at `position = 0`. Ordering avoids the `parent_step_id` FK violation, all in one
`transactionally` block. The occupant is neither dropped nor duplicated. The anchor's `position != 0`
children (tails) are left untouched, and no other sibling group's positions are renumbered — so it
does not corrupt sibling positions elsewhere. It returns a fresh `SELECT` of the persisted row, so
the round-4 "response echoes the requested index" lie is genuinely closed. **CONFIRMED.**

**2 + 3. Exercised against the REAL fixture on a fresh embedded Postgres — REPRODUCED DEFECT.**
Probe: `EmbeddedPostgres` + real `db/migration` through V93, real `db/fixtures/hel904-real-dump.sql`
loaded verbatim, then V94 run for real. For each of the 6 largest real migrated pipelines I called
`spliceInsertAtInternal(pipelineId, …, Some(anchor.id))` — byte-for-byte what `duplicateStep` issues —
once per step, reading the resulting rows back **directly out of `pipeline_steps` by SQL** and
re-deriving `executionOrder` / `trunkOf` / `tailsOf`, then restoring.

Pure-trunk pipelines are all correct (49/49 insert positions right, response `position` == the
independently re-read persisted `position` every time). But **every pipeline that V94 gave an
aggregate tail misplaces the insert when the anchor is the tail's parent**:

```
=== 555f4bae-7c76-4566-84eb-036bc33b4485 ===  (cast→datebucket→sort→limit, tail: aggregate)
  dupAfter idx=3 anchor=41a4e665(limit) -> newExecIdx=5 expected=4 *** MISPLACED ***
     before: b6ac6ac5 -> b98b92f0 -> 18edc657 -> 41a4e665 -> hel904-t
     after:  b6ac6ac5 -> b98b92f0 -> 18edc657 -> 41a4e665 -> hel904-t -> 31a273e0

=== 81da0ebe-4270-4a67-b257-b1758e613f72 ===  (select→rename, tail: aggregate)
  dupAfter idx=1 anchor=14df5f95(rename) -> newExecIdx=3 expected=2 *** MISPLACED ***

=== d0d104d5-8d85-4c92-97c5-893e1c31d0b1 ===  (aggregate→sort, tail: aggregate)
  dupAfter idx=1 anchor=70b95e31(sort) -> newExecIdx=3 expected=2 *** MISPLACED ***
```

Root cause, read from the code: `executionOrder` (`PipelineStepRepository.scala:509-514`) emits
`node +: (tails ++ trunkChild.walk)` — a node's tails come **before** its trunk continuation.
`spliceInsertAtInternal` makes the new step the anchor's *trunk continuation*, so it necessarily
lands **after the anchor's entire tail subtree**, not directly after the anchor.

Consequences, all user-visible and all the same class round 3 and round 4 found:
- `POST /pipeline-steps/:id/duplicate` still violates its own documented contract
  ("inserts the clone directly after the original", `PipelineService.scala:833`) for exactly the
  migrated pipelines that carry a V94-created aggregate tail.
- `POST /pipelines/:id/steps` with `position = k` where `k-1` is a tail-bearing step still does not
  honour the requested slot (the probe's `dupAfter idx=3` *is* `persistNewStep(index = 4)`).
- Because `executionOrder` is what the pre-HEL-905 linear engine folds over, the clone now runs
  **after** the aggregate rather than before it — a live execution-semantics difference vs. `main`.
- The slot "between the trunk's last step and its tail" is **not expressible at all** by the new
  primitive: no `parentStepId` argument produces it. That is a design gap, not just a call-site bug.

Why the green suite misses it: both new `PipelineStepRoutesSpec` tests seed **pure `parent_step_id`
chains with no tails** (`a→b→c`, `a→b→c→d`), which is precisely the shape that cannot exhibit this.

**4. `trunkOf`/`tailsOf`/`listByPipelineInternal` after a splice-insert — CORRECT.** Re-derived all
three from the DB after every one of the 49 splice-inserts above. The trunk always extended by
exactly one node in the right place, `tailsOf` never gained or lost a branch, and the round-3
"whole-pipeline position sort" bug did **not** reappear in any form. **CONFIRMED.**

**5. Mutation proof.** Not needed as a separate step — items 2/3 above are a *stronger* proof:
the current code was run against real migrated data and produced a stably wrong result, reproduced
on three independent real pipelines and re-derived from raw SQL, not from a test assertion.

**6. Full suite, fresh, single-threaded.** `sbt -batch test` from a clean `Test/compile`:
`Tests: succeeded 3354, failed 0, canceled 0`, `All tests passed`, `[success] Total time: 191 s`,
exit 0. **Green — while both findings below are live.**

**7. Fresh whole-pipeline-vs-sibling-scoping sweep — found Finding 2.**
`grep -rn "insertAtInternal\|executionOrder\|listByPipelineInternal\|\.position" backend/src/main/scala`.
`insertAtInternal` now has no live whole-pipeline-index caller (both moved to
`spliceInsertAtInternal`); `OutputRepository`'s `position` is a different table; `PipelineRunService`
/ `RefinementPrompt` / `PipelineService.listSteps` all correctly consume `executionOrder` order.
The one remaining unscoped **writer** is `PipelineStepRepository.updateInternal`
(`:200-226`) — see Finding 2.

---

### Change Requests

**1. [ordinary defect, contained] `spliceInsertAtInternal` places the new step after the anchor's
tail branches, not directly after the anchor — reproduced on 3 real migrated pipelines.**

Evidence above. Required:
- Make "insert directly after node X in execution order" actually mean that. Because
  `executionOrder` emits `node, tails…, trunkChild`, an insert that must appear at index
  `idx(X)+1` when X has tails cannot be a child of X at all — it has to be resolved against the
  *executionOrder predecessor of the target slot*, i.e. re-anchor onto the last node of X's last
  tail branch, or (better) make the primitive take a whole-pipeline target index and resolve the
  anchor internally so exactly one place owns the index-space translation.
- Add a regression test that seeds a **tail-bearing** migrated shape (trunk `a→b`, plus a
  `position = 1` child of `b`, i.e. what V94 actually produces) and asserts through the real
  route that duplicating `b` yields `a, b, NEW, tail` — the current tests' pure chains provably
  cannot catch this.
- Decide and document what `POST /pipelines/:id/steps` with `position = k` means when `k` names a
  slot inside or immediately before a tail branch, since it is currently unrepresentable.

**2. [ESCALATION-CLASS — do NOT close this out with orchestrator discretion] `PATCH
/api/pipeline-steps/:id {"position": N}` now silently re-roots a migrated pipeline's trunk and
changes which node its run results are written under.**

`UpdatePipelineStepRequest.position` (`PipelineStepProtocol.scala:156`) is a live public field.
`PipelineService.updateStep` (`:665`, `:732`) passes it straight to
`PipelineStepRepository.updateInternal`, which writes the raw `position` column with **no
sibling-scoping, no re-parenting, and no validation**. Since HEL-904, every trunk step's `position`
is pinned to `0` and `trunkOf` requires an exact `position == 0` match — so any non-zero `position`
PATCH on a mid-trunk step severs the trunk there.

Reproduced against the real fixture (pipeline `6ba5075b-…`, a real 20-step migrated trunk), single
call, `position = 2` on the 3rd step:

```
PRE   trunkOf: 20 steps (rename → … → chunkbytokencount)
PRE   tailsOf: (none)
POST  trunkOf: 2 steps  (rename → cast)
POST  tailsOf: d85886ee,3fac4330,…,76af9c56   (18 steps reclassified as ONE tail branch)
```

This is not cosmetic. `PipelineRunService.scala:636` uses `trunkOf(steps).lastOption` as the node
key that `node_snapshots.overwriteRows` and `binaryRefRepo.overwriteForNode` write under. Before the
PATCH that key is `76af9c56` (`chunkbytokencount`); after it is `f05d9783` (`cast`). Every Output /
panel bound to the pipeline's terminal node therefore starts reading a *different* node's rows —
silent data corruption from one ordinary field update, with a `200` response and no error anywhere.

On `main` this endpoint was coherent (`position` was a whole-pipeline index). This change makes it
incoherent without changing or guarding it. Round 4 noted the *read* side of this
(`PatchSetApplyRollback:177-180`, `PatchSetUndoService:244` comparisons going vacuous) as
non-blocking; the **write** side — `PatchSetApplyRollback.scala:180` and `:285` actively call
`updateStep(position = Some(prior.position))` with a journaled absolute position — is the same
corruption path reached programmatically, not just a weakened assertion.

Why this needs a human, not the orchestrator's judgment:
- It is a **design question with conflicting premises**: is `position` on the wire still a
  whole-pipeline index (as `POST …/steps` still validates it, `PipelineService.scala:605-609`) or a
  sibling-scoped tiebreaker (as every response now reports, per the round-3 binding ruling)? The
  same field name currently means both, on the same resource, in the same API. `PATCH position`
  cannot be specified until that is settled.
- The plausible fixes are not equivalent and are not the skeptic's call: reject `position` on
  `PATCH` outright (a breaking wire change), reinterpret it as a splice/re-parent (new behavior),
  or scope it to siblings (silently different meaning for existing clients).
- It is a **live execution-semantics / data-binding behavior change**, exactly the class the
  coordinator carved out of the orchestrator's discretion.

This also compounds round 4's still-open Finding 2 (`PUT /steps/order` is inert on every migrated
pipeline). Taken together, all three of the API's step-ordering affordances — reorder, add-at-position,
duplicate-after — are now either inert, unrepresentable, or corrupting on real migrated data. That
combination is a product decision, not an implementation detail.

### Non-blocking notes

- `PipelineStepRepository.insert` (`:68`, owner-scoped) is still whole-pipeline `max(position)` and
  never sets `parentStepId`. Confirmed again to have zero live callers — latent, but it is a loaded
  gun pointed at the same invariant. Delete it or scope it.
- `insertAtInternal` now has no live caller either (only `PipelineStepRepositorySpliceSpec`).
  Worth folding into `spliceInsertAtInternal` so there is exactly one insert primitive and one
  index space.

### Reproduction artifacts

Probe sources (outside the repo — no worktree file modified other than this report):
`/tmp/claude-1000/-home-matt-Development-helio/2179eccd-d39c-47cc-8d27-ea431f13eae6/scratchpad/probe/{Probe.scala,Probe2.scala}`,
compiled with `scalac` against `Test/fullClasspath` and run against embedded Postgres with the real
`db/migration` set and the real `hel904-real-dump.sql` fixture.
Full-suite log: `…/scratchpad/fulltest.log`.
