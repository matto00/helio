## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

**Ground-truth checks — every factual claim in the artifacts is TRUE.** Note the artifacts elide
the real package path; the file is `backend/src/main/scala/com/helio/infrastructure/persistence/pipelines/PipelineStepRepository.scala`.

- `reorderTrunkInternal` (line 635): `currentTrunk = trunkOf(steps).map(_.id)` (:641) — confirmed
  root-unaware; `trunkOf` (:837) walks `childrenOf(steps, None).find(_.position == 0)`, i.e. across
  all roots.
- `rootId <- firstRootIdAction(pipelineId.value)` (:650) and
  `val newRootId = if (idx == 0) Some(rootId) else None` (:653) — confirmed verbatim.
- `firstRootIdAction` (:44) has other live call sites in this file (:100, :283, :396, :469) and a
  namesake in `OutputRepository` (:88) — Decision 3's "remove from this path only" is correct.
- `trunkOfRoot` (:951), `childrenOfRoot` (:946), `rootIdsOf` (:859) exist with the shapes the design
  assumes.
- HEL-913 fence: `PipelineService.reorderSteps` :2115-2129, `roots.size > 1` → `ServiceError.BadRequest`,
  fed by `listRootDataSourceIdsInternal` — confirmed, and it is that call's only use in the method.
- V98 CHECK (`V98__pipeline_roots.sql:126-127`):
  `CHECK ((parent_step_id IS NULL) = (root_id IS NOT NULL))` — row-level, so Decision 5's
  "satisfied, not modified; no intermediate violation" is correct.
- `schemas/pipelines/reorder-pipeline-steps-request.schema.json` description is singular-root
  ("the position-0 chain from the root", "stepIds[0]'s parent becomes the pipeline root") — the
  artifacts' characterisation is accurate. No OpenAPI file mentions `steps/order`; the only other
  hit is `openspec/specs/pipeline-step-reorder/spec.md`, and the delta's two `### Requirement:`
  headers match that file's headers at :8 and :62 exactly.
- `usePipelineDetailPage.handleReorderSteps` (:990-1011) confirmed root-0-only
  (`roots[0]?.id`, `.find(l => l.parentStepId === undefined && l.rootId === firstRootId)`), with the
  stale "HEL-968: reorder is still root-0-only ... HEL-973" comment at :999-1001.
