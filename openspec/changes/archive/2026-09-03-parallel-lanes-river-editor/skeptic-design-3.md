## Skeptic Report — design gate (round 3, skeptic-design-3.md)

### What I verified (with evidence)

Fresh spawn. Every claim below re-derived from the current artifacts and the shipped tree.

**Round-2 CR1 — RESOLVED.** `design.md:35-36` now reads "Per-lane analyze, previews, Outputs rails, row
counts, and mobile stacking. (The failing-lane-path highlight is explicitly NOT a goal — see Decision 5 and
Non-Goals.)" and a matching Non-Goals bullet exists at `:40`. `grep -rniE "lane path|lanePath|highlight"`
across the change dir now returns only: `ticket.md` (immutable input), `design.md:25` (Context describing
contract item 11 — accepted in round 2), Decision 5, the Non-Goals bullet, the deferral text in
`specs/pipeline-lane-run-reporting/spec.md` Purpose, and task 6.3's do-NOT-implement. No artifact plans to
consume or derive it.

**Round-2 non-blocking note (7.3) — RESOLVED.** `tasks.md:107-112` now splits the two mechanisms by name:
the `*.css.test.ts` sweep for the 44px floor at 375/430px, the Playwright spec (8.1) for lane STACKING at
both widths, with the explicit statement that the sweep "parses CSS, NOT a viewport render, so it cannot
demonstrate that lanes stack" and a lesson-4 citation. That is the correct separation.

**Round-1 items re-confirmed still resolved (not taken on round 2's word).** CR3: `proposal.md:48` reads
`ui/stepConfigs/{UnionConfig,LookupConfig}.tsx`; `ls ui/stepConfigs/` has no `JoinConfig.tsx`. CR4:
`tasks.md:127-130` and `proposal.md:46` state the boundary as `frontend/**` plus the repo-root `e2e/` suite
with `schemas/`/`backend/`/`helio-mcp/` forbidden; `playwright.config.ts:11` `testDir: "./e2e"` at the repo
root confirms the geometry. Round-1 non-blocking note: `specs/pipeline-step-tree/spec.md` carries a REMOVED
block for "At most one trunk child per node" with reason and a "no frontend or backend change accompanies
this removal" migration.

**Contract conformance (P2.1 archive `design.md` § Engine contract) — re-checked, clean.** Item 2 honoured
by Decision 1 and the step-tree delta's "SHALL NOT treat a `position = 0` child as structurally special".
Item 6 honoured by tasks 2.2/5.4/5.5 and the rejoin-picker delta's "A non-ancestor node in any lane is
selectable ... whether or not `b` is its lane's terminal step, and whether or not `b` is already consumed".
Item 6b honoured by 5.4's explicit prohibition on any left-of/above-of filter plus the delta's separate
"The picker imposes no ordering restriction" requirement with both a right-of and a below scenario. No
UI-invented engine restriction anywhere in the plan.

**Premise spot-checks against the shipped tree.** `stepNarrowing.ts:498-530` — both degrade-to-`""` branches
are exactly as described. `PipelineRiverView.tsx:412` `!stepTree.tailsByStepId[step.id]`, `:311`
`trunkLastHasTail`, `:485` the refusal message string — all present. No frontend Jest snapshots exist
(`find frontend -name '*.snap' -o -name __snapshots__` → nothing outside `node_modules`).

**Where I broke it.** The plan enumerates its Jest blast radius carefully but never enumerates its
**Playwright** blast radius, and three shipped e2e specs assert the exact invariants and DOM this change
deletes. See CR1.

### Verdict: REFUTE

### Change Requests

1. **Three shipped e2e specs assert invariants and DOM this change removes, and no task covers them.**
   `tasks.md` §8 only *adds* `hel912-lanes-rejoin.spec.ts`; nothing anywhere names the existing specs.
   Reproduced by grep:
   - `e2e/hel908-tail-attach.spec.ts:76` `await expect(page.getByRole("button", { name: "Add tail step" })).toHaveCount(2)`
     and `:93-95` — after adding a tail, *"its 'Add tail step' button disappears (single-tail-per-node
     enforcement)"*, asserting `toHaveCount(1)`. That is verbatim the invariant task 4.1 deletes. The spec
     will fail deterministically, and it also keys on an accessible name the "+ lane" rename changes.
   - `e2e/hel908-trunk-reorder-drag.spec.ts:110,116,206,209,226` locate
     `.pipeline-detail-page__tail-chain-item` — a class emitted by `ui/TailChain.tsx`, which task 3.1
     **retires** into `LaneColumn.tsx`. If `LaneColumn`'s compact branch does not emit that class, these
     assertions break too.
   Required: (a) add a task that names these files and states that the tail-attach count assertions are
   updated *because* the single-tail invariant is deliberately deleted (spec delta `pipeline-tails-ui`
   REMOVED "Editor refuses a second branch") — with the reason recorded, so this is not the
   "fixture edited to make tests pass" anti-pattern applied silently; and (b) require `LaneColumn`'s compact
   branch to **preserve the existing `pipeline-detail-page__tail-chain-item` DOM/class contract**, since
   that class is the only machine-checkable expression of AC2's "tails render identically" that actually
   exists, and three specs plus the page CSS depend on it. Extend task 3.3's STOP-and-state-why rule to
   cover e2e assertions, not just Jest ones.

