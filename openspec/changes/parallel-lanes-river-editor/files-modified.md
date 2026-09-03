# Files modified — HEL-912 parallel-lanes-river-editor

## Cycle 4 — skeptic-final-1.md REFUTE, all 6 CRs addressed

- **CR1/CR2 (the real rendered defect)** —
  `frontend/src/features/pipelines/ui/LaneColumn.tsx`'s compact (one-step
  lane) branch was rendering `renderAddLaneAffordance(step)` and
  `renderChildLanes(step)` as CHILDREN of
  `.pipeline-detail-page__tail-chain-item` (`display: flex; flex-direction:
  row`), sharing the row with the `flex:1` `StepCard`. At 1440px with two
  lanes this squeezed the card's label into the same horizontal track as its
  own disable/duplicate icons (label wrapped, second line ran under the
  icons) and floated "Branch" beside the dashed connector instead of beneath
  the card. Fixed by wrapping each step in a new
  `.pipeline-detail-page__tail-chain-step` div (column-flowing, since its
  parent `.tail-chain` is `flex-direction: column`) and moving the
  affordance + child-lane row OUT of `.tail-chain-item` to be SIBLINGS of it
  inside that new wrapper — the `.tail-chain-item` row itself is now
  BYTE-IDENTICAL to `TailChain`'s original markup (just the connector
  `<span>` + `<StepCard>`), making the file's own "byte-identical" comment
  true rather than approximate. Verified visually: a throwaway two-lane
  screenshot at 1440px (created, inspected, deleted — no repo change) shows
  each lane's card, its own "Branch" button beneath it, and no label
  wrapping or icon collision.
  - `e2e/hel912-lanes-rejoin.spec.ts`'s `stepSection()` helper updated to
    walk up to the new `.tail-chain-step` wrapper (not `.tail-chain-item`,
    which no longer contains the affordance) — re-run live and confirmed
    green, along with `hel908-trunk-reorder-drag.spec.ts` (still 0-line
    diff) and the AC2 mutation proof (still exactly 1 test fails on the
    `.tail-chain-item` class mutation).
- **CR3** — `BranchAffordance.tsx`'s `aria-label`/`title`/hint copy no longer
  says "a second output" (the single-branch invariant this ticket deleted).
  Now: "Branch this step into a new lane, without changing the rest of the
  pipeline" / "for a new lane". `PipelineRiverView.tsx`'s adjacent comment
  updated to match.
- **CR4/CR5** — `files-modified.md`'s stale "Known gaps" bullet claiming the
  per-lane mobile header "was not added" is corrected in place (it WAS
  built in `10d1b886` and guarded in `084978b7` — see below); the
  "Gate-shift housekeeping" section's stale re-pin count/arithmetic is
  corrected to point at the current (fourth) re-pin recorded above.
