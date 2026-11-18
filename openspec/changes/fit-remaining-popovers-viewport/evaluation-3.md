## Evaluation Report — Cycle 3 (evaluation-3.md)

Reviewed HEAD: cfe3a9540fc3d9b593f5dad10d47d616905ed00c.
- Cycle diff: d4969e8d9..HEAD.
- Full change: 36735a24a..HEAD, against the live base.
- Probes ran in my own Playwright process. Every record carries `location.port` = 7188.
- Evidence directory: `/home/matt/Development/helio/.concertino/runs/HEL-1756/evidence/.concertino/scratch/HEL-1756/eval3/`.

### Phase 1: Spec Review — PASS

- **Cycle-2 CR, keyboard reachability: done.**
  - `DashboardAppearanceEditor.tsx` now has a layout effect gated on `isOpen && placed`. It focuses the selected preset,
    or the first control if none is selected.
  - design.md D14 amends D13 with the reason and the rejected alternatives.
  - The unit assertion that the editor "does not take focus" was replaced. The new unit test spies on `focus()` and
    checks focus is never moved while the form is still hidden.
  - probes.md records the behavior change, as D3 requires.
- **ACs:**
  - UserMenu fits, with the numbers to show it.
  - Appearance editor and provenance popover can clip, and both now use `panelFit`. Each has an e2e that was red first,
    checking `elementFromPoint` on the last item.
  - The rail guard covers the last row with the page scrolled to its end. The row-shift assertion turns red on its own
    under the recorded mutation, in both themes.
- **Constraints C1-C10:** honored. C9 is proven in a real browser for both converted popovers that focus on open. C10:
  no synthetic resize.
- The probes.md 1280x320 row now names the dashboard it was measured on, which resolves the cycle-2 note.

### Phase 2: Code Review — PASS

Gates, run fresh by me in WORKTREE_PATH:
- `npm run lint`, `npm run format:check` and `npm run typecheck`: exit 0.
- `npm test` (maxWorkers 3): 66/66 root suites (579 tests) and 799/799 frontend suites (9725 tests).
- `npm --prefix frontend run build`: exit 0.
- `e2e/hel1756-popover-viewport-fit.spec.ts` and `e2e/hel1750-actions-menu-viewport-fit.spec.ts` with 2 workers:
  **24/24 pass** (`e2e.txt`). That covers provenance, the editor geometry, keyboard-open and keep-open, the rail guards,
  and the HEL-1750 cases. Nothing else regressed.

Red-first check (`red-editor-kbd.txt`): on the cycle-2 source the new keyboard test fails in both themes at its first
focus assertion (`Expected: true Received: false`). This matches what I measured independently on d4969e8d9 in cycle 2:
`inForm: false` after the keyboard open, and the editor closing on Tab. I accept the red.

Code: the effect is small, keyed on `placed` like D6, and has no magic values. It re-runs only on open or placement, not
on every `reposition()`, because `placed` stays true.

### Phase 3: UI Review — PASS

Keyboard path, measured in light and dark at 1280x900 and 1280x320 (`kbd-probe.txt`):
- Enter on the trigger puts focus on the "Default" preset, with `:focus-visible`.
- Fifteen Tabs walk through every preset, both colour inputs, and Save. The editor stays open and focus stays inside the
  form at every step.
- Enter on Save, with PATCH routed to 500, shows the save error.
- Escape closes the editor and returns focus to the trigger.

Mouse open from a fresh page (`mouse-probe.txt`, light and dark):
- Focus lands on "Default" with `:focus-visible` false, so no focus ring appears.
- Visually the panel is the same as before, apart from where focus sits.

Geometry is unchanged from cycle 2: every control is reachable at 400 and 320 in both themes. Provenance is unchanged
and green. No page errors.

### Overall: PASS

### Non-blocking Suggestions
- **After a failed save via the keyboard, focus drops to `<body>`, because Save is `disabled` while saving.**
  - The disabled-while-saving behavior predates this change.
  - What is new is the hook's focus-out close. The keyboard user's next Tab now closes the editor, and the draft is
    reset on close.
  - Mouse users are unaffected. The error path is narrow and the draft is one click to redo.
  - Suggested follow-up: after a failed save, return focus to Save (or the error), or keep Save focusable while saving
    using `aria-disabled`.
  - Measured: `afterEnterSave {open: true, inForm: false}` in all four runs.
- Shift+Tab from the first preset closes the editor and leaves focus on `<body>`, via the unmounting scrim button,
  rather than on the trigger. ActionsMenu behaves the same way under the shared hook.