2. **`design.md:108` still asserts the snapshot mechanism round 1 refuted and task 3.3 disowns.** It reads
   *"...which is what makes 'tails render identically' verifiable against the existing snapshots rather than
   asserted."* There are no frontend snapshots (verified above), and `tasks.md:41-43` says so in terms
   ("There are no Jest snapshots anywhere in the frontend ... AC2's wording points at an artifact that does
   not exist"). This is the same residue shape as round-2 CR1 — a stale line claiming a verification
   mechanism that does not exist is exactly the lesson-4 "green gate that scans nothing" framing, and an
   executor reading Risks/Trade-offs would believe tails are already covered. Rewrite the clause to point at
   task 3.3's explicit property guard (and, per CR1, the `tail-chain-item` DOM contract).

3. **`design.md:131` contradicts this change's own spec delta.** Planner Notes says of the stale
   "At most one trunk child per node" requirement: *"Not edited here; flagged for a follow-up."* It **is**
   edited here — `specs/pipeline-step-tree/spec.md` carries a full `## REMOVED Requirements` block for it
   with reason and migration. Leaving the note as-is either invites the executor to drop that block as
   out-of-scope or leaves a follow-up nobody files. Update the note to record that the removal is handled in
   this change's `pipeline-step-tree` delta as an openspec-only edit with no code change.

### Non-blocking notes

- `tasks.md:66` says "In `state/stepNarrowing.ts`, change `UnionConfigValue` and `LookupConfigValue`" — those
  two interfaces are declared in `ui/stepConfigs/UnionConfig.tsx:18` and `LookupConfig.tsx:23` and merely
  *imported* by `stepNarrowing.ts:71,79`. Also unmentioned: `ui/stepConfigs/UnionConfig.test.tsx:37` and
  `LookupConfig.test.tsx:43` construct the flat `otherDataSourceId`/`referenceDataSourceId` shape and must be
  updated. Not blocking — `npm run typecheck` (task 9.1) makes both unmissable — but the file attribution is
  wrong as written.
- The `pipeline-tails-ui` delta's scenario "the rendered output is unchanged from the pre-lanes rendering"
  is not mechanically verifiable for the same no-snapshots reason. Acceptable as a *requirement* (specs state
  properties, not test plans) given task 3.3 pins the checkable sub-properties — but the executor must not
  cite that scenario as if a test proved it.
- Decision 6 (`join` out of scope) remains a narrowing of the ticket's literal "join/union/lookup config"
  wording. Justified in design.md and the rejoin-picker delta; AC1 only requires `union`. Accepted, and it
  should stay visible in the final report.
- Ticket AC2's literal wording is "rejoin picker **excludes** ancestor lanes"; the design instead lists them
  disabled-with-a-reason. That is a better UX and is stated in the delta — but it is a literal-wording
  deviation (lesson 2) and the final gate should read it as satisfied-by-intent, not verbatim.
