## Skeptic Report — final gate (round 2, skeptic-final-2.md)

Cold spawn. Every statement below is grounded in a command I ran or an image I looked at in this
worktree. `evaluation-*.md` and `files-modified.md` were read only as claims.

### What I verified (with evidence)

**1. The CR1 layout defect is REALLY fixed (highest-value check).**
I drove a fresh account/source/pipeline against the live servers (`assert-phase.sh servers` → `PASS
servers`), created a filter + two `Group & aggregate` lanes, and screenshotted at 1440×1100 in BOTH
themes (`helio-theme` localStorage flip + reload) and at 375px.
- `shots/desktop-LIGHT-1440.png` and `shots/desktop-DARK-1440.png`: the two lanes render side by
  side; each lane's card is full width in its own column; **no label wrapping, no collision with the
  disable/duplicate icons**; each lane's "Branch" button sits **beneath** its card, inside its dashed
  connector run. The round-1 defect is gone in both themes, and light/dark parity is now *observed*,
  not inferred from token usage.
- `shots/mobile-375.png`: lanes stack vertically, each preceded by a visible `LANE 1` / `LANE 2`
  header. AC3 holds on a real render.
- Byte-identity claim re-checked against ground truth: `git show a45e9881:…/TailChain.tsx` puts
  exactly `<span class=…tail-chain-connector>` + `<StepCard>` inside `.tail-chain-item`.
  `LaneColumn.tsx:161-190` now contains exactly those two children inside `.tail-chain-item`, with
  `renderAddLaneAffordance`/`renderChildLanes` as siblings in the new `.tail-chain-step` wrapper. The
  comment's claim is now **true**, not true-by-assertion.

**2. The `stepSection()` helper was NARROWED, not widened — demonstrated, not reasoned.**
I replaced `LaneColumn.tsx` with its pre-fix `084978b7` content and ran the spec live:
`npx playwright test e2e/hel912-lanes-rejoin.spec.ts` → **1 failed**. Restored (`git status
--porcelain` clean). So the spec would NOT pass against the pre-`ef416a1e` nesting: the guard is
maintained, not retired. On the final tree the same spec passes.

**3. hel908 specs.** `git diff --stat a45e9881...HEAD -- e2e/hel908-*.spec.ts` → empty (both 0-line).
Live: `npx playwright test e2e/hel908-trunk-reorder-drag.spec.ts e2e/hel912-lanes-rejoin.spec.ts
--reporter=line` → **2 passed (7.7s)**.

**4. AC2 mutation proof re-derived against the FINAL tree.** Mutated
`LaneColumn.tsx`'s `className="pipeline-detail-page__tail-chain-item"` → `"MUTATED"`, ran
`PipelineRiverView.test.tsx`: **1 failed, 18 passed** — exactly one, a single mutation, not a
conjunction. (Control: mutating the *new* `.tail-chain-step` wrapper → 19 passed; that wrapper is
unguarded in Jest but IS guarded by the e2e spec per finding 2.) File restored.

**5. All six gates re-run by me.**
`typecheck` exit 0 · `lint` (`eslint src --max-warnings=0`) exit 0 · `format:check` → "All matched
files use Prettier code style!" · `jest` → **254 suites / 2613 tests passed, Snapshots: 0 total** ·
`build` → succeeded · live e2e as above.

**6. Scope boundary — CLEAN.** `git diff --name-only a45e9881...HEAD` filtered against
`^(frontend/|e2e/|openspec/changes/parallel-lanes-river-editor/)` returns nothing. No `backend/`,
`schemas/`, `helio-mcp/`.

**7. tasks.md tick state vs the TREE.** 36 ticked, **zero** unticked. Task 6.3's
DO-NOT-IMPLEMENT still holds: `grep -rn 'lanePath|lane-path'` over `frontend/src/features/pipelines`
and `e2e/` returns nothing. Task 1.1's text now states the position-0 ruling correctly (round-1 CR6
fixed), and design.md:130 now flags the old bullet as repudiated.

