## Context

`PUT /api/pipelines/:id/steps/order` predates multi-root pipelines. HEL-913 fenced it closed on any pipeline
with more than one root because `reorderTrunkInternal` (a) derives "the trunk" via the root-unaware `trunkOf`
and (b) writes the head step's `root_id` from `firstRootIdAction` — the lowest-positioned root — so a step of
root B could be silently moved into root A. That fence is a placeholder; this change replaces it.

**Premise confirmed against the live tree** before any design work (evidence:
`.concertino/runs/HEL-973/evidence/premise-validation.md`). All three cited mechanisms exist verbatim:
`trunkOf(steps)` at `PipelineStepRepository.scala:641`, `firstRootIdAction` at `:650`, and the
`if (idx == 0) Some(rootId) else None` write at `:653`; the fence is at `PipelineService.scala:2124-2129`.
The tree's highest migration is V100 (the brief said V101 — a harmless staleness; no migration is needed here
either way, see Decision 5).

## Goals / Non-Goals

**Goals**
- Whole-pipeline reorder semantics on a multi-root pipeline, per the owner ruling.
- Root membership invariant under reorder, by construction rather than convention.
- `firstRootIdAction` deleted from this path, not bypassed.
- The fail-closed 400 replaced by real behaviour; `check:schemas` green.

**Non-Goals**
- Re-opening the semantics decision (see Decision 1).
- Giving inter-root ordering any semantic meaning.
- Reordering, or even reading, tail rows.
- Touching HEL-590's or HEL-890's files.

## Decision 1 — Semantics: whole-pipeline (option 2), by owner ruling

The ticket offered per-root reorder (option 1, needing a `rootId` on the request) and whole-pipeline reorder
(option 2, roots interleaved by position), and leaned toward option 1. **The owner ruled option 2.**
`ReorderPipelineStepsRequest` therefore keeps its exact current shape: `stepIds` only, no `rootId`.

This is recorded here as a ruling, not a conclusion this design reached. It is not to be re-litigated on the
grounds that per-root is more intuitive. It reopens only on demonstrated evidence that whole-pipeline reorder
cannot be implemented without violating an invariant — a contradiction shown, never a preference argued.
Decision 2 is the analysis of exactly that risk, and finds no contradiction.

## Decision 2 — Root membership invariance, and the trap that makes it non-obvious

Whole-pipeline semantics means one `stepIds` list legitimately contains steps of different roots. That is
precisely the input HEL-913 fenced off, so the design's central obligation is:

> A step's `root_id` after the call equals its `root_id` before the call. Always. For every step.

The trap: the *existing* relink algorithm is "chain the whole list" — `stepIds[0]` parentless, `stepIds[i]`'s
parent is `stepIds[i-1]`. Applied naively to a cross-root list, that **merges the roots into one chain**: root
B's steps acquire parents in root A, their `root_id` goes `NULL`, and they now belong to root A. That would be
the very corruption HEL-913 fenced, re-introduced under a ruling. Whole-pipeline reorder is therefore **not**
"one flat chain", and reading it that way is the single most likely wrong implementation of this ticket.

**The correct reading, and the algorithm:**

1. Read all steps and the head-step `stepId -> rootId` seed map in the same transaction. Note `rootIdsOf`
   itself returns a `Future` inside its own `withSystemContext` and is **not** composable into this method's
   `DBIO` action — issue the equivalent query as a `DBIO` inside `action` rather than calling it.
2. Derive the current trunk as the **union** of `trunkOfRoot(steps, rootIdOfStep, r)` over every root `r`.
   Validation is unchanged in kind: `stepIds` must be exactly a permutation of that union.
3. **Partition** `stepIds` by each step's *current* root membership, preserving the requested relative order
   within each partition. A step's partition is the root whose `trunkOfRoot` walk produced it **during task
   2.1's union derivation** — label each step with its root as the union is built. This is the only correct
   partition key, and the obvious alternative is broken: `rootIdsOf` filters `s.rootId.isDefined`, so it
   contains **only parentless head steps** and has no entry at all for a non-head trunk step like B or Y. It
   is used solely as `trunkOfRoot`'s `rootIdOfStep` seed, never as a per-step partition lookup. A step's
   partition is thus read from pre-existing structure, never chosen by the algorithm.
