## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD: 173a880de84d4d1cbf968d0be1868697af030974 (base 36735a24aef109328a3c1909ecb63721cc5fa2ff, resolved live).
All browser probes ran through Playwright against this lane's servers (every probe record carries `location.port` = 7188;
the shared MCP browser was not used, per C6).

### Phase 1: Spec Review — FAIL

Issues:
1. **AC 1 is not met for DashboardAppearanceEditor: it can clip, and probes.md says it fits.** The executor probed only
   the editor's freshly opened state. Its own probe gives a 324px panel bottom in a 320px window, and the panel grows
   after it opens: picking a preset can show the contrast warning, and a failed save adds an InlineError. I re-probed
   at 1280x400 and 1280x320 in light and dark:
   - Open: form 94.5-383.5, Save 334.5-366.5, hit. This matches the executor's numbers.
   - After a preset pick shows the contrast warning: form 94.5-435.1, Save 386.1-418.1 in a **400px** window, and
     `elementFromPoint` at Save's centre does **not** return it. The presets that do this are 8 of 13 in dark
     (Twilight, Forest, Plum, Ember, Storm, Teal, Rose, Gold) and 4 in light (Paper, Mist, Sage, Blush). It is an
     ordinary one-click state.
   - With the warning showing and a failed save: form bottom 450.1. The InlineError sits at 418.1-433.1, outside the
     viewport.
   - At 1280x320, light and dark, Save is entirely outside the viewport once the warning shows. Playwright refused to
     click it: "Element is outside of the viewport".
   The panel is `position: fixed`, so scrolling the page does not bring Save into view.
   Evidence: `/home/matt/Development/helio/.concertino/runs/HEL-1756/evidence/.concertino/scratch/HEL-1756/eval1/editor-probe.txt`,
   screenshots `.../eval1/editor-dark-400.png` and `.../eval1/editor-light-400.png` (Save is visibly cut off at the window
   bottom), and the probe script `.../eval1/editor.probe.ts`. Under the AC, the editor must move to `panelFit`. The
   existing design and tasks (D7, D9, D11, task 2.3/2.4) already describe that conversion, including re-fit on the
   contrast warning and save error.
2. probes.md:23 ("DashboardAppearanceEditor: FITS") and probes.md:60 are wrong. Task 1.5 is marked done on a wrong
   conclusion.
3. UserMenu "fits": verified as plausible from the code. Every consumer variant is bottom-anchored
   (`UserMenu.tsx:155,159`), so it grows upward from the trigger and has no state that grows after it opens. The
   executor's numbers stand. No issue.
4. Provenance conversion: matches the spec delta and design. No issue.
5. AC 2, the rail guard: the test exists and is red under the recorded mutation (`position: relative` removed from
   `.dashboard-list`) in both themes. I checked the raw outputs in the scratch dir: `red-rail2.txt` and `red-rail3.txt`.
   But it is red at the `railSettled` poll after the hover, not at the row-shift assertion. With that poll removed,
   the 34px shift assertion fires in only one theme; in the other, the `scrollHeight` assertion fires and the row did
   not move. red-evidence.md reports this accurately, but the spec's code comment claims otherwise. See CR 2.
6. CONSTRAINTS C1-C10: no violation found in the diff. C9 is covered by a real-browser focus e2e. C10 holds: no
   synthetic resize, and the hook's `reposition()` is used.

### Phase 2: Code Review — FAIL

Gates, run fresh by me in WORKTREE_PATH:
- `npm run lint`: exit 0.
- `npm run format:check`: exit 0.
- `npm run typecheck`: exit 0.
- `npm test`: 66/66 root suites and 798/798 frontend suites; 579 and 9715 tests pass.
- `npm --prefix frontend run build`: exit 0.
- Touched e2e, `hel1756-popover-viewport-fit` and `hel1750-actions-menu-viewport-fit` (workers 2): 15/15 pass.

Red-first claims: the raw outputs for red1 (6 failed / 3 passed on stashed source), m1 (focus), m2 (observer) and m3
(cap) exist and match red-evidence.md. I did not re-run the mutations, because that would mean editing the executor's
worktree.

Code: `usePortalPopover.reposition()` is additive, stable, and covered by its own unit test. The provenance placement
reuses `fitPanelVertically` and `VIEWPORT_MARGIN`, so the local duplicate constant is gone. The ResizeObserver on the
uncapped inner wrapper is sound: it has no feedback loop and disconnects on unmount. CSS spacing is preserved by moving
flex/gap to `__inner`.

Issues:
1. Dead code: `e2e/support/hel1756Seed.ts:18-19,54-61`. The `extraRoots` parameter and its loop are never passed by any
   caller (all four calls in `hel1756-popover-viewport-fit.spec.ts` pass three arguments).
2. Inaccurate comment: `e2e/hel1750-actions-menu-viewport-fit.spec.ts:143` says "The row-shift assertion below is what
   carries this guard alone". The recorded red contradicts it: the guard fails at `railSettled`, and the shift
   assertion alone fires in only one theme.

### Phase 3: UI Review — FAIL

- Provenance popover, happy path: it opens, fits and scrolls in both themes at 1280x400, 1280x320 and 390x400. Its
  last section is hit-testable (green e2e). The cache-miss re-fit and the 70vh cap are verified (green e2e).
- DashboardAppearanceEditor: Save and the save error are unreachable or clipped after a preset pick at 1280x400 and
  1280x320, in both themes (Phase 1 issue 1). This is an observable defect in a flow this ticket covers.
- No console errors were observed in the probe flows. Phone hides the editor (App.css max-width 768px rule).

### Overall: FAIL

### Change Requests
1. **Convert DashboardAppearanceEditor to measured placement.**
   - Use `usePortalPopover({ place })` with `fitPanelVertically`, as planned in design D7/D9/D11 and task 2.3.
   - Attach the hook's `panelRef` to the `<form>`, hide it until `placed`, apply `maxHeight`, and scroll through the
     new `.dashboard-appearance-editor__panel` class.
   - Call `reposition()` from a ResizeObserver on an uncapped inner wrapper, so it re-fits when the contrast warning
     appears and when the InlineError appears.
   - Add e2e cases to `e2e/hel1756-popover-viewport-fit.spec.ts` at 1280x400 and 1280x320, light and dark. Pick a
     warning-producing preset (e.g. "Twilight" in dark, "Paper" in light) and assert `document.elementFromPoint` at Save's
     centre returns Save. Add a case for the save error with PATCH routed to 500, asserting the error text is
     hit-testable. Record each red on the unfixed editor in red-evidence.md.
   - Add a real-browser focus-on-open check if the form becomes hidden until placed (C9).
   - Correct probes.md:23-35 and probes.md:60 with the grown-state numbers.
2. Fix the comment at `e2e/hel1750-actions-menu-viewport-fit.spec.ts:141-143` so it states what actually carries the
   guard. Either:
   - (a) say the guard fails through the post-hover settle, the scroll-height check or the row shift, whichever
     fires first, or
   - (b) take the shift measurement before `railSettled`, so the shift assertion can fire by itself, and re-record the
     red.
   Keep red-evidence.md section 3 consistent with the choice.
3. Remove the unused `extraRoots` parameter and loop from `e2e/support/hel1756Seed.ts:18-19,54-61`. Alternatively, add
   the test that uses it.

### Non-blocking Suggestions
- probes.md's UserMenu note on the owner tier's extra Usage item is an estimate ("about 31px"). A single measured
  owner-tier record would make it self-authenticating.
