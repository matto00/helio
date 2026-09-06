## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Cold review. Every conclusion below is derived from the diff, the code, a test run I
executed, or the live app — not from `evaluation-*.md` or `files-modified.md`, which I
read only as claims.

### What I verified (with evidence)

**Diff scope.** `git diff main...HEAD --stat`: 2 commits (85c53504, 1f4a50d0), 5 backend
files, 3 frontend files, 1 schema, plus change artifacts. **No migration added or edited** —
`git diff main...HEAD -- backend/src/main/resources/db/migration/` is empty; V98–V100 are
untouched. The shared dev DB is safe.

**1. Root-membership invariance — is it really by construction?** I read
`PipelineStepRepository.reorderTrunkInternal` in full and tried to construct a crossing input.
I could not, and I believe none exists:
- `labelOfStep` is built from `rootIds.flatMap { rid => trunkOfRoot(steps, rootIdOfStep, rid).map(_ -> rid) }`.
  `childrenOfRoot` seeds each walk only from steps that are `parentStepId.isEmpty &&
  rootIdOfStep(id) == rid`, and `rootIdOfStep` is keyed on the row's own `root_id`. Two
  distinct roots therefore seed two distinct heads, and each walk descends via
  `childrenOf(position == 0)` — a step has exactly one parent, so two roots' walks can never
  reach the same step. `unionWithLabels.toMap` has no conflicting keys and `currentTrunk` has
  no duplicates. Even on malformed data (two parentless steps sharing one `root_id`),
  `.find(_.position == 0)` picks exactly one seed per root, so the property still holds.
- The update loop then computes each step's new parent as `ids(idx - 1)` **within its own
  partition**, and the new `root_id` as that partition's own `rootId`. There is no expression
  anywhere in the method that can hand a step a root other than the one its own walk produced.
- The `firstRootIdAction` read is deleted, not guarded: `grep -rn firstRootIdAction backend/src`
  returns hits only at the private `def` (L44) and at `insertInternal`/`insertAtInternal`/
  `updateInternal` (L100, L283, L396, L469) plus `OutputRepository` — all outside
  `reorderTrunkInternal` (L641–L690) and all legitimately out of scope per the brief. AC3 met by
  absence.
- Two edge cases I checked and cleared: a root whose trunk is empty contributes no partition and
  is simply not touched (no head is stolen); `partitions` iteration order is HashMap-nondeterministic
  but the partitions are disjoint step sets, so ordering is immaterial. There is no unique index on
  `(parent_step_id, position)` (only `idx_pipeline_steps_parent_step_id`, V94 L180), so the
  transient mid-transaction state where several trunk steps briefly share position 0 cannot abort.

**2. Does the AC2 test actually test that, and are both axes independently fireable?**
`owningRootMap` walks `parentStepId` to the parentless ancestor and reads that ancestor's
`root_id` via **raw SQL** (`rawRootIdColumn`) — it calls neither `trunkOfRoot` nor `rootIdsOf`.
It is genuinely independent of the implementation. I did not take the "independently fireable"
claim on report; I **reproduced it by mutation**: I replaced
`orderedTrunkIds.toVector.groupBy(labelOfStep).toVector` with a single flat partition
(`Vector((labelOfStep(orderedTrunkIds.head), orderedTrunkIds.toVector))`) — i.e. HEL-913's
original cross-root corruption restored — and re-ran the suite. AC2 failed at
`PipelineStepRepositorySpliceSpec.scala:721`, which is the `ownershipAfter shouldBe
ownershipBefore` line, i.e. **axis (a) fired on its own, before `headsAfter` was computed**, with a
diff showing two steps reassigned from root `05bc61d2…` to root `84c6e532…`. AC1 also fired.
I restored the file (`git status` clean afterwards) and re-ran green.
On axis (b): I judged it not independently falsifiable by mutation, because any mutation that
produces zero or two heads for a root violates V98's own `CHECK` and aborts at the DB rather than
at the assertion. That is a property of the invariant, not a weakness in the test — and the test's
`headsBefore(root1) shouldBe a.id` / `headsAfter(root1) shouldBe b.id` sanity pair is a real,
fireable assertion proving the check is not vacuous. I accept axis (b) as written.

**3. Gates re-run by me, not read from a report.**
- `sbt testOnly …PipelineStepRepositorySpliceSpec` → 28/28 pass (includes the 4 new HEL-973 cases).
- `sbt testOnly …PipelineStepRoutesSpec` → 88/88 pass. The old "returns 400 once the pipeline has
  more than one root" case is genuinely restated as an end-to-end multi-root success, asserting
  `rootId` per root on both the PUT response and a follow-up GET.
