## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence)

Cold re-derivation from the live tree; round 1's claims were re-checked, not assumed.

**CR1 (AC2 / `root_id` head marker) — substantively fixed.**
- Escalation is real and answered, not a unilateral restatement:
  `.concertino/runs/HEL-973/events.jsonl:7` (`escalation.raised`, options
  `derived-plus-column,derived-membership-only,keep-literal-column-map,halt`) and `:8`
  (`escalation.answered`, `answer":"derived-plus-column"`).
- Disclosure is factual, not preferential: `design.md` Decision 7 names the mechanism
  (`V98__pipeline_roots.sql:126-127` `CHECK ((parent_step_id IS NULL) = (root_id IS NOT NULL))` —
  verified verbatim in the tree), works the AC1 fixture through it (`A.root_id: R1 → NULL`,
  `B.root_id: NULL → R1`), and states plainly that this is a correction of a factual error.
  `ticket.md`'s "Note on AC2" mirrors it. Both keep the column assertion rather than dropping it.
- The corrected criterion is true on correct code: (a) derived owning-root map equality holds under
  the partitioned relink by construction; (b) "each root has exactly one parentless head carrying its
  own id" is exactly what V98's CHECK plus Decision 2 step 4 produce.
- Task 4.3's mutation can now fire *from green*: reintroducing the `firstRootIdAction` head
  assignment makes R2's head X parentless with `root_id = R1`, so a parent-chain walk relabels X (and
  its chain) from R2 to R1 → 4.2(a) red, and 4.2(b) red too (R2 has zero heads). I checked V98 for a
  uniqueness constraint that would abort the mutation as a DB error instead of a clean assertion
  failure — there is none on `pipeline_steps.root_id` (the only new unique index is
  `idx_node_snapshots_root_unique`, V98:232), so the failure isolates as an assertion.
- 4.2(a) cannot be satisfied circularly: task 4.2(a) and Decision 7 both require the label be computed
  "by walking the parent chain itself", explicitly forbidding `trunkOfRoot`/the implementation's own
  union labelling.

**CR2 (partition key) — fixed and implementable.** `rootIdsOf`
(`backend/src/main/scala/com/helio/infrastructure/persistence/pipelines/PipelineStepRepository.scala:859`)
does filter `s.rootId.isDefined` and does return `Future` inside its own `ctx.withSystemContext` —
so round 1's objection was correct and the new wording (per-step labels applied during task 2.1's
`trunkOfRoot` union walk; `rootIdsOf`-shaped map only as `trunkOfRoot`'s `rootIdOfStep` seed; seed
read as a `DBIO` inside `action`) is both correct and implementable: `reorderTrunkInternal`'s `action`
(:637-660) already runs `stepsTable.filter(_.pipelineId === …).result` inside the transaction, so the
seed is a trivially composable `DBIO` (or derivable from the already-fetched rows, which carry the
`root_id` column even though the domain trait does not). `trunkOfRoot` (:951) / `childrenOfRoot`
(:946) have exactly the signature the design assumes.

**CR3 (frontend lane selection) — fixed in `tasks.md`, verified against the real code.**
`buildLaneGraph` (`frontend/src/features/pipelines/state/stepTree.ts:104-190`) seeds the queue with
**every** step in `rootStepsByRootId.get(root.id)` (position-sorted), so a root with a tail root-level
step genuinely yields more than one lane with `parentStepId === undefined` and that same `rootId` —
round 1's 422 hazard is real. Lanes are pushed in pop order and the seeds are enqueued before any
descendants, so the *first* lane matching `(parentStepId === undefined && rootId === r.id)` is the
`position == 0` one: task 6.1's "generalise the existing `.find` over `roots`" is exactly right, and
task 6.2's tail-bearing fixture would catch the `filter` reading. Empty roots produce a placeholder
lane with `steps: []` (:195-205), which contributes nothing — harmless.

**What round 1 missed / what survives.** Two artifacts still carry, verbatim, the two formulations
round 1 refuted. `tasks.md`, `ticket.md`, and the spec delta's endpoint requirement are all correct;
these two are stale leftovers, and both sit in binding documents.

### Verdict: REFUTE

### Change Requests

1. **`design.md` Decision 6 still asserts the refuted AC2, contradicting Decision 7 on the
   load-bearing criterion.** Its closing sentence reads: *"AC2 (the full before/after `root_id` map)
   is unchanged and remains the load-bearing criterion."* Decision 7, three paragraphs later, proves
   that exact formulation is red on correct code. An executor reading Decision 6 has written
   authority for the raw column map — the precise failure mode CR1 exists to close. Required: replace
   that sentence with a pointer to Decision 7's corrected two-part AC2 (derived owning-root map
   equality + head-marker column invariant). Decision 6's AC1 content is otherwise sound and should
   be left alone.

2. **The frontend payload contract is still stated in the wording CR3 identified as the 422 reading,
   in the two places that outlive `tasks.md`.** `specs/pipeline-step-reorder/spec.md` (second
   requirement, "Pipeline editor supports drag and keyboard reordering of steps") says *"The payload
   SHALL be the union of **every** root's root-level lane"*, and `design.md` Decision 4 says *"the
   payload therefore becomes the union of every root's root-level lane"*. `buildLaneGraph` produces
   more than one root-level lane per root when a root has a tail (verified above), so the natural
   `filter` reading of both sentences sends tail ids and 422s. Only `tasks.md` 6.1 was corrected, and
   the spec delta is the artifact that becomes permanent spec at archive. Required: restate both as
   **exactly one lane per root — the lane seeded by that root's `position == 0` root-level step** (the
   spec sentence may stay behaviour-level, e.g. "the trunk step ids of every root", provided it can no
   longer be read as including tail root-level lanes), consistent with task 6.1.

### Non-blocking notes

- The "owning root" gloss — *"the root whose trunk chain the step is reachable on"* (spec delta and
  Decision 7) — is undefined for a **tail** step, which is on no trunk chain, while AC2 says "for
  every step". Task 4.2(a)'s operational definition (walk the parent chain to the parentless
  ancestor, read its root) is total and covers tails correctly. Worth one clause aligning the prose
  to the operational definition, so a tail-bearing AC2 fixture is not ambiguous.
- Round 1's package-path note still stands: `design.md`/`proposal.md` elide
  `com/helio/infrastructure/persistence/pipelines/` and `com/helio/services/pipelines/`. Harmless but
  grep-hostile; task 7.2's `backend/.../PipelineStepRepository.scala` placeholder inherits it.
- Task 7.2 asks for zero `firstRootIdAction` hits *within `reorderTrunkInternal`'s body*, but a plain
  `grep -rn` on the file returns the legitimate other call sites (:44, :100, :283, :396, :469). The
  task already says so; the executor should record a body-scoped extraction (e.g. `sed -n` over the
  method range piped to grep) rather than a whole-file grep whose non-zero output looks like a failed
  proof.
