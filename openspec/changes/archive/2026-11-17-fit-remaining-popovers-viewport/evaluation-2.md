## Evaluation Report — Cycle 2 (evaluation-2.md)

Reviewed HEAD: d4969e8d9256e216ade3018b8c6eb2723a5955f0. The review diff is 173a880de..HEAD for this cycle, read against
the live base 36735a24a.

All browser evidence comes from my own Playwright process (not the shared MCP browser). Every probe record carries
`location.port` = 7188.

Correction to evaluation-1.md: I swapped the theme labels on the presets that trigger the warning.
- In **light**, the dark-surface presets trigger it: Twilight, Forest, Plum, Ember, Storm, Teal, Rose and Gold.
- In **dark**, the pale ones do: Paper, Mist, Sage and Blush.

The executor's probes.md and `WARNING_PRESET` are correct. My cycle-1 probe output confirms it: in light-then-dark run
order, the first PROBE line is light.

### Phase 1: Spec Review — FAIL

Cycle-1 change requests:

- **CR1, editor converted: done.**
  - The editor now uses measured placement through `fitPanelVertically`, the hook's `panelRef`, and the scoped
    `.dashboard-appearance-editor__panel` scroll class.
  - It stays hidden until placed.
  - A ResizeObserver on an uncapped inner wrapper calls `reposition()` (D7/D9/D11). No synthetic window resize is used
    (C10).
  - e2e tests and unit tests were added. probes.md has been corrected.
- **CR2, rail guard reordered: done.** The shift and scroll-height reads now come before `railSettled`, and the comment
  is accurate. The raw output `red-rail4.txt` shows the row-shift assertion itself failing in both themes:
  `beforeBox y 214`, `afterBox y 248`, received 34. The ticket's "catches the 34px shift by itself" is now literally
  true.
- **CR3, `extraRoots` removed: done.**

New issue:

1. **Keyboard regression: keyboard users can no longer reach the appearance editor's form.**
   - **Cause:** attaching the hook's `panelRef` opts the editor into the hook's close-on-focus-out
     (`usePortalPopover.ts:93-108`). D13 deliberately gives the editor no focus-on-open, and its form is portalled to
     the end of `<body>`.
   - **Effect:** after a keyboard open (focus the trigger, press Enter), the next Tab moves focus to the next element
     after the trigger ("Open assistant"). That is outside both the trigger and the panel, so the editor **closes**.
     There is now no keyboard path into the form at all.
   - **Before:** the base code attached no `panelRef`, so the hook's focusout listener returned early. The editor
     stayed open and a keyboard user could still Tab through to the portalled form, awkwardly but reachably.
   - **Measured:** in light and dark at 1280x900, 400 and 320, `afterTab: {open: false, active: "Open assistant",
     inForm: false}`. Raw output:
     `/home/matt/Development/helio/.concertino/runs/HEL-1756/evidence/.concertino/scratch/HEL-1756/eval2/editor-probe.txt`;
     probe script `.../eval2/editor2.probe.ts`.
   - **Not recorded:** D3 requires "Any behavior change found is recorded in probes.md". This change is not recorded,
     and probes.md describes the new focus-out close only as harmless.
   - **Why the tests miss it:** the keep-open e2e test moves focus programmatically (`first.focus()`) and never takes
     the real Tab path out of the trigger. The unit test at
     `DashboardAppearanceEditor.placement.test.tsx:184-195` asserts the no-focus-on-open half.

### Phase 2: Code Review — PASS (code itself); the defect above is behavioral

Gates, run fresh by me in WORKTREE_PATH:
- `npm run lint`: exit 0.
- `npm run format:check`: exit 0.
- `npm run typecheck`: exit 0.
- `npm test` (maxWorkers 3): 66/66 root suites (579 tests) and 799/799 frontend suites (9724 tests).
- `npm --prefix frontend run build`: exit 0.
- `hel1756-popover-viewport-fit` and `hel1750-actions-menu-viewport-fit` (workers 2): **22/22 pass**
  (`.../eval2/e2e.txt` under the evidence dir).

Red-first claims:
- `red-editor.txt` shows 4 failures at "form inside the viewport and Save hit-testable" and 2 failures at the Save
  click. The 1 pass is the keep-open guard, which is not a fix proof, as red-evidence.md states.
- `red-rail4.txt` matches section 4.

Adequacy of the save-error-alone red at the Save click: **adequate**. The executor's own unfixed probe
(`ed-probe.jsonl`) puts the unfixed form at 94.5-383.5 even at 1280x320. Save (334.5-366.5) is therefore entirely below
the 320px viewport, which is why Playwright's click timed out. That is the same reachability defect the test guards:
the user cannot reach Save, so cannot reach the error.

With the fix, my probe shows the form at 1280x320 capped to 94.5-312 (`clientHeight` 216, `scrollHeight` 287-354).
After scrolling inside the form, Save sits at 263.1-295.1 and the error at 295.1-310.1, and both are hit-testable.

Code quality:
- `placeAppearanceEditor` mirrors `placeProvenance`.
- It reuses `VIEWPORT_MARGIN` and `fitPanelVertically`.
- The observer is gated on `isOpen` and disconnects on cleanup.
- The inner wrapper is a plain block, so the layout is unchanged. Measured in a 900px window: form 94.5-383.5, the same
  as the unfixed open state.
- No dead code or magic values found.

### Phase 3: UI Review — FAIL

- **Geometry:** fixed in light and dark at 1280x900, 400 and 320. Opened, after a warning preset, and after a failed
  save, every control is reachable inside the capped, scrolling form. See the screenshots `.../eval2/ed-dark-320-error.png`
  and `.../eval2/ed-light-400-open.png`. The visual result matches the running app's popover chrome, with no spacing
  change in a tall window. Phone does not render the editor (App.css 768px rule).
- **Provenance:** unchanged from cycle 1 and green.
- **Console:** only the deliberate routed 500 and a pre-login 401; nothing new.
- **Keyboard support:** FAIL. Phase 1 issue 1: the editor closes on the first Tab after a keyboard open, so a keyboard
  user cannot reach any of its controls.

### Overall: FAIL

### Change Requests
1. **Restore keyboard reachability of DashboardAppearanceEditor.** `DashboardAppearanceEditor.tsx:191` and `:199-202`.
   The recommended fix:
   - Move focus into the form once `placed`, keyed on `placed` exactly as D6 does for provenance; for example, focus
     the selected preset (or the first one) in a layout effect gated on `isOpen && placed`.
   - Record the D13 amendment in design.md.
   - Replace the "does not take focus" assertion in `DashboardAppearanceEditor.placement.test.tsx:184-195`.
   - Add a real-browser e2e (C9): focus the trigger, press Enter, assert `document.activeElement` is inside the form,
     press Tab, and assert the form is still open with focus still inside it.
   - Show it red first against the current commit, which is the natural mutation, and record that in red-evidence.md.

   Whichever approach you take, record the behavior change in probes.md as D3 requires. Do not resolve this by
   detaching `panelRef`, because measured placement depends on it.

### Non-blocking Suggestions
- probes.md's "just opened 1280x320: 36-324" row does not match the executor's own unfixed `ed-probe.jsonl` or my probe,
  which both show the form top at 94.5 in a 320px window. Either re-measure that row or note which trigger instance it
  came from.
