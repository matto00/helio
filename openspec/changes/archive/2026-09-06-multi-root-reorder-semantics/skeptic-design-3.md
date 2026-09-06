## Skeptic Report — design gate (round 3, skeptic-design-3.md)

Cold re-derivation from the live tree and the artifacts; round 1/2 reports read as claims only.

### What I verified (with evidence)

**CR1 (design.md Decision 6 asserting the refuted raw-`root_id`-map AC2) — fixed.**
`design.md:131-134` now reads "AC2 remains the load-bearing criterion, but is **not** unchanged: it was
separately found to be factually wrong as briefed and corrected to a two-part assertion … see Decision 7,
which supersedes the briefed 'full before/after `root_id` map' wording entirely. Nothing in this decision
authorises the raw column map." The round-2 sentence ("AC2 … is unchanged") is gone —
`grep -n "unchanged and remains" ` over all four artifacts returns nothing. Decision 6 and Decision 7 no
longer disagree, and Decision 6's AC1 content is untouched.

**CR2 ("union of every root's root-level lane") — fixed in all three places, and I re-swept independently.**
`grep -n "root-level"` across `proposal.md`, `design.md`, `tasks.md`, `specs/pipeline-step-reorder/spec.md`
returns 7 hits, all now the corrected formulation:
- `proposal.md:24-25` — "each root's trunk lane (that root's `position == 0` root-level chain), one per root
  — not every root-level lane, which would include tail roots and 422."
- `design.md:99-104` — "**exactly one lane per root** … It is emphatically *not* a filter over every
  root-level lane".
- `tasks.md:85-89` — same, with the `.find` generalisation spelled out.
- `spec.md:107-112` — "the trunk step ids of every root — for each root, the ids on that root's
  `position == 0` root-level chain and no others (… no tail id, which the endpoint rejects)". This is the
  artifact that becomes permanent spec; it can no longer be read as including tail root-level lanes.
No fourth instance exists. The scenario heading at `spec.md:123` ("sends every root's lane") is singular
per root and its body says "the trunk step ids of both roots" — not the refuted reading.

**The corrected frontend reading is the one the real code supports.** `buildLaneGraph`
(`frontend/src/features/pipelines/state/stepTree.ts:104-205`): root seeds are enqueued position-sorted
(`:130-135`, `sortSiblings` at `:118`) before any descendant is pushed, lanes are appended in pop order, and
each lane follows only the `position === 0` continuation (`:174-184`) — so a root's *first* lane matching
`parentStepId === undefined && rootId === r.id` is exactly that root's trunk, and a root with a root-level
tail genuinely yields extra matching lanes. Task 6.1's "generalise the existing `.find` over `roots`" is
therefore correct, and the empty-root placeholder (`:193-205`, `steps: []`) contributes nothing. The
existing stopgap it replaces is real: `usePipelineDetailPage.ts:999-1009` (`roots[0]`, and the
"reorder is still root-0-only … HEL-973" comment task 6.1 removes).

**Round 2's non-blocking notes were taken.** The total operational definition of "owning root" (walk
`parentStepId` to the parentless ancestor, read its `root_id`) is present in `design.md:157-160`,
`tasks.md:50-53`, and the spec delta's AC2 scenario — so a tail-bearing fixture is unambiguous. Task 7.2
now requires a body-scoped `sed -n` extraction and names the legitimate other call sites; I confirmed those
exist (`firstRootIdAction` defined at `PipelineStepRepository.scala:44`, used elsewhere in the file), so a
whole-file grep would indeed have looked like a failed proof.

**Premise and mechanism re-checked against the tree (not taken from the artifacts).**
`reorderTrunkInternal` at `PipelineStepRepository.scala:636-660` contains verbatim `currentTrunk =
trunkOf(steps)`, `rootId <- firstRootIdAction(pipelineId.value)` and `if (idx == 0) Some(rootId) else None`.
The HEL-913 fence is at `PipelineService.scala:2115-2129` (`listRootDataSourceIdsInternal` → `roots.size > 1`
→ `ServiceError.BadRequest`). `trunkOfRoot`/`childrenOfRoot` (`:946-963`) have exactly the signature
Decision 2 assumes; `rootIdsOf` (`:859`) does filter head steps and does return a `Future` in its own
`withSystemContext`, so tasks 2.1/2.2's prohibition is correct and implementable (the `action` already
fetches all rows, which carry `root_id`).

**Escalation authority verified at source**, not from prose: `.concertino/runs/HEL-973/events.jsonl:7`
`escalation.raised` (options `derived-plus-column,derived-membership-only,keep-literal-column-map,halt`)
and `:8` `escalation.answered` = `derived-plus-column`. AC2's two-part form in `ticket.md:41`,
`design.md` Decision 7 and `tasks.md` 4.2 all match that answer.

**Coverage / contradiction sweep (nothing blocking found).** AC1 → task 4.1 + spec two-root scenario;
AC2 → task 4.2 + spec owning-root scenario; AC3 (`firstRootIdAction` absence) → tasks 2.4 + 7.2; AC4
(`check:schemas`) → tasks 5.1-5.2. Non-goals (no migration, no inter-root semantics, tails untouched) are
consistent across proposal/design/spec. No `TODO`/`TBD`/deferred decision remains in any artifact.

### Verdict: CONFIRM

### Non-blocking notes

1. `proposal.md:29` says the root-aware derivation is "built on the existing `trunkOfRoot`/`rootIdsOf`",
   while `design.md` Decision 2 step 1 and `tasks.md` 2.1/2.2 explicitly forbid *calling* `rootIdsOf` here
   (non-composable `Future`, and wrong as a partition key). The charitable reading is "a `rootIdsOf`-shaped
   seed map", and the wrong reading fails to compile rather than shipping, so this is not blocking — but it
   is the same stale-phrasing class rounds 1-2 refuted, and one word ("`rootIdsOf`-shaped seed") would close it.
2. `design.md:161` duplicates a clause: "The complete step-id → owning-root map the complete step-id →
   owning-root map is identical before and after." Editing artifact.
3. `spec.md:141-142` has a dropped word / stray line break: "the root whose trunk chain the step is reachable
   , derived by walking …" (missing "on"). This line becomes permanent spec at archive.
4. Task 3.1 says to remove "the `listRootDataSourceIdsInternal` call that exists only to feed it" — the
   *call site*, not the method, which `PipelineRunService.scala:252` and `WorkspaceContextService` still use.
   Worth stating explicitly so the executor does not delete `PipelineRepository.scala:124`.
5. Round 1's package-path elision persists in `proposal.md`/`design.md` (`backend/.../persistence/pipelines/`).
   Grep-hostile, harmless.
