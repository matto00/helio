## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed at HEAD 36735a24aef109328a3c1909ecb63721cc5fa2ff. The change dir is untracked, so the plan has no commits yet.

### What I verified (with evidence)
- **Spawn guard:** `assert-cwd.sh` returned `READY ambient=/home/matt/Development/helio branch=bug/popover-viewport-fit/hel-1756`.
- **AC coverage:** AC1 (probe the three popovers on desktop and phone, light and dark; fix any that clip with panelFit, or state why not; a red-first e2e that checks `elementFromPoint` on the last item) maps to D1, D2 and D4 and tasks 1.x and 2.x. AC2 (last-row, scrolled-to-end rail guard, with the mutation recorded) maps to D5 and tasks 3.1 and 3.2. No AC is uncovered and I found no scope drift.
- **Fit math matches today's placement on the preferred side.** I checked this against `panelFit.ts`:
  - UserMenu `nav`: prefer above, gap 8, gives `bottom = innerHeight - rect.top + 8`. That equals today's value.
  - UserMenu `rail` option (a): synthetic `top = rect.bottom`, gap 0, prefer above, gives `bottom = innerHeight - rect.bottom`. That equals today's value.
  - Provenance above, gap 8: equals today's `computePos`.
  - The "Already fitting → same position" scenario therefore holds.
- **D5 mutation is real.** `DashboardList.css:9-13` carries the D10 `position: relative` on `.dashboard-list`. The existing guard (`e2e/hel1750-actions-menu-viewport-fit.spec.ts:101-140`) hovers row `nth(4)` with the page unscrolled, as the ticket says.
- **Hook behavior.** I read all of `usePortalPopover.ts`:
  - The `place` path returns early unless the hook's own `panelRef` is attached.
  - It re-places only on `[isOpen, opted]` and on window `resize`.
  - It exposes no re-place function.
  - Attaching `panelRef` turns on focusout-close.
- **Consumers.** UserMenu (`UserMenu.tsx:79-80`) and ProvenancePopover (`ProvenancePopover.tsx:47`) each own a **local** `panelRef`, separate from the hook's. UserMenu `bar` has no consumer: AppRail passes `rail`, BottomNav passes `nav`.

### Verdict: REFUTE

### Change Requests

1. **Focus-on-open breaks under "hidden until placed". The design never mentions it.**
   - D2 makes each converted panel `visibility: hidden` until `placed`. A hidden element cannot take focus. HEL-1750 hit exactly this: the comment at `ActionsMenu.tsx:79-80` says "a `visibility: hidden` panel cannot take focus", and ActionsMenu's focus effect was re-keyed on `placed`.
   - UserMenu moves focus in with `useEffect(..., [isOpen])` (`UserMenu.tsx:93-97`). That effect runs before the placed re-render is committed, so the panel is still hidden when it fires.
   - ProvenancePopover moves focus in with `useLayoutEffect(..., [focusChecks, ready])` (`ProvenancePopover.tsx:63-71`). That is a child layout effect, so it runs before the parent hook's placement effect.
   - Neither effect re-runs once `placed` flips. Focus stays on the trigger, which regresses F-189/F-007 (UserMenu) and HEL-1207 A3 (provenance).
   - jsdom does not enforce visibility for focus, so the existing `toHaveFocus` unit tests would stay green while the browser breaks.
   - **Required:** add a decision that every converted popover's focus-on-open is keyed on `placed`. Pass `placed` down to ProvenancePopover. Add a real-browser (e2e) assertion that focus lands in the panel on open for each converted popover. A jsdom test cannot be the proof.

