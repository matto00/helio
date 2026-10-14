## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed the uncommitted planning artifacts in `openspec/changes/processed-width-wait-grid-split/` (ticket.md,
proposal.md, design.md, tasks.md, .openspec.yaml `skip_specs: true`, workflow-state.md). The worktree is at HEAD
9c569fc6074d1d2296ad1a1f5fc91ee6b580a564 (origin/main 9c569fc60), and the change dir is the only untracked path.

### What I verified (with evidence)

- **Spawn-cwd guard:** `assert-cwd.sh` returned `READY ambient=/home/matt/Development/helio branch=task/processed-width-wait-grid-split/HEL-1418`.
- **DesktopPanelGrid.tsx size and concern map:** `wc -l` returns 436. I read the full file. Every line range in
  design.md "Context" matches:
  - title edit: 106-115 and 196-247
  - detail/confirm: 99-105, 116, 134-161 and 249-274
  - commit flag and interaction: 165-185, 276-312 and 331-370
  - processed width: 314-329
  - render: 372-435
- **Effect order claim (D4):** confirmed. The declared order is:
  1. editingTitleRef sync (l.113)
  2. HEL-651 auto-close (l.142)
  3. commit-flag cleanup (l.185)
  4. `useLayoutSave` (l.187)

  `useLayoutSave`'s unmount flush is `useEffect(() => () => persistLayoutRef.current(), [])` (useLayoutSave.ts:332).
  It does not read the commit flag, so keeping the order is conservative but correct. `markLayoutChanged` uses
  `[dispatch]` deps and `commitInteractionLayout` uses `[]` deps (useLayoutSave.ts:334-351), so both are stable.
  `latestLayoutRef` is a ref.
- **I1 / rebase-on-409:** these live entirely in `useLayoutSave.ts`. The I1 statement is in its header at l.49-60. The
  plan leaves that file and `dashboardsSlice.ts` untouched (C2, D5, task 3.3). Sound.
- **Tests that pin structure:** 16 test files reference DesktopPanelGrid. Their `jest.mock` targets are module paths
  (`react-grid-layout`, `react-grid-layout/core`, `../../hooks/usePanelData`, ...), so moving code into sibling hook
  files keeps the mocks effective. I found no test that reads `DesktopPanelGrid.tsx` source text.
- **Inline processed-width reads:** `grep -rln panel-grid-processed-width e2e` finds exactly hel1023 and
  hel1392-remount-request-burst, as the design says.
  - hel1023 `settledRects` (l.249-277) waits for an exact `${containerWidth}px`.
  - hel1392-burst `crossTo` (l.57-84) uses `/^\d+px$/`.
- **setViewportSize sites:** 31 spec files. The design's live-resize list is explicitly "not trusted as given". Task
  1.1 re-derives it over all of `e2e/`, which is the right scope. I spot-checked these as pre-load (`setViewportSize`
  before `goto`): hel1028, hel1230, hel1457, hel1260 and hel1444. hel588 l.344 (measures the indicator only),
  hel1398 l.411/427 (phone only) and hel1392-remount-staleness `setViewport` (gates on item count and sleeps) are live
  resizes, and D2 handles each of them.
