## Standing Constraints

- [C1] The capped-body e2e assertion names the scroller it reads (`.ui-data-grid` located inside the live cap `.mobile-panel-stack__item--output .panel-content`; the cap itself never overflows) and asserts, immediately before the drag, that the body overflows vertically and sits at scrollTop 0, so a chaining pass can never be vacuous.
- [C3] Every guard mutation sits on that guard's own hit/drag path (for G2: from the hit `th` up to the Table card `.mobile-panel-stack__item--output`). A mutation on another element (e.g. the Notes-card control) never counts as showing a guard failable; if nothing on the path blocks, stop and report.
- [C2] Any test that is already green on unmodified code (e.g. the header-text case) is recorded and labelled as a guard, never as red-first proof; the PR body states plainly that a capped Table's body scrolls before the page.

## 1. Guard e2e (owner ruled: no fails-first AC)

- [x] 1.1 Finish `e2e/hel1692-table-header-touch-scroll.spec.ts` (isMobile + hasTouch, CDP touch, 375x812 and 430x932, Table = `output` panel, card `.mobile-panel-stack__item--output`): G1 static touch-action guard on the handle hit chain, G2 behavioural drag guard from a handle and from header text. Label both GUARD in the spec, and remove the WIP spec's `red-first` label and its "used to be dead" header claim. Verify: green after 2.1.
- [x] 1.2 Record the cycle-1 non-reproduction probe table (8/8 scrolled) in scratch evidence for the PR body.

## 2. Fix

- [x] 2.1 Change `.ui-data-grid__resize-handle` to `touch-action: pan-y` with a comment citing HEL-1692 and why (resize is mouse-only, so the property could only block panning, never enable a touch resize; the reported scroll block did not reproduce in Chromium and iOS WebKit is untested; no untested pen claim). Verify: G1/G2 green at both widths; then mutation: restore `touch-action: none` on the handle and show G1 red; inject `touch-action: none !important` on G2's own path (climb from the hit `th` up to `.mobile-panel-stack__item--output`, C3) and show G2 red — if nothing on that path blocks, STOP and report; revert; keep transcripts.
- [x] 2.2 Correct the `touch-action: none` comment in `e2e/hel1656-pull-to-refresh.spec.ts` (~line 111). Verify: hel1656 spec still passes.
- [x] 2.3 Delete ONLY the dead cap rule `.mobile-panel-stack__item--table .panel-content--table` (MobilePanelStack.css ~102) after a grep proves nothing produces `mobile-panel-stack__item--table` (`PanelKind` has no `table`); update the citation in `mobilePanelHeights.ts` (~39-41) to the live cap `.mobile-panel-stack__item--output .panel-content` (with `.ui-data-grid` as the scroller). The `:54` intrinsic-kind selector list and its `intrinsicKinds` test entry are OUT of scope (already documented dead by HEL-1022's comment). In the same edit, mark the HEL-1022 comment (~115-117, "the same capped, internally-scrolling treatment table had") as referring to the formerly-present rule. Verify: grep output recorded; `npm --prefix frontend test -- --testPathPatterns=MobilePanelStack` green.

## 3. Desktop guard

- [x] 3.1 Add a desktop-width test that mouse-drags a resize handle horizontally and asserts the column widened. Verify it is failable by a temporary mutation (e.g. drop the handle's mousedown listener) and record the red/green transcript; label it a guard.

## 4. Capped body triage

- [x] 4.1 With a Table whose `.ui-data-grid` (inside the live cap `.mobile-panel-stack__item--output .panel-content`) overflows vertically — assert on `.ui-data-grid` `scrollHeight > clientHeight` and `scrollTop === 0`, and on `.panel-content` `scrollTop === 0`, immediately before the drag (C1) — body at top and page scrolled away from top, drag down from inside the body with real touch; record whether the page scrolls. Verify: add an e2e assertion for the observed intended behaviour (chains to the page). If it does not chain, root-cause per systematic-debugging and fix, or escalate if the fix is an interaction choice.

## 5. Verification

- [x] 5.1 Run the new spec and hel1656 at Playwright workers 2; run `npm --prefix frontend test -- --testPathPatterns=DataGrid` (maxWorkers 3); lint/typecheck/format via the pre-commit hook. Verify: all green, transcripts recorded.
- [x] 5.2 Visual check of a phone Table panel in both themes against the running app (no visual change expected; handle hover line unchanged on desktop).
- [x] 5.3 Write the PR-body disclosures into scratch for the orchestrator: not reproduced in Chromium (8/8 scrolled incl. throttled runs), iOS WebKit untested, owner dropped the fails-first AC (ship-pan-y-as-guard), each guard and its mutation transcript, dead `--table` cap rule deleted in this PR (with grep proof), and a capped Table's body scrolls before the page (C2). Verify: file present at /home/matt/Development/helio/.concertino/scratch/HEL-1692/pr-disclosures.md.