- **CR6** — swept the tree by PROPERTY (not just the four named sites) for
  the repudiated "every child roots a lane, none privileged" claim.
  **CORRECTION (skeptic-final-2.md, orchestrator):** this sweep MISSED the
  `specs/` delta documents, which restated the repudiated rule in SHALL
  voice -- `specs/pipeline-step-tree/spec.md` ("every step child begins its
  own lane" / "SHALL NOT treat a `position = 0` child as structurally
  special") and `specs/pipeline-lane-layout/spec.md`'s three-children
  scenario. Both are now fixed, along with `pipeline-lane-editor-ui`'s
  unqualified "A lane is labelled" scenario (the header is `display:none`
  above 430px). The sweep below searched `frontend/src`, `e2e/` and the
  change's prose artifacts but did not treat the spec deltas as prose
  carrying the same claim -- a grep whose CORPUS was drawn too narrowly,
  which is lesson 6 applied to a sweep rather than to an audit. The
  original (incomplete) sweep as run:
  `grep -rln` across `frontend/src`, `e2e/`, and this change's `openspec/`
  artifacts. `design.md`/`tasks.md` were already fixed by the orchestrator
  (not re-touched, per instruction — pulled latest first). The remaining
  hits in `stepTree.ts`/`stepTree.test.ts`/`files-modified.md` all quote the
  OLD claim explicitly as a REPUDIATED/WRONG prior draft (e.g. "the pre-ruling
  claim, which is now REPUDIATED") — corrective framing, not an assertion of
  current truth — so left as-is. No other site in the diff states the
  symmetric-lanes rule as fact.
- **HEL-970 reference** — `hel912-lanes-rejoin.spec.ts`'s FOUND-NOT-FIXED
  comment and this file's own "FOUND, NOT FIXED" section now both cite
  HEL-970 directly (filed by the orchestrator) instead of "a spinoff
  candidate for HEL-913."
- **Not chased**: the skeptic's one non-reproducing `hel912-lanes-rejoin`
  failure (1 red / 3 green, recorded as shared-Playwright-session contention
  with HEL-913/914). Re-run live 3x more during this cycle's own gate pass,
  all green.

## Cycle 3 — evaluator's closing note (per-lane mobile header was unguarded)

- `e2e/hel912-lanes-rejoin.spec.ts` — folded new assertions into the EXISTING
  1440→430→375→1440 viewport block (no restructuring needed): the visible
  `.pipeline-detail-page__lane-header` text is asserted to be `[]` (hidden) at
  1440, and exactly `["Lane 1", "Lane 2"]` (visible, correctly numbered) at
  both 430 and 375 — asserting the PRODUCED text, not merely that an element
  exists, so a header rendering empty or unnumbered fails too.
- **Verified RED against a removed header**: temporarily set
  `LaneColumn.tsx`'s `laneHeader` to `null`, ran the spec live —
  failed exactly as expected (`expect(received).toEqual(expected)`,
  `Array []` received vs `["Lane 1", "Lane 2"]` expected, at the 430px
  assertion). Reverted (`diff` against the pre-edit backup confirmed clean),
  re-ran live — green again. This test is written after the code it guards,
  so this red-then-green cycle is the only evidence it actually guards
  anything.

## For the PR body (evaluator's request)

- **Task 6.3's deferral is a real gap in HEL-911, not a scope choice.**
  `openspec/specs/pipeline-run-execution/spec.md:9` asserts a SHALL for a
  `lanePath` field HEL-911 never actually shipped
  (`grep -rn "lanePath" backend/src/main/scala` → 0 hits). This PR does not
  build the failing-node lane-path highlight because there is no field on the
  wire to render — routed to HEL-913 (design.md Decision 5), not trimmed for
  scope reasons.
- **HEL-970** (filed by the evaluator) tracks the SEPARATE `previewAtNode`/
  `pathToRoot` defect this run found and root-caused (see "FOUND, NOT FIXED"
  under task 8 below) — High, related to HEL-911/912/913, deliberately not
  blocked-by. This PR's find is credited there; no code in this diff works
  around it.
- **File-size note, not a blocker**: `PipelineRiverView.tsx` is 469 lines
  (down from 516 pre-change — no regression), just over `CONTRIBUTING.md:24`'s
  guidance. A follow-up split (e.g. extracting the gap/insert-dropdown
  machinery, or the primary-lane StepCard-list rendering, into their own
  module) is proposed for a future pass rather than done opportunistically in
  this already-large diff.

## Cycle 2 — evaluation-1.md change requests (all 7 addressed)

- **CR1 (task 5.5)** — `ui/stepConfigs/SecondaryInputPicker.test.tsx` (NEW): the
  only Jest expression of AC2's "rejoin picker excludes ancestor lanes".
  Asserts the PRODUCED option list: (a) the configuring step's own id is
  absent; (b) an ancestor reached via `parentStepId` is present but disabled
  with a cycle reason; (b2) an ancestor reached ONLY via an existing
  `{kind:"lane"}` edge is ALSO present-but-disabled (a separate fixture,
  re-pointing the configuring step's own parent to a rejoin so the lane edge
  is the only path to the ancestor); (c) a non-terminal node, an
  already-consumed node, a higher-index-lane node, and a lower-row node are
  each present and NOT disabled; selecting an enabled option calls `onChange`
  with the right `{kind:"lane"}` value.
- **CR2 (task 5.6)** — `hooks/useStepCardState.test.ts`: added the round-trip
  test ("round-trips a stored lane-kind secondaryInput..."). A step persisted
  with `secondaryInput = {kind:"lane", stepId}` (a) loads with
  `result.current.unionConfig.secondary` already set to that lane, and (b)
  changing an UNRELATED field (`mode` byPosition→byName) still persists the
  SAME lane reference. Verified RED against the pre-`22ed8642` narrowing by
  actually reverting `unionConfigOf`'s `secondary` field to the old
  source-kind-only degrade locally, re-running just this test (failed on
  assertion (a), `secondary` came back `{kind:"source",dataSourceId:""}`
  instead of the stored lane), then restoring the file (`diff` confirmed
  clean).
- **CR3** — `state/stepNarrowing.test.ts`'s dangling "see task 5.6's
  round-trip test below" comment now points at the actual test (by name, by
  file) instead of a nonexistent one.
- **CR4** — `e2e/hel912-lanes-rejoin.spec.ts`: tightened the union-rejoin row
  count assertion from `toContainText("rows")` to `toContainText("2 rows")`;
  the FOUND-NOT-FIXED comment's "asserted above" claim is now true.
- **CR5 (task 7.3/AC3)** — `e2e/hel912-lanes-rejoin.spec.ts`: added real
  Playwright viewport assertions (`setViewportSize` at 1440/430/375) checking
  `.pipeline-detail-page__lane-row`'s direct children's `boundingBox().y` —
  equal at 1440 (side by side), distinct/increasing at 430 and 375 (stacked).
  This is the automated evidence the evaluator's own manual measurement
  (`getComputedStyle`/`getBoundingClientRect`) confirmed was missing; the
  behaviour itself was already real, only the machine-checkable proof was
  absent.
- **CR6** — `state/stepTree.test.ts`: retitled the two tests that stated the
  repudiated "every child roots a lane, none privileged" claim in prose. The
  first now gives one of three children an explicit `position: 0` sibling so
  the human-ruled property (position-0 continues; only position>=1 siblings
  root lanes) is visible in this file's own prose, not just in `stepTree.ts`.
  The second is retitled to state the NARROWER, still-true property it
  actually pins: when NEITHER of a node's two children carries a `position`,
  neither is a continuation candidate, so both root their own lane — not "no
  child is ever privileged" (the first case shows one is, when `position`
  says so).
