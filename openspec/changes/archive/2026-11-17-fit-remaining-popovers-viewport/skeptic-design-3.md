## Skeptic Report — design gate (round 3, skeptic-design-3.md)

Reviewed HEAD 36735a24aef109328a3c1909ecb63721cc5fa2ff (no implementation commits yet; artifacts only).

### What I verified (with evidence)

- **Round-2 CR1 (appearance editor on phone) is resolved.** `App.css:477-480` hides `.dashboard-appearance-editor`
  at widths up to 768px. The spec now has a "Not rendered on phone" scenario in place of the phone scenario. D4, D10
  and tasks 1.3/2.1 state the editor is desktop-only and record phone as "not rendered". UserMenu (BottomNav `nav`)
  and provenance keep their phone probes.
- **Round-2 CR2 (editor class) is resolved.** D9 names a new class, `.dashboard-appearance-editor__panel`. A grep of
  `frontend/src` shows it is unused today. D9 forbids reusing `.dashboard-appearance-editor`, whose `z-index: 4`
  (`DashboardAppearanceEditor.css:1-3`) and phone `display: none` it cites correctly. Task 2.3 mirrors this. D9 also
  keeps the shared `.popover__panel` (`Popover.css`) untouched.
- **Round-2 non-blocking notes are folded in:**
  - D11 removes UserMenu's observer and forbids a wrapper inside `role="menu"`.
  - D11 moves the provenance column/gap to the inner wrapper. This matches `.provenance-popover` being
    `display:flex; flex-direction:column; gap:var(--space-3)` in `ProvenancePopover.css`. The only CSS-lock test
    (`ProvenancePopover.css.test.ts`) checks touch-target rules, not that block, so moving it does not break the test.
  - D12 covers the colour-input focus-out.
  - Tasks are renumbered 2.1-2.5, with the red e2e before the fix.
- **Code claims checked against the code:**
  - `usePortalPopover.ts`: `place` runs only when `panelRef` is attached. The panel is hidden until `placed`. The
    focus-out close ignores a null `relatedTarget` (line ~99). The hook has no `reposition` today, so D7's addition is
    genuinely new and additive.
  - `panelFit.ts`: the `fitPanelVertically` signature and behaviour match the design. When the panel fits,
    `maxHeight` = height, so D7's "pinned at the measured height" problem is real. With 0 height it returns the
    preferred side uncapped.
  - `UserMenu.tsx`:
    - `handleToggle` returns `{bottom: innerHeight - rect.bottom, left: rect.right + 8}` for `rail`, the nav anchor
      for `nav`, and the `bar` anchor otherwise.
    - The local `panelRef` is at line 80.
    - The focus effect is keyed on `[isOpen]`.
    - The only consumers are `AppRail.tsx:108` and `BottomNav.tsx:87`, so `bar` has no consumer, as D2 says.
  - D2 option (a) for `rail`: a synthetic trigger at `rect.bottom` with gap 0, preferring above, gives
    `bottom = innerHeight - rect.bottom`. That is today's anchor exactly. The `nav` case (gap 8, prefer above) also
    reproduces today's anchor.
  - `DashboardAppearanceEditor.tsx`: the form is `className="popover__panel"`, positioned at
    `{top: rect.bottom+8, right}`, with no cap. The last control is the "Save dashboard style" submit (followed by
    `InlineError`). The contrast warning and save error are real growth paths for D7.
  - `ProvenanceTrigger.tsx:37-64`: `MIN_ROOM_BELOW = 320`, width `min(360, innerWidth-40)`, and the `left` clamp all
    match D8. `ProvenancePopover.tsx:63-71`: the focus `useLayoutEffect` deps are `[focusChecks, ready]`, which D6
    extends with `placed`. The popover has its own local `panelRef` for the Tab wrap, so D8's merged callback ref is
    needed and correctly identified.
  - `e2e/hel1750-actions-menu-viewport-fit.spec.ts:101-139`: the existing guard hovers row `nth(4)` with the page
    unscrolled. `seedRail` exists for reuse. `DashboardList.css:9-14` holds the `position: relative` that D5's
    mutation reverts.
- **Acceptance-criteria coverage:**
  - AC1 is covered:
    - probe at short desktop and phone sizes in both themes: tasks 1.2-1.5;
    - conversion to `panelFit`, or a recorded "fits" with numbers: task 2.3 and the spec's "already-fitting"
      requirement;
    - an `elementFromPoint` e2e that is red first: task 2.1, D4 and C7.
  - AC2 is covered: last row with the page scrolled to its end, and the mutation recorded (tasks 3.1/3.2, D5).
  - No AC is uncovered. No task goes beyond the ACs, apart from the justified additive `reposition()` (D7).
- **Contracts:** frontend-only, no API or schema change, so no contract delta is needed.
- **Placeholders:** no TODO, TBD or deferred decision blocks implementation. The probe-conditional branches are
  deliberate (the ticket says "probe first") and each branch has a defined outcome.

### Verdict: CONFIRM

### Non-blocking notes

- **Editor focus-on-open.** `DashboardAppearanceEditor` has no focus-on-open today. The spec's focus requirement
  correctly lists only the user menu and provenance ("exactly as before"). However, task 2.1 / D6 / C9 say "the
  focus-on-open e2e ... per converted popover". The executor should NOT add focus-on-open to the editor (that would
  be scope drift). Its real-browser focus checks are D3/D12: tabbing between controls and clicking the colour input
  keep it open.
- **D5 wording.** D5 says "extend the existing ... describe". At `hel1750-...spec.ts:101` it is a top-level
  `for (theme)` loop of tests, not a `describe`. Add the new test inside the same loop.
- **Rail guard may not go red.** With the D10 fix in place the page has no scroll (the existing test asserts
  `scrollHeight <= innerHeight`), so "scroll the window to its end" only matters under the mutation. If removing
  `position: relative` does not turn the new last-row test red on its own, that is a finding to record and raise. It
  must not be papered over by changing the mutation or the assertion.
- **Hook's horizontal clamp.** Once `panelRef` is attached, the hook's existing one-shot horizontal clamp effect also
  engages for a `right`-anchored converted panel (editor, UserMenu `nav`). If the local `place` already clamps, the
  hook's effect is a no-op (`overflowLeft < 1`). The unit tests should not double-count it.