**8. Family-2 residue swept independently** (my own `grep -rn` for `"second output"`, `"every child
roots"`, `"every step child"` across `frontend/src`, `e2e/`, this change's `openspec/`). The code and
copy hits are clean — `BranchAffordance.tsx` now reads "Branch this step into a new lane…" / "for a
new lane" (visible in my screenshots), and the `stepTree.ts` / `evaluation-1.md` hits do quote the old
rule explicitly as repudiated. **But the sweep missed the strongest artifact class of all — see CRs
1–3.**

### Verdict: REFUTE

The engineering is sound and I would ship the code as-is. The layout defect is genuinely fixed and
now rendered-verified in two themes; the fixture edit is a real narrowing that I proved still fails
on the old markup; the mutation proof, the gates and the ACs all hold. What does not hold is the
**normative spec delta** — the artifact that archives into `openspec/specs/` as this capability's
source of truth. It still encodes the repudiated pre-reversal rule and contradicts the shipped code,
and `files-modified.md` records a sweep result it did not have. Round 1 corrected `design.md` and
`tasks.md` and stopped one file short of the one that actually binds future readers.

All four change requests below are **prose edits to `openspec/` documents. No code change is
requested.** Recommendation to the human: authorize these as a docs-only fix commit rather than a
third delivery round — the tree is otherwise merge-ready by my measurement.

### Change Requests

1. **`specs/pipeline-step-tree/spec.md:3-7` states the repudiated rule as a normative SHALL.**
   It reads "for each node, **every step child begins its own lane**" and "SHALL NOT treat a
   `position = 0` child as **structurally special beyond ordering**". The shipped
   `stepTree.ts:105-118` does exactly the opposite: the position-0 child is the lane's *continuation*
   and does not begin a lane (`stepTree.test.ts:48,88` pin this as the intended behaviour). Its
   scenario "**A node with three children yields three lanes**… the grouping reports three lanes
   *below* it, each rooted at one child" is false for a node whose children include a position-0
   child — that yields two lanes below it plus a continuation. Restate under the Decision 1 ruling
   (position-0 chain continues the lane; position ≥ 1 children each root a lane), and re-word or
   qualify the three-children scenario to match `stepTree.test.ts:102`'s antecedent (three
   *position ≥ 1* children). Left as written, the archived spec instructs a future ticket to
   "fix" the code back to the rule this run spent five design rounds repudiating.

2. **`specs/pipeline-lane-layout/spec.md`, scenario "Siblings occupy distinct adjacent lanes"**
   carries the same rule: "WHEN a node has three step children THEN **each child begins its own
   lane**…". `computeLaneLayout` derives columns from `buildLaneGraph`'s lanes, so a position-0 child
   shares its parent's column and does not begin a lane. (`laneLayout.test.ts:44-54` passes only
   because the parent's column happens to be 0 there, so the column set still comes out distinct and
   adjacent — the *column* claim survives that fixture, the "each child begins its own lane" claim
   does not.) Same correction.

3. **`files-modified.md`'s CR6 record claims evidence it does not have.** It states: "swept the tree
   by PROPERTY… No other site in the diff states the symmetric-lanes rule as fact." CRs 1 and 2 are
   both in the diff, both inside the swept `openspec/` area, and both state it as fact — in `SHALL`
   voice. This is the run's signature defect recurring inside the commit that was fixing the run's
   signature defect. Correct the record to what the sweep actually found.

4. **`specs/pipeline-lane-editor-ui/spec.md`, scenario "A lane is labelled"** — "WHEN two or more
   lanes render below a step THEN each lane carries a **visible**, stable label" — is unqualified by
   viewport, but `PipelineDetailPage.css:464-465` sets `.pipeline-detail-page__lane-header { display:
   none }` and only un-hides it at `:1568` inside the phone media query. My 1440px screenshots show
   **no lane label at desktop**. The ticket's own Scope only asks for a lane header "at phone
   widths", so the code is right and the spec over-claims: qualify the scenario to phone widths (or,
   if a desktop label is wanted, that is a new ticket, not this one).

### Non-blocking notes

- **Honest answer to "would anything catch a recurrence of the layout defect?"** Partly, and better
  than expected: `hel912-lanes-rejoin.spec.ts` **fails** against the pre-fix nesting (I proved it in
  check 2), because its helper walks to `.tail-chain-step`, which that nesting does not produce. So a
  *markup* regression is guarded. A purely **CSS-level** regression (e.g. someone gives
  `.tail-chain-step` `flex-direction: row`) would render identically badly and **nothing in the suite
  would catch it** — that gap is real and belongs in the PR body. I am deliberately not proposing a
  visual-regression harness.
- **e2e timing sensitivity, reproduced.** My own throwaway driver hit the same op-menu failure round 1
  saw ("element is not stable… detached from the DOM") until I added a settle after step creation.
  The shipped spec passed 2/2 for me today, but this is a genuine flake surface in the op dropdown,
  not purely cross-run contention. Worth a note in the PR body; not a defect in this change.
- Descendants remain enabled in the rejoin picker (only ancestors are disabled) — round 1's note
  stands; ticket Scope's "cycle-invalid lanes greyed with a reason" arguably covers them.
- Desktop polish: with two lanes the lane column group is left-aligned under a full-width trunk card,
  leaving a wide empty gutter on the right, and the "+ Add transformation step" row sits under lane
  1 rather than under the trunk. Consistent enough with the river's existing rhythm; not a blocker.