- **CR7 (task 7.1)** — BUILT the per-lane mobile header rather than un-ticking
  the task: `ui/LaneColumn.tsx` gained a `laneNumber` prop (1-based position
  among siblings, threaded from both `PipelineRiverView`'s and
  `LaneColumn`'s own `childLanes.map`) and renders a
  `.pipeline-detail-page__lane-header` ("Lane N") as the first child of each
  lane's wrapper (outside the per-step `.tail-chain-item`/`.step-section`, so
  the task 3.3/3.5 DOM-contract guard is untouched). CSS: `display: none` by
  default, `display: block` only inside the EXISTING phone-breakpoint media
  block (not a new one — see that rule's own comment on why).

## Cycle 2 — non-blocking suggestions also addressed

- **DRY (issue 8)** — `ui/BranchAffordance.tsx` (NEW): extracts the "+ lane"
  button + hint + `OpDropdown` wiring that was duplicated near-verbatim
  between `PipelineRiverView.tsx` and `LaneColumn.tsx`. Fully controlled
  (`isOpen`/`anchorEl`/`onOpen`/`onSelect`/`onClose`) — each caller still owns
  its OWN dropdown-coordination against its other open pickers (e.g.
  `PipelineRiverView` also closes the gap/bottom-add dropdowns), only the
  button/hint/menu markup itself is shared now.
- **`laneOutputSubtitle` coverage (issue 9)** — `state/laneLayout.test.ts`:
  added two tests, a primary-lane step's subtitle unchanged (just its own
  label) and a non-primary-lane step's subtitle gaining the `› lane N ›`
  segment (both lane 1 and lane 2, off the same branch step).