4. Relink **each partition independently** as that root's own chain: the partition head is parentless with
   `root_id = <that partition's own root id>`; every later member's parent is its predecessor **within the
   same partition**, `root_id = NULL`; all `position = 0`.

Root membership is invariant here *by construction*: a step's destination chain is derived from its own
current root, so there is no code path that could assign it a different one. Nothing "resolves the root"; the
partitioning is total and per-step. This is what makes the ruling safe, and it is why no invariant-violation
escalation is warranted.

The interleaving in `stepIds` is thus positional only — it is discarded across partitions and preserved within
them. That matches R3's statement that inter-root order carries no semantic weight: the request may express an
inter-root order, and the system deliberately declines to give it meaning.

## Decision 3 — `firstRootIdAction` is deleted from this path, not guarded

Per HEL-913 task 7.3d ("a reachable arm is a defect, not debt"), `reorderTrunkInternal` must contain **no**
call to `firstRootIdAction`. Under Decision 2 each partition head already carries its own root's id, so the
fallback has no remaining job — keeping it "just in case" would reintroduce exactly the defect, since the
only way it could ever fire is by assigning a root the algorithm did not derive per-step.

`firstRootIdAction` remains a private method used by *other* call sites in this file and in `OutputRepository`;
those are out of scope. The obligation is its absence from **this** path, proven by grep in the tasks.

## Decision 4 — Validation stays "exact permutation of the union", and the frontend must widen

The endpoint keeps exact-permutation validation (no missing id, no unexpected id, no duplicate) — now against
the union of all roots' trunks. The alternative, accepting a subset as "reorder just these", was rejected: it
would make a partial payload silently a no-op for the omitted roots, which is the class of silent-partial
behaviour this endpoint's 422 contract exists to prevent.

That has a real frontend consequence, and it is why frontend work is in scope. `usePipelineDetailPage`'s
`handleReorderSteps` currently derives the payload from **root 0's lane only** (an explicit HEL-968 stopgap
that names HEL-973 as its resolution). Against the widened contract, that payload would 422 on any multi-root
pipeline for the omitted roots' ids. The payload therefore becomes **exactly one lane per root** — for each
root, the lane seeded by that root's `position == 0` root-level step — local-only `step-N` ids still excluded.
It is emphatically *not* a filter over every root-level lane: `buildLaneGraph` seeds one lane per root-level
*step*, and a root with a tail has several, the extras being tail roots whose ids the endpoint rejects; that
reading would 422. No visual or interaction change is required — a root-scoped drag still
produces a whole-pipeline payload — so `DESIGN.md` raises no obligations here beyond leaving the existing
affordance untouched.

## Decision 5 — No migration

This is a relink over existing `parent_step_id` / `root_id` / `position` columns. No schema change, no data
backfill. Stated explicitly because the environment brief asks for a reason before any migration is written:
there is none to write. The V98 CHECK constraint (parentless iff `root_id` non-null) is *satisfied* by
Decision 2's algorithm rather than modified by it — each partition head is parentless with a non-null root id,
every other member has a parent and a `NULL` root id, and both halves are written in the same update, so the
constraint never sees an intermediate violation.

## Decision 6 — AC1 is restated, explicitly and on the record

The ticket's original AC1 read: *"Reordering one root's trunk on a two-root pipeline reorders only that root's
steps."* That criterion was written for **option 1**. Under the ruled option 2 there is no per-root call to
make — "reordering one root's trunk" is not an operation the API offers — so the criterion as worded describes
an interaction that cannot occur, and satisfying it literally would mean building the rejected design.

It is therefore **restated**, preserving its protective intent (a reorder must not disturb another root's
membership):

> On a two-root pipeline, a whole-pipeline reorder applies each root's requested relative order to that root's
> own trunk, and a step of root B never lands in root A's chain.

This is recorded here, per the ticket's explicit instruction, so that the original is neither silently
satisfied under its old wording nor silently dropped. AC2 remains the load-bearing criterion, but is **not** unchanged:
it was separately found to be factually wrong as briefed and corrected to a two-part assertion (derived
owning-root map equality + head-marker column invariant) — see Decision 7, which supersedes the briefed
"full before/after `root_id` map" wording entirely. Nothing in this decision authorises the raw column map.