2. **Re-placing when content grows is left undecided, and the suggested mechanism cannot work.**
   - `fitPanelVertically` returns `maxHeight = naturalHeight` even when the panel fits (`place(prefer, height)`), and `placeActionsMenu` applies it inline.
   - Provenance opens in its small "Loading provenance…" state on every cache miss, and a cache miss is the default first open. It is measured and capped at that small height. When content arrives, the panel's own box stays capped, so a `ResizeObserver` on the panel (the Risks section's suggestion) never fires.
   - "Calling the hook's resize path" is not an API. The only way in is dispatching a synthetic window `resize`, which would also re-run every app-wide resize handler (react-grid-layout and others).
   - The same growth happens in DashboardAppearanceEditor: the contrast warning (`role="alert"`) appears on preset picks, and `InlineError` appears on a failed save. Either adds a scrollbar to a panel that has room.
   - **Required:**
     - Choose one concrete mechanism and say what it watches. Options: observe an inner content element, not the capped panel; or a hook option or return value such as `reposition()` or a re-place key, named as the one shared-file edit.
     - Forbid dispatching a synthetic window resize.
     - Cover provenance loading → ready and loading → error, and the editor's contrast warning and save error.
     - Fix proposal.md's "shared files expected to stay untouched" so it does not contradict the plan.
     - Add an e2e that opens provenance on a cache miss and asserts the loaded last section is reachable.

3. **The provenance cap and ref wiring are unspecified, and the omission causes a regression in tall windows.**
   - The inline `maxHeight` from the fit overrides `ProvenancePopover.css`'s `max-height: min(70vh, 480px)`. Without the `cap` option, a 700px provenance panel in a tall window would grow past the 480px design cap.
   - **Required:**
     - D2 must pass `cap: Math.min(0.7 * innerHeight, 480)`, or an equivalent, for provenance.
     - Keep the existing `width` and `left` clamp from `computePos`.
     - State how the hook's `panelRef` reaches ProvenancePopover's root, which already has its own local ref for focus and the Tab trap. Merge or forward the refs.
     - Update the HEL-1207 doc comment (`ProvenancePopover.tsx:30-34`). It says "No `panelRef` is attached to the hook, so it does not close on focus-out", and D3 would make that false.
     - For UserMenu, the hook's `panelRef` replaces the local `useRef` at `UserMenu.tsx:80`. Two refs cannot both be passed to one `ref=` without merging.

4. **The scroll CSS scope and one spec target are ambiguous.**
   - D2 says "`overflow-y: auto` on the panel (CSS)". DashboardAppearanceEditor's panel is the **shared** `.popover__panel` class (`Popover.css:29`), which ActionsMenu, OutputSchemaDisclosure and provenance also use. State that the overflow rule goes on a consumer-scoped class, such as `.dashboard-appearance-editor` or `.user-menu__popover`, and never on `.popover__panel`.
   - The appearance-editor requirement in `specs/popover-viewport-fit/spec.md` names "the submit/cancel row". There is no cancel control. The last control is the "Save dashboard style" submit button (`DashboardAppearanceEditor.tsx:260-266`). Name it, so the `elementFromPoint` target is unambiguous.

### Non-blocking notes
- DashboardAppearanceEditor is mounted in two places: `CommandBar.tsx:215` and `DashboardMetaRow.tsx:189`. The probe should record which instance is visible at each probed size and probe that one.
- UserMenu `bar` has no consumer. Converting it is harmless, but the design says "check whether `bar` still has a consumer" without saying what to do. Leaving it on the same `place` function, preferring below, is fine. Do not delete it in this ticket.
- D5: with 12 seeded rows at 1280x400, the last row may sit below the fold inside the `.dashboard-list` scroller even after `window.scrollTo`. Scroll that scroller to its end as well, and assert the last row's box is inside the viewport before the `mouse.move`. The "trigger visible inside the row" assertion catches a missed hover, but it is better to make the setup explicit.
- With measured fit, provenance's old `MIN_ROOM_BELOW = 320` heuristic goes away, so a panel that is still loading may open below and then flip above when it grows. That follows the spec ("preferred side when it fits"). Record it in probes.md so the final gate does not read it as jitter.