- `npm run typecheck`, `npm run lint` (`--max-warnings=0`) → clean.
- `npm test` (full suite) → 256 suites / 2656 tests pass.
- `npm run check:schemas` → green (74 schemas across 48 protocol files; AC4 met).

**4. Live UI — the actual deliverable.** `start-servers.sh` READY on 6405/9312. I killed and
restarted the backend first so it was running the restored (unmutated) source. The evaluator's
fixture belongs to a different account, so I built my own: pipeline
`6fdbcfa0-e76d-4512-9a1a-145c80b22c39` ("SKEPTIC973 multiroot"), two roots
(`1b6c336b…`, `4ed21aba…`), each with a `limit → rename` trunk, owned by matt@helio.dev.
Pre-state read from Postgres. In the browser I clicked **"Move step up" on root 1's second step,
i.e. the lane-head move** — the exact case cycle 1's 422/CR1 was about. Result:
`PUT /api/pipelines/…/steps/order → 200` (a 200 alone proves the payload carried the full union;
a root-0-only payload would have 422'd), and the DB after:

```
947bef49 rename 0 (parent NULL) root_id=1b6c336b…   <- head marker moved onto the new head
42d93bfe limit  0 parent=947bef49  root_id=NULL
7333e9b8 limit  0 (parent NULL) root_id=4ed21aba…   <- root 2 completely untouched
3d1e4b67 rename 0 parent=7333e9b8  root_id=NULL
```

Membership preserved across both roots; root 2 byte-identical. On `main` this exact click 400s.
Screenshots before/after confirm the UI re-renders the swap in root 1's lane with root 2's lane
unchanged; I also toggled to light theme and saw correct parity (no CSS was touched by this diff,
so this is a no-regression check rather than a new-surface judgement). Only console error on the
page is a pre-existing `404 /schedule` for a pipeline with no schedule.

**5. Disclosed weak spots — my own judgement.** Both are non-blocking; see notes below.

**6. Things the checklist wouldn't catch.**
- **CONTRIBUTING.md no-inline-FQNs**: `git diff main...HEAD -- '*.scala' | grep '^+' | grep 'com\.helio\.'` → zero hits. Clean.
- **Schema description accuracy**: I checked each clause of the new
  `reorder-pipeline-steps-request.schema.json` description against the implementation —
  "permutation of the UNION of every root's current trunk", "partitioned by each step's CURRENT
  owning root", "first step of each root's subsequence becomes parentless and carries that root's
  own id", "later members … predecessor within the SAME root's subsequence with a null root id",
  "position written as 0", "a rejected request leaves every position, parentStepId and root id
  unchanged" (the fourth new test asserts exactly this). Every clause is true of the code. The
  Scaladoc on `ReorderPipelineStepsRequest` and `reorderTrunkInternal` matches too.
- **DESIGN.md**: no frontend surface change (only `usePipelineDetailPage.ts` payload derivation and
  `stepTree.ts` relinking), so no token/component/spacing judgement applies.

### Verdict: CONFIRM

The load-bearing property holds by construction, the test that guards it is genuinely independent
and mutation-proven, the fence is gone rather than bypassed, and the previously-unreachable live
path works correctly including the lane-head case that broke in cycle 1.

### Non-blocking notes

- **Non-first roots have no reorder affordance at all.** `LaneColumn.tsx` passes
  `onMoveUp={NOOP_MOVE}` / `onMoveDown={NOOP_MOVE}` (`const NOOP_MOVE = undefined`, L24) for every
  lane it renders, and `PipelineRiverView.tsx:397` wires the real handlers only for the root-0
  primary lane. I confirmed this live: all four move buttons on root 2's steps are `disabled`.
  This predates HEL-973 (it is HEL-968's lane rendering) and the ticket explicitly scopes frontend
  work to "only if the chosen semantics require a change" — the whole-pipeline payload change was
  required and was made. But it does mean a whole-pipeline reorder is only *initiable* from root 0
  today, and it is the reason the CR2 refusal guard has no live trigger. Worth a spinoff ticket
  ("wire move-up/move-down and drag for every root's lane, not just root 0"); not a blocker for
  this ticket, whose deliverable — the route no longer failing closed — is demonstrably live.
- **CR2 refusal guard untested / raw UUID in its toast**
  (`usePipelineDetailPage.ts`, `root ${r.id} lost its trunk lane during the reorder`). I agree with
  the executor's honest framing: it is defence-in-depth on a path I also could not reach. Given the
  note above, it is currently unreachable by construction, so I would not block on the missing test.
  The raw UUID is user-hostile, though; `roots` carries `dataSourceName`, so a future touch could
  say `root "Shipments"` for ~free.
- `openspec/changes/multi-root-reorder-semantics/evaluation-2.md` is untracked in the worktree —
  presumably still to be committed with the delivery artifacts.