## Decision 7 — AC2 was factually wrong as briefed, and is corrected (owner-answered)

This is recorded as an explicit **correction of a factual error in the criterion**, not a preference change,
and is disclosed here on the record exactly as Decision 6 discloses AC1's restatement — AC2 is the
load-bearing criterion, so a silent adjustment would be the worst possible handling.

AC2 was briefed as *"no step changes its `root_id` … assert the full before/after `root_id` map"*, written in
the belief that `root_id` is a membership label. It is not. `V98__pipeline_roots.sql` enforces
`CHECK ((parent_step_id IS NULL) = (root_id IS NOT NULL))`, which makes `root_id` a **head marker**: non-null
on exactly the one parentless head step of each root, `NULL` on every other trunk step.

On this design's own AC1 fixture (R1: A → B, R2: X → Y, `stepIds: [B, X, A, Y]`), correct code produces
`A.root_id: R1 → NULL` and `B.root_id: NULL → R1`. Membership is fully preserved — A and B are both still on
R1's trunk, nothing crossed roots — but the **raw column map is not equal**, and cannot be, for any reorder
that moves a root's head. A literal column-map assertion is therefore **red on correct code**, which in turn
makes the AC2 mutation unable to go red *from* green: the criterion called load-bearing would have certified
nothing.

**Resolution (escalated; `escalation.answered` = `derived-plus-column`):** AC2 becomes two assertions.

- **Derived owning-root map equality.** Each step is labelled by its owning root, defined operationally and
  totally as: walk the step's `parentStepId` chain to its parentless ancestor and read that ancestor's
  `root_id`. (This is total — it covers tail steps, which are on no trunk chain, as well as trunk steps.) The
  complete step-id → owning-root map the complete step-id → owning-root map is identical before and after. The label MUST be computed by
  the test **by walking the parent chain itself**, independently of the production helper that decides
  ownership. A test calling the same function the implementation uses re-derives its expected value from the
  source under test and asserts nothing.
- **Head-marker column invariant.** Before and after, **each root has exactly one head step, parentless and
  carrying that root's own id**. The column stays in the assertion rather than being dropped: the column is
  where the original corruption manifested, so a test that stops looking at it loses its connection to the
  defect.

Both must hold. The mutation (Decision 8) is re-run against the corrected criterion, and can now genuinely
fire.

## Decision 8 — Establishing the defect's mechanism given the fence

The evidence standard requires reproducing the cross-root reassignment against real behaviour rather than
trusting the ticket's description. The route-level fence makes it unreachable over HTTP — but
`reorderTrunkInternal` is a public repository method, so a repository-level spec can call it directly on a
two-root fixture **before** the fix and observe a step's `root_id` change. That is the reproduction, and it is
what the AC2 mutation then re-runs against the fixed code.

The AC2 mutation is specified concretely because a mutation that cannot go red is worthless: reintroduce the
`firstRootIdAction`-derived root assignment for the head step, and the **derived owning-root map** assertion
(Decision 7) on a two-root pipeline must go **red**. Under the corrected criterion this mutation genuinely
can fire — it merges a root's head into the lowest root, which changes derived ownership — whereas under the
briefed column-map wording it could not have fired from green. If it stays green, the test is not testing
root membership and must be fixed rather than weakened. Confirm the mutation is capable of firing, and that
the failure isolates to it, before treating it as evidence.

## Risks / Trade-offs

- **Wrong reading of "whole-pipeline" as one flat chain** — the highest-severity risk, and the reason
  Decision 2 spells out the trap. Mitigated by AC2's direct before/after map assertion, which goes red under
  exactly that mistake.
- **RLS/superuser masking** — a spec that builds `DbContext(db, db)` gives both pools a superuser connection
  and asserts RLS-dependent behaviour vacuously. `reorderTrunkInternal` is `withSystemContext` (privileged by
  design), so RLS is not what these assertions turn on; tests must not claim RLS coverage they do not have.
- **Shared dev database** — all worktrees share one Postgres and one `flyway_schema_history`. No migration is
  added (Decision 5), so this change cannot poison it.
- **Single-root regression** — the widened contract is a strict generalisation (union of one trunk is that
  trunk), guarded by an explicit single-root scenario in the spec delta.