- **D3 red-probe expectation:** `crossTo` always crosses phone (1000 px window, container below 768) ↔ desktop (1400).
  On a desktop cross, `DesktopPanelGrid` mounts fresh with `useState(width)` (l.324), using the width that triggered
  the mount. So the old regex wait most likely cannot match a stale pre-resize value. D3 already allows for
  "no red obtained, say so", which is honest. That outcome is consistent with C1 ("pure refactor needs only
  same-result evidence").
- **Archived HEL-1413 evidence nits:**
  - evidence.md l.74 says "305 users created ... 15:30:39 to 16:22:40". `dev-db-residue.txt` has 305 rows, and its
    newest row is `16:04:07.588553-07`. The nit is confirmed.
  - The text "bad=4/8" appears at evidence.md l.18 (item 1, the CI trace), l.24 (item 2, passing-run probe reads) and
    l.28 (item 3, the delayed-RO probe output).
  - The source of the "all 8 at lg geometry" nit is the archived `skeptic-final-1.md` l.10-15 and l.115. That
    analysis is of the CI trace, so item 1 only.
- **Hooks gate:** `.husky/pre-commit` runs `check:openspec` and `check:e2e-types` among others. The risk register's
  "run the hook; if it objects, escalate" is adequate for the archive edit.
- **Scope:** no backend or backend-test-infra work is planned (HEL-1544 is respected). All three ticket items are
  covered, and I found no scope drift. No API or schema contract is touched, so `skip_specs: true` is justified.

### Verdict: REFUTE

The plan is close. Five ambiguities let a competent executor take two readings, and on AC2, AC3 and AC5 one of
those readings fails the AC or asserts something nobody observed.

### Change Requests

1. **Decide what happens to hel1023's own CSS-box width gate.**
   - **The problem:** `hel1023-breakpoint-layout-derivation.spec.ts` l.255-257 polls
     `readRects(page).container.w` until it equals `containerWidth`. That is the `.panel-grid` (or
     `.mobile-panel-stack`) box width, the very pattern AC2 requires to be gone "outside the helper". D1 lifts only
     the processed-width/count-0/settle part into `waitForGridWidth` and calls hel1023's migration "a pure
     refactor", which implies the box poll stays inline. Task 2.5's grep proof would then either flag it or have to
     silently exempt it.
   - **Required:** state in design.md (D1 or D2) which of these applies:
     - (a) The box poll stays in hel1023 as an *assertion* of the expected container width, not a gate, and is a
       named exemption in the AC2 grep proof.
     - (b) The box poll moves into the helper, ordered before the processed-width wait. Then hel1023 is still a pure
       refactor, but every other caller gains that assertion.
     - (c) The box poll is removed. Then hel1023 is a semantic change, and C1 requires a red.
   - Note that below 768 that poll is currently the stack-width check.
2. **Give task 2.5 concrete grep commands and an exemption list.** As written, "no `.panel-grid` box-width gate
   outside the helper" has no acceptance signal.
   - **Required:** name the exact patterns, for example:
     - `grep -rn -- '--panel-grid-processed-width' e2e | grep -v e2e/support/gridProcessedWidth.ts`
     - a pattern for `.panel-grid` `boundingBox()` / `getBoundingClientRect` reads
   - List each allowed hit with its reason. For example, hel1028 l.185 is a pre-load container-range assertion, and
     hel1023 `readRects` depends on CR1.
3. **Pin task 4.1 to exact lines and the right ground truth.**
   - **The problem:** task 4.1 cites only `dev-db-residue.txt`. That file supports the residue nit (l.74:
     `16:22:40` → newest row `16:04:07`, keeping 16:22:40 described as the query bound if retained). It does not
     support the "all 8 at lg geometry" nit, whose source is the archived `skeptic-final-1.md` CI-trace analysis
     (l.10-15).
   - **Required:**
     - Reword evidence.md **l.18 only** (item 1, CI trace) to "all 8 at lg geometry, 4 outside md bounds".
     - Leave l.28's `bad=4/8` unchanged. It is verbatim probe output.
     - Leave l.24 unchanged unless a ground-truth source for those passing-run reads is cited. It is a different
       measurement, and rewriting it would assert an observation nobody made.
4. **Cover AC3 for every migrated spec, not just hel1392-burst.**
   - **The problem:** task 2.3 red-probes only hel1392-burst. Task 2.4 then migrates "any spec 1.1 marked migrate"
     with only a green check. If the audit marks a spec whose old gate was a fixed sleep or a box read, that is a
     semantic change and needs the same red-then-green.
   - **Required:** extend 2.3 so each spec the audit marks "migrate" gets a red probe under the delayed-RO init
     script before its edit, recorded per spec in evidence.md. A spec with no red gets the explicit "no red
     obtained" statement.
5. **Bind D4's effect-order mechanism, and make the proof requirement consistent.**
   - **The problem:** the "pass those outputs via refs" option would need render-time ref writes (flagged by the
     react-hooks lint rules) or an effect-lagged ref. Either one adds a window in which `handleLayoutChange` calls a
     previous render's `markLayoutChanged`/`commitInteractionLayout`. That is needless risk next to `useLayoutSave`'s
     I1 bookkeeping, because those callbacks are already stable (useLayoutSave.ts:334-351).
   - **Required:**
     - Choose the split: a commit-flag hook declared before `useLayoutSave`, and a handlers hook called after
       `useLayoutSave` that receives its outputs as plain arguments.
     - Reconcile D4's "proves order with a test" with the Risks line's "test or a recorded argument". Pick one, and
       put it in task 3.2's acceptance signal.

### Non-blocking notes

- Task 2.1: the gate that typechecks e2e is `npm run check:e2e-types` (in the pre-commit hook). Name it instead of
  "typecheck and lint cover e2e".
- D3 could state its likely outcome up front: phone→desktop always mounts a fresh grid whose `processedWidth`
  initialises to the mount width. The executor should still run the probe and report what it observes.
- The helper should time out with the observed processed-width value in the failure message (the Risks section says
  so; make it a task-2.1 check).
- No mtime or positional evidence was relied on. No gate defect to record.
