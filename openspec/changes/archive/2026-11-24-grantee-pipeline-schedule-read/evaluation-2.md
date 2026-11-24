## Evaluation Report — Cycle 2 (evaluation-2.md)

Reviewed commit: 80bf27cb705334fb3c5ef7fc7fa756bdfdc509d8 (cycle-1 commit 31c192103 plus the fix commit). Base d4e59f006, resolved live.

### Phase 1: Spec Review — PASS
Issues: none.
- The fix commit touches only CR1 and the two non-blocking items from evaluation-1. There is no scope creep and no
  change to production backend code.
- The route spec loop now passes the grant role that each test's label names
  (`PipelineScheduleRoutesSpec.scala:336, 354`).
- `red-run-2.txt` is consistent with this review. The jest test went red because the modifier class was missing. The
  e2e went red with computed cursor `pointer`, which also confirms the cycle-1 reading in a live browser.

### Phase 2: Code Review — PASS
Gates (my own fresh runs, in WORKTREE_PATH, on the lane DB):
- `npm run lint` passed (exit 0), as did `npm run format:check` (exit 0) and
  `npm --prefix frontend run build` (exit 0).
- `npm test` (3 workers) passed with exit 0. The root run had 76 suites and 683 tests. The frontend run had 941
  suites and 10912 tests, 2 more than in cycle 1.
- Backend: the only backend change since my cycle-1 full `testFull` run (all 10 shards, 789 suites, green) is the
  test file `PipelineScheduleRoutesSpec.scala`. I re-ran it with `PipelineScheduleServiceSpec` via `testOnly`, and
  57 of 57 tests passed. Production backend code is byte-identical to the commit that passed the full suite.

CR1 is resolved:
- `SpineScheduleChip.tsx:59` adds `spine-header__chip--static` to the read-only span.
- `PipelineSpineHeader.css:209-211` gives the modifier `cursor: default`, and the desktop hover rule is scoped with
  `:not(.spine-header__chip--static)`.
- On phone, the override for the hover background comes after the base hover rule, with equal specificity. The
  override for the tap-target `::after` overlay also comes after its base rule, again with equal specificity.
- Every value comes from a token (`transparent`, `content: none`), so there is no new literal.
- The jest test asserts that the read-only chip carries the modifier and the button does not. It also asserts that
  the default is read-only.
- The e2e asserts computed cursor `default`, an `::after` overlay of none or normal, and an unchanged background on
  hover, on desktop and on phone.

### Phase 3: UI Review — PASS
I closed the cycle-1 gaps with my own scratch Playwright probe. It reuses the e2e fixtures (`registerAndLogin`,
`collaborator`, `seedSharedPipeline`), runs on port 7269 against the lane DB, and uses a paused schedule:
- **Breakpoints 1440, 1100, 768 and 390, light and dark, editor and viewer** (16 combinations), all checked from
  computed values:
  - the chip is a `span`, with cursor `default` and tabIndex -1;
  - it shows the "Paused" marker;
  - it lies inside the viewport, and `documentElement.scrollWidth` equals the viewport width, so there is no
    horizontal overflow;
  - there is no button whose name matches /schedule/.
  - The owner has an "Edit schedule" button at every width.
- **Console errors:** I listened for `console` error and `pageerror` on the owner, editor and viewer pages for the
  whole flow. There were 0.
- Repo e2e `hel1837-grantee-schedule-chip` and `hel1794-viewer-read-only` (2 workers): 6 passed. The registry
  teardown deleted the 18 throwaway users.
- Probe log with the per-width measurements:
  `/home/matt/Development/helio/.concertino/runs/HEL-1837/evidence/.concertino/scratch/HEL-1837/eval2-probe.txt`.
- Screenshots (scratch, outside the worktree):
  `/home/matt/Development/helio/.concertino/scratch/HEL-1837/eval2-probe/shots/`. For example,
  `editor-1100-dark.png` shows "Every… Paused" in the desktop header with no hover affordance, and
  `viewer-768-light.png` shows "Every 15m Paused" under "View only".

### Overall: PASS

### Change Requests
None.

### Non-blocking Suggestions
- None new.