- Existing multi-root-400 test confirmed at `PipelineStepRoutesSpec.scala:1040-1042` (task 3.2's target).

**Semantics ruling.** Not re-litigated. I attacked Decision 2 on the merits, as instructed, and
found **no invariant contradiction that would reopen the ruling** — the partition-and-relink-per-root
algorithm does deliver root-membership invariance by construction (each step's destination chain is
derived from its own current root; nothing "resolves the root"), and it satisfies V98 per-row. No
ESCALATION is warranted.

**AC1 restatement.** Decision 6 quotes the original verbatim, states it was written for the rejected
option 1, gives the reason it cannot be satisfied literally, and states the restatement. It is
disclosed, not silently swapped or dropped, and the restatement preserves the protective intent
(the other root's chain must not be disturbed). This obligation is met.

**Where the design fails** is not the ruling — it is that the load-bearing criterion is stated in
terms of the `root_id` *column*, which the algorithm provably changes on every reorder that moves a
root's head. Details below.

### Verdict: REFUTE

### Change Requests

1. **AC2 / spec delta are self-contradictory: `root_id`-column equality is FALSE by construction
   under the ruled algorithm.** `root_id` is a *head marker*, not a membership label — V98 forces
   `(parent_step_id IS NULL) = (root_id IS NOT NULL)`, so exactly the parentless head of each root
   carries a non-null `root_id` and every other trunk step carries `NULL`. Take the design's own
   AC1 scenario (R1: A→B, R2: X→Y, `stepIds: [B, X, A, Y]`): before, `A.root_id = R1`, `B.root_id = NULL`;
   after, `B.root_id = R1`, `A.root_id = NULL`. The step-id→`root_id` map is therefore **not** equal
   before and after.
   This makes three artifacts mutually contradictory:
   - `specs/pipeline-step-reorder/spec.md`, bullet *"Preserve every step's root membership … its
     `root_id` after the call SHALL equal its `root_id` before the call"* is directly contradicted by
     the very next bullet (*"the first step's … `root_id` becomes that root's own id, and each
     subsequent step's … `NULL`"*).
   - `tasks.md` 4.2 ("assert the **full before/after `root_id` map** … equality of the whole map")
     instructs the executor to write a test that **must fail** on the AC1 fixture. The executor's
     only exits are to weaken it silently or to build the wrong thing — precisely the failure mode
     AC2 exists to prevent.
   - `tasks.md` 4.3's mutation then **cannot isolate**: if 4.2 is red on unmutated correct code, a
     red result under the mutation proves nothing. As written, 4.3 is not a mutation capable of
     going red *from green*.
   Required: define **root membership** explicitly, in `design.md` (a new decision, or an addition
   to Decision 2) and in the spec delta, as *the root whose trunk chain the step is reachable on*
   (i.e. the `r` for which the step appears in `trunkOfRoot(steps, rootIdOfStep, r)`), and state
   plainly that this is **not** the `root_id` column, whose head-marker value legitimately moves
   within a root. Restate the spec bullet, AC2 in `ticket.md`, the *"No step changes root as a side
   effect"* scenario, and task 4.2 in those terms — the derived id→owning-root map is invariant; the
   raw column map is not. Disclose this restatement on the record exactly as Decision 6 discloses
   AC1's, since AC2 is the load-bearing criterion.

2. **Task 2.2's partition key is under-specified in a way whose obvious reading is broken.**
   Decision 2 step 1 says to read "the `stepId -> rootId` map (`rootIdsOf`)" and step 3 says to
   partition by "each step's *current* root membership". But `rootIdsOf` (`PipelineStepRepository.scala:859`)
   filters `s.rootId.isDefined` — it contains **only parentless head steps**. Every non-head trunk
   step (B, Y in the AC1 fixture) is absent from it. An implementer following step 1 literally has
   no partition key for those steps. Required: state in Decision 2 and task 2.2 that a step's
   partition is the root whose `trunkOfRoot` walk produced it during the union derivation of task 2.1
   (label each step as the union is built), and that the `rootIdsOf`-style map is used only as
   `trunkOfRoot`'s `rootIdOfStep` seed — never as a per-step partition lookup.
   Related, non-blocking within this CR: task 2.1 says read that map "inside the same transaction",
   but `rootIdsOf` returns a `Future` wrapped in its own `withSystemContext` and is not composable
   into the `DBIO` action; say explicitly that the executor issues the equivalent query as a `DBIO`
   inside `action`.

3. **Task 6.1's "union of every root's root-level lane" is ambiguous, and one reading 422s.**
   `buildLaneGraph` (`frontend/src/features/pipelines/state/stepTree.ts:104-135`) seeds **one lane per
   root-level step**, and a root may legitimately have more than one (`childrenOfRoot` returns a
   `position`-sorted list; only the `position == 0` child is trunk — the rest are tail roots). The
   backend union is `trunkOfRoot` per root, i.e. exactly **one** chain per root. A `filter`-style
   reading of "every root's root-level lane" would therefore include tail ids and 422 under the
   endpoint's own "tail ids are not accepted here" rule. Required: task 6.1 must specify one lane per
   root — the lane seeded by that root's first/`position == 0` root-level step (the `.find` the current
   code already uses, generalised over `roots` rather than `roots[0]`) — and task 6.2's two-root test
   should assert exactly the two trunk ids, with a fixture containing a tail so the wrong reading is
   caught rather than merely avoided.

### Non-blocking notes

- Design.md cites `PipelineStepRepository.scala` / `PipelineService.scala` without their packages;
  the real paths are under `com/helio/infrastructure/persistence/pipelines/` and
  `com/helio/services/pipelines/`. Harmless, but `proposal.md`'s `backend/.../persistence/pipelines/…`
  elision hides a `infrastructure/` segment an implementer may grep for.
- Task 1.2's "unfixed" reproduction is sound in principle (`reorderTrunkInternal` is public, the
  fence is service-level). Worth noting in the task that the reproduction must be run *before* task 2
  lands, since the task-2 edit destroys the ability to observe it.
- Decision 7 and task 4.6 already forbid re-deriving expected values from the implementation's own
  helper; once CR1 lands, take care that the AC2 assertion's "owning root" is computed by the test
  independently (e.g. from the parent chain) rather than by calling the same `trunkOfRoot`-union
  labeling the implementation uses.