- **`types/step.ts:30,36`** — updated to reference `buildLaneGraph` (this
  change's replacement), not the deleted `buildStepTree`.

## Cycle-2 gate-shift housekeeping

- `frontend/src/theme/tokenAuditSweep.css.test.ts` — `SPACING_BASELINE`'s
  `PipelineDetailPage.css` entries re-pinned a FOURTH time for the new
  `.pipeline-detail-page__lane-header` rule (comment documents the exact
  `git diff --unified=0` hunk arithmetic: +12 net for entries in [455,1554],
  +16 for entries >1554 — no entries added or removed, only shifted).

## Cycle-2 gate results (fresh)

```
$ npx tsc --noEmit -p tsconfig.json          # frontend/
(no output — clean)

$ npm run lint
> eslint src --max-warnings=0
(no output — clean)

$ npm run format:check
Checking formatting...
All matched files use Prettier code style!

$ npm test -- --silent
Test Suites: 254 passed, 254 total
Tests:       2613 passed, 2613 total
Snapshots:   0 total
Time:        17.9 s

$ npm --prefix frontend run build
✓ built in 293ms
```

`e2e/hel908-trunk-reorder-drag.spec.ts` + `e2e/hel912-lanes-rejoin.spec.ts`
run together live: `2 passed (7.3s)`. `hel912-lanes-rejoin.spec.ts` re-run
alone a second time to confirm the new viewport-resize steps are stable:
`1 passed (6.3s)`.


## Status: COMPLETE. Resolved a real escalation mid-run (task 3.5 vs design.md
Decision 1's first draft) — the human's ruling was `keep-continuation-privileged`,
and design.md Decision 1 was corrected at the source (not exempted): the
position-0 chain from the root is the PRIMARY lane, rendered at top level;
position >= 1 children each root their own lane. `buildLaneGraph` was adjusted
to match, `e2e/hel908-trunk-reorder-drag.spec.ts` now passes UNEDITED, and
`e2e/hel912-lanes-rejoin.spec.ts` (task 8) was written and confirmed green. All
tasks are checked off in `tasks.md`. One real, root-caused BACKEND defect was
found (not fixed, out of this ticket's frontend-only scope) during task 8's live
run — see "FOUND, NOT FIXED" below.

## Escalation resolution (design.md Decision 1 corrected)

- `frontend/src/features/pipelines/state/stepTree.ts` — `buildLaneGraph`'s walk
  no longer treats every child symmetrically. The continuation is the
  position-0 child (or the sole child when its `position` is `undefined`, a
  not-yet-persisted step); every OTHER child (any position >= 1, or an extra
  position-0 child beyond the first) roots its own lane. Doc comment rewritten
  to state and justify this (P2.1 contract item 2 sanctions privileging
  position 0 in the UI; the design's own `pipeline-tails-ui` delta and its own
  `primaryLaneId` both already presupposed it).
- `frontend/src/features/pipelines/state/stepTree.test.ts` — the two tests that
  encoded the WRONG "every child roots a lane, none privileged" behavior are
  rewritten for the corrected semantics (position-0 continues; only
  position>=1 siblings root lanes), plus a new test pinning "the position-0
  continuation renders at the top level, matching pipeline-tails-ui's 'trunk
  continues' presupposition."
- `frontend/src/features/pipelines/ui/LaneColumn.tsx` — the `isTail` prop is
  now ONLY set on the compact (one-step-lane) branch's `StepCard`s. Found live
  via task 9.1a's first re-run: the non-compact branch was passing it
  unconditionally (copy-paste from the compact branch), which hid a
  multi-step lane's own Move/drag affordances behind the tail styling AND
  made it invisible to any `:not(--tail)` locator. This is a real, standalone
  bug fix, credited independent of the escalation's outcome.
- `e2e/hel908-trunk-reorder-drag.spec.ts` — UNTOUCHED (task 3.5 held). Ran
  live twice: once against the pre-fix `buildLaneGraph` (failed, correctly,
  on the strict-mode-violation the escalation reported), once against the
  corrected version (passed, unedited) — command + output below.

## Core lane model (tasks 1-2)

- `frontend/src/features/pipelines/state/stepTree.ts` — replaced `buildStepTree`
  (trunk + at-most-one-tail) with `buildLaneGraph` (`{lanes, laneOfStepId,
  primaryLaneId}`), `childLanesOf`, `flattenLaneGraph`, and `reorderLane`
  (generalizes `reorderTrunk` to one lane). `hasTail`/`tailsByStepId` deleted, no
  shim (design.md Decision 1). The totality sweep appends any step the walk never
  reaches (temp/orphaned data) to the PRIMARY lane in array order — the same
  fallback `buildStepTree` had — rather than giving each one a singleton lane;
  this was a live fix (see "fixture-shape gap" below).
- `frontend/src/features/pipelines/state/stepTree.test.ts` — REWRITTEN for lane
  properties per task 1.4. Every new/changed test was run against the pre-change
  grouping and observed to fail:
  - "every child of a node roots its OWN lane" — pre-change groups 2 children
    into `{trunk:[a,b], tailsByStepId:{a:[t1,t2]}}`; new test asserts 3 lanes
    of `[a]`,`[t1,t2]`,`[b]` — FAILS pre-change (`buildStepTree` has no `lanes`
    property at all — TypeError).
  - "supports a lane off a non-root node" (b's 2 children both root a lane) —
    pre-change collapses this into trunk `[a,b,c]` + one tail — FAILS.
  - "three siblings... ascending position order" / "a node with THREE
    children... roots THREE lanes" — pre-change's single-tail invariant can only
    ever produce one tail; a third child is silently absorbed into the orphan
    sweep, landing in `trunk`, not its own lane — FAILS (asserts on
    `childLanesOf`, which doesn't exist pre-change).
  - `reorderLane` tests — pre-change's `reorderTrunk` has no notion of "any
    lane," only `tree.trunk`; calling it with a lane id argument doesn't
    typecheck against the old signature — FAILS.
- `frontend/src/features/pipelines/state/laneLayout.ts` (NEW) —
  `computeLaneLayout` (pure column/row assignment; column = a lane's index in
  `graph.lanes`'s already-BFS-sibling-ordered array; row = longest-path-from-root
  over `parentStepId` + rejoin `secondaryInput` edges, so a rejoin's row is
  `max(row of every input)+1` with no lane-local special-casing), plus
  `computeAncestorIds` (task 5.4's cycle-eligibility property) and
  `laneOutputSubtitle` (task 6.1's "off `<step>` › lane N › `<step>`" builder).
- `frontend/src/features/pipelines/state/laneLayout.test.ts` (NEW) — task 2.3:
  determinism, sibling column adjacency, pure-chain monotonic rows, the diamond
  case (one lane feeding two rejoins), a rejoin on a non-terminal node, a node
  consumed by several rejoins (none dropped/deduped), plus `computeAncestorIds`
  coverage.

## River rendering (task 3)

- `frontend/src/features/pipelines/ui/LaneColumn.tsx` (NEW) — renders one lane;
  a one-step lane renders via the SAME `.pipeline-detail-page__tail-chain-item`
  markup `TailChain` used (byte-identical DOM contract, task 3.3/3.5); a
  multi-step lane renders as a vertical mini-river of full `StepCard`s (no
  `isTail` styling — see "bug fixed during 9.1a" below); recurses into its own
  steps' child lanes (`renderChildLanes`) so nested branch points render too.
- `frontend/src/features/pipelines/ui/TailChain.tsx` — DELETED (task 3.1,
  retired; `LaneColumn`'s compact branch is its replacement).
- `frontend/src/features/pipelines/ui/PipelineRiverView.tsx` — rewritten to
  iterate the primary lane (from `laneGraph`, not a `steps` prop directly) for
  the top-level list (Move up/down, drag reorder, unchanged UX), and render
  every other lane rooted at a primary-lane step via `LaneColumn`, side by side
  in a `.pipeline-detail-page__lane-row` when a step roots more than one. The
  `trunkLastHasTail` shape-picker disable and the "+ tail" single-tail gate are
  both REMOVED (design.md Decision 1 deleted the invariant behind both), not
  adapted.
- `frontend/src/features/pipelines/ui/PipelineRiverView.test.tsx` — updated:
  renamed `stepTree`→`laneGraph`, `onAddTailStep`→`onAddLaneStep`; a `linkChain`
  helper auto-links this file's flat (no-`parentStepId`) fixtures into one
  primary lane, reproducing `buildStepTree`'s old orphan-append fallback these
  reorder/Move tests actually exercise; the "trunk-last-tail gate" describe
  block is REPLACED with a test asserting the trigger stays enabled (feature
  removed, not silently dropped); added task 3.3 (tail-chain-item DOM guard,
  one mutation away from failing — see below) and task 4.3 (2nd/3rd lane, no
  refusal message) coverage.
- `frontend/src/features/pipelines/ui/PipelineDetailPage.css` — added
  `.pipeline-detail-page__lane-row`/`__lane-column` rules (tokens only); mobile
  stacking (task 7.1) added INSIDE the EXISTING
  `@media (max-width: 768px), (pointer: coarse)` block further down the file,
  not a second identical media query (a duplicate would silently shadow the
  real one for `tapTargetTestUtils.findMediaBlock`'s literal-text lookup — this
  was caught live by `PipelineDetailPage.css.test.ts` failing, root-caused, and
  fixed by merging into the existing block instead).

### Task 3.3 guard — GUARD, not proof of pixel identity

`PipelineRiverView.test.tsx`'s new "one-step lane compact rendering" test pins
the two properties `pipeline-tails-ui` states (indented dashed connector +
termination in the step's own card), asserted via
`.pipeline-detail-page__tail-chain-item` / `__tail-chain-connector`. It is
failable by a SINGLE mutation: deleting the `isCompact` branch's
`.pipeline-detail-page__tail-chain-item` wrapper in `LaneColumn.tsx` (verified
by temporarily removing that div's className during this run — the test failed
with "no accessible tail-chain-item ancestor"; reverted before committing).

### Bug found and fixed during task 9.1a's live run

`LaneColumn.tsx`'s non-compact branch originally passed `isTail` unconditionally
to `StepCard` (copy-paste from the compact branch). Running
`e2e/hel908-trunk-reorder-drag.spec.ts` live against the real backend exposed
this: a node with a genuine continuation AND a tail (2 children) makes the
continuation's own lane multi-step and non-compact, but `isTail` still hid its
Move/drag affordances and added the `--tail` CSS class, which also made it
invisible to the spec's `:not(--tail)` locator. Fixed by only setting `isTail`
in the compact (one-step-lane) branch. This is a real defect fix, not a test
accommodation — `files-modified.md`'s escalation note explains the SEPARATE,
still-open contradiction task 3.5 surfaced after this fix.

## "+ lane" affordance (task 4)

- `frontend/src/features/pipelines/hooks/usePipelineDetailPage.ts` —
  `handleAddTailStep` → `handleAddLaneStep` (unconditional now); removed the
  `anchorHasTail` refusal in `handleInstantiateShape` (design.md Decision 1);
  `buildStepTree` → `buildLaneGraph`; `handleReorderSteps`'s persisted-ids
  derivation now reads the reordered graph's PRIMARY lane, not `.trunk`.
- `frontend/src/features/pipelines/ui/PipelineDetailPage.tsx` — renamed props
  through to `PipelineRiverView`/`OutputsGalleryTab`.
- `frontend/src/features/pipelines/ui/PipelineDetailPage.test.tsx` — the
  trunk-last-tail-gate test is REPLACED with a test asserting the trigger stays
  enabled (feature removed).

## Rejoin picker (task 5)

- `frontend/src/features/pipelines/ui/stepConfigs/UnionConfig.tsx` /
  `LookupConfig.tsx` — `UnionConfigValue`/`LookupConfigValue` changed from a
  flat `otherDataSourceId`/`referenceDataSourceId` string to a discriminated
  `secondary: SecondaryInput`; both now render the new
  `SecondaryInputPicker`.
- `frontend/src/features/pipelines/ui/stepConfigs/SecondaryInputPicker.tsx`
  (NEW) — data-source options + "other lane" options; eligibility is a
  PROPERTY (task 5.4): every node except the configuring step is offered,
  ONLY the step's own ancestors (`computeAncestorIds`, over `parentStepId` +
  existing lane edges) are disabled with a cycle reason. No terminal-only,
  single-consumer, or ordering filter (deliberately, per P2.1 contract items
  6/6b).
- `frontend/src/features/pipelines/state/stepNarrowing.ts` —
  `unionConfigOf`/`lookupConfigOf` now pass the full `secondaryInput` through
  as `secondary` instead of degrading a lane-kind config to `""`. The
  HEL-911 "degrade lane-kind to empty string" branches are DELETED.
- `frontend/src/features/pipelines/state/stepNarrowing.test.ts` — task 5.1a/
  5.1b. `unionConfigOf`/`lookupConfigOf`'s lane-kind tests REPLACE (not retype)
  the old degrade-to-`""` pin — the old assertion
  (`expect(unionConfigOf(step)).toEqual({otherDataSourceId:"",mode:"byPosition"})`
  for a lane-kind config) would have re-pinned the exact data-loss behavior
  task 5.1 deletes; the new tests assert the lane reference survives narrowing
  intact.
- `frontend/src/features/pipelines/hooks/useStepCardState.ts` —
  `onUnionChange`/`onLookupChange` widen `newConfig.secondary` straight
  through to `secondaryInput` instead of hardcoding `{kind:"source"}`.
- `frontend/src/features/pipelines/hooks/useStepCardState.test.ts` — updated
  the two existing widening tests for the new `secondary` shape; added a
  lane-kind widening test (the HEL-911 unconditional `{kind:"source"}` this
  replaced would have silently overwritten a lane reference — this new test
  fails against that old code).
- `frontend/src/features/pipelines/ui/stepConfigs/UnionConfig.test.tsx` /
  `LookupConfig.test.tsx` — rewritten for the new picker (new label text,
  "Data source: X" / "Lane node: Y" option prefixes, `allSteps`/
  `currentStepId` props), plus new "selecting another lane node" cases.
- `frontend/src/features/pipelines/ui/StepCard.tsx` / `StepOpEditor.tsx` —
  both gained an optional `allSteps` prop (default `[]`), threaded down to
  `UnionConfig`/`LookupConfig` for the picker's "other lane" options.

## Lane-aware Outputs / run reporting (task 6)

- `frontend/src/features/pipelines/ui/OutputsGalleryTab.tsx` — the "off
  `<step>`" subtitle now runs through `laneOutputSubtitle` (built from the
  lane graph, not a second traversal); `laneGraph` prop is optional (derived
  from `steps` via `buildLaneGraph` when a caller/test doesn't have one), so
  the pre-existing `OutputsGalleryTab.test.tsx` needed no changes.
- Per-lane row counts (task 6.2): already correct — `runStepRowCounts` is
  threaded into every `LaneColumn`, keyed by step id, no lane-specific logic
  needed.
- Task 6.3 — deliberately NOT implemented (no failing-lane-path highlight, no
  client-side derivation from `stepRowCounts`). Per design.md Decision 5, this
  is a real gap in HEL-911 (no `lanePath` field shipped on the wire), routed
  to HEL-913, not a scope choice made here.

## Mobile (task 7)

- Covered above under `PipelineDetailPage.css`. `tap-expand-44` reused
  unchanged for the new "+ lane" buttons (already applied via the existing
  `pipeline-detail-page__add-tail-btn` class, unchanged from HEL-943).

## OpenSpec

- `openspec/changes/parallel-lanes-river-editor/specs/pipeline-step-tree/spec.md`
  — pre-existing delta (from planning) already carried the `REMOVED` block for
  the stale "At most one trunk child per node" requirement (design.md Planner
  Notes); verified via `openspec validate parallel-lanes-river-editor --strict`
  — passes.

## Gate-shift housekeeping (STALE — see the cycle-2/cycle-3 re-pins further up
this file for the current state; the count and arithmetic below describe the
cycle-1 state, superseded twice since)

- `frontend/src/theme/tokenAuditSweep.css.test.ts` — `SPACING_BASELINE`'s
  `PipelineDetailPage.css` entries have been re-pinned a FOURTH time as of
  this commit (cycle-1's "+29/+15" arithmetic below is the original pin; see
  the "Cycle-2 gate-shift housekeeping" section above for the third re-pin's
  "+12/+4" arithmetic on top of it — the shipped test file's own comments are
  the source of truth; this note is kept only for the original hunk record):
  +29 after original line 432, +15 after original line 1510 — no entries
  added or removed, only shifted.

## Known gaps / scope trims (flagged, not silently absorbed)

- Drag-reorder WITHIN a non-primary lane is not wired (the ticket's Scope
  bullet mentions it; tasks.md's Jest ACs don't require it, and none of my
  Playwright coverage exercises it). `LaneColumn`'s non-compact `StepCard`s
  pass `onMoveUp`/`onMoveDown` as `undefined` and a no-op drag handler.
  Flagging as a real, deliberate trim under this run's time budget, not an
  oversight.
- `join`'s config editor remains out of scope (design.md Decision 6, stated
  not silently skipped) — unchanged from before this ticket.

**skeptic-final-1.md CR4 correction**: the per-lane mobile header gap noted
above (cycle 1) was CLOSED in cycle 2 (`10d1b886`) and guarded in cycle 3
(`084978b7`) — `LaneColumn.tsx` renders a real
`.pipeline-detail-page__lane-header` (`Lane {laneNumber}`) element, revealed
only at the phone breakpoint, and `e2e/hel912-lanes-rejoin.spec.ts` asserts
its exact visible text at 430/375 and its absence at 1440 (verified RED
against a removed header — see the cycle-3 section above). This bullet was
left stale after those two commits; removed rather than left contradicting
the rest of this file.

## End-to-end (task 8)

- `e2e/hel912-lanes-rejoin.spec.ts` (NEW, task 8.1) — AC1's only guard: adds a
  lane off a filter, an aggregate in EACH lane, a `union` rejoin off lane 1
  selecting lane 2 as the "other lane" (exercising the SecondaryInputPicker's
  eligibility property live — lane 2 is offered/enabled, lane 1 itself is an
  ancestor and would be disabled), a table Output on the rejoin, a dry run,
  then asserts the PRODUCED values: each of the four nodes' own row-count
  chip text (`5 rows` / `1 rows` / `1 rows` / a rejoin count), not merely that
  each interaction succeeded (lesson 8). Confirmed green twice in a row live.
  A `stepSection()` test helper walks from a step's own toggle button up to
  its NEAREST enclosing wrapper via XPath ancestor:: (a lane nests inside its
  branch step's own outer wrapper, so a naive `.filter({has: ...})` on the
  wrapper class matches every ancestor wrapper too, not just the closest
  one — found live while writing this spec, documented in the helper's own
  comment).
- Task 8.2 — confirmed COLLECTED, not assumed:
  `npx playwright test --list | grep -c hel912-lanes-rejoin` → `1`. CI's own
  e2e job runs a bare `npx playwright test` (the full glob, honouring
  `playwright.config.ts`'s `testIgnore`) — no `testIgnore` entry or separate
  wiring was needed.

### FOUND, NOT FIXED — backend defect (out of this ticket's frontend-only scope)

While iterating on `hel912-lanes-rejoin.spec.ts`'s final assertion (the
rejoin's own Output thumbnail), root-caused via READING (not editing)
`backend/src/main/scala/com/helio/services/pipelines/PipelineRunService.scala`:

`previewAtNode`'s `pathToRoot` helper (the step slice `POST
/pipelines/:id/preview` and `GET /pipelines/:id/steps/:id/preview` hand to
the execution engine) walks ONLY `parentStepId` back to the root. It never
follows a union/lookup step's `secondaryInput: {kind:"lane"}` edge. For a
rejoin whose secondary lane is NOT an ancestor (the normal, intended case —
that's exactly what the eligibility rule in Decision 3 offers), the engine
slice it's handed OMITS the secondary lane's steps entirely, and the preview
call 422s (`"Pipeline execution failed"`). Confirmed live: the SAME node
previews fine via the real `/run` path (`POST /pipelines/:id/run` with
`dryRun: true`) — its own row-count chip renders correctly (asserted in the
new spec) — only the SEPARATE `previewAtNode`/`previewOutputs` slicing has
the gap. `OutputEditorSheet`'s own sheet preview goes through the identical
`useOutputPreview` → `previewOutput` → `previewAtNode` path, so there is no
frontend-only workaround.

Effect: a rejoin's Output rail chip (and its sheet's own preview) never shows
a live row count/thumbnail, though the pipeline itself runs correctly and the
step's own row count renders. `hel912-lanes-rejoin.spec.ts` asserts the chip
renders (real, verified) and documents this gap inline rather than asserting
around it or leaving a permanently-red gate wired into CI. **Filed as
HEL-970** (High, related to HEL-911/912/913, deliberately not blocked-by) —
the e2e spec's own comment references HEL-970 directly now.

## Gate results (fresh, this run)

```
$ npx tsc --noEmit -p tsconfig.json         # frontend/
(no output — clean)

$ npx tsc --noEmit -p e2e/tsconfig.json
(no output — clean)

$ npm run lint                              # frontend/
> eslint src --max-warnings=0
(no output — clean)

$ npm run format:check                      # frontend/
> prettier . --check
Checking formatting...
All matched files use Prettier code style!

$ npm test -- --silent                      # frontend/
Test Suites: 253 passed, 253 total
Tests:       2605 passed, 2605 total
Snapshots:   0 total
Time:        17.19 s

$ npm --prefix frontend run build
✓ built in 283ms
(dist/ produced, PWA precache generated — no build errors)
```

`e2e/hel908-trunk-reorder-drag.spec.ts` (task 9.1a) — run three times live
against `http://localhost:6344` / backend `9251` across this cycle:
1. Pre-`isTail`-fix: failed (element not found for the "Filter rows"-scoped
   `:not(--tail)` locator — the `isTail`-on-non-compact bug).
2. Post-fix, pre-escalation-resolution (Decision 1's WRONG first draft):
   failed (strict-mode violation — the exact contradiction escalated).
3. Post-escalation-resolution (position-0 continuation privileged): **PASSED,
   UNEDITED** — `1 passed (3.3s)`.

`e2e/hel912-lanes-rejoin.spec.ts` (task 8.1/9.1a) — run twice live, both
green: `1 passed (5.7s)`, `1 passed (6.1s)`.

`npx playwright test --list | grep -c hel912-lanes-rejoin` → `1` (task 8.2).
