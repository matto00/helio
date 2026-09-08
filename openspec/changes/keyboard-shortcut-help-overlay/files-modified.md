- `frontend/src/shared/chrome/shortcuts.ts` — `ShortcutCombo` extended to `{ key, mod?, shift? }`
  (tri-state Shift, design.md Decision 2); `ShortcutDeclaration` gains required
  `description`/`group`; added `help-overlay`/`layout-undo`/`layout-redo` declarations; added
  `isOverlayOpen()`, `isMacPlatform()`, `formatCombo()`.
- `frontend/src/shared/chrome/shortcuts.test.ts` — updated for the `meta`->`mod` rename (required,
  not a defect-symptom edit), plus new coverage for tri-state Shift, `isOverlayOpen`, and
  `formatCombo`, including the two round-1/round-2 regression-guard assertions tasks.md 1.3 calls
  for.
- `frontend/src/shared/chrome/useShortcut.ts` — NEW. The runtime binding layer: a module-singleton
  registry owning the one physical `window` keydown listener (design.md Decision 3), and
  `useShortcut(id, handler, opts)` with the frozen option contract (design.md Decision 1). Works
  without any wrapping provider component, which is what keeps `useLayoutUndoRedo.test.ts`
  passing unmodified.
- `frontend/src/shared/chrome/useShortcut.test.ts` — NEW. Unit coverage for the unknown-id throw,
  near-miss combo, `when: false`, both `allowWhileTyping` forms, `guardWhileOverlayOpen`, and
  unregistration on unmount.
- `frontend/src/features/commandPalette/GlobalCommandShortcuts.tsx` — migrated onto `useShortcut`;
  deleted its own `window.addEventListener`. Neither binding sets `guardWhileOverlayOpen`
  (design.md Decision 4 table).
- `frontend/src/features/commandPalette/ui/CommandPalette.test.tsx` — added a guard test that
  Cmd/Ctrl+K still fires while the palette is open, with focus inside its own search input
  (tasks.md 3.1). Every pre-existing test in this file is unmodified.
- `frontend/src/features/layout/hooks/useLayoutUndoRedo.ts` — migrated onto
  `useShortcut("layout-undo"/"layout-redo", ...)`; deleted the private `isEditableFocused` in
  favor of the shared typing guard. `useLayoutUndoRedo.test.ts` passes unmodified.
- `frontend/src/features/layout/hooks/useLayoutUndoRedo.regression.test.ts` — NEW. Labelled
  regression guard: with an undo target present and NO redo target, `mod+shift+z` must change
  nothing (redo's own `!redoTarget` guard no-ops; undo must not fall through and fire). Failable
  by mutation — flip `layout-undo`'s `shift: false` to omitted and this test goes red; re-verified
  by hand for cycle 2 (evaluation-1.md CR1: the cycle-1 single-case version dispatched
  mod+shift+z only after undo had already consumed its target, so the mutation was absorbed by
  `useLayoutUndoRedo.ts`'s own `!undoTarget` early return and stayed green).
- `frontend/src/shared/chrome/HelpOverlay.tsx` — NEW. The help overlay (`HelpOverlay`) built on
  `shared/ui/Modal`, deriving rows from `shortcuts.ts` alone; `HelpOverlayHost` wires `?` via
  `useShortcut("help-overlay", ..., { guardWhileOverlayOpen: true })` and registers with
  `useOverlay()` (design.md Decision 4a), plus a `useHelpOverlay()` context so the palette action
  can open it too.
- `frontend/src/shared/chrome/HelpOverlay.css` — tokens only; `:focus-visible` /
  `var(--app-focus-ring)` per HEL-1022/DESIGN.md §8, matching `CommandPalette.css:80-82`.
  skeptic-final-1.md CR1 (BLOCKING, fixed): `.help-overlay__rows` is a `<ul>` that had no list
  reset, so it inherited the UA defaults `padding-inline-start: 40px` / `margin: 16px 0` — rows
  rendered 40px right of their own group eyebrow and the `--space-2`/`--space-4` rhythm was
  silently doubled. Added `list-style: none; margin: 0; padding: 0` (the reset every sibling list
  in the app already carries, matching `CommandPalette.css:45-52`). Hand-verified: removed the
  reset, confirmed `padding-left` computed to `40px` in the running app and the new e2e test went
  red; restored the reset and confirmed both went back to `0px`/green. No other list-ish element
  in this file was missing the reset (only one `<ul>` exists in `HelpOverlay.tsx`).
  Worth registering: this specific defect falsifies this file's own header comment ("tokens only,
  no hardcoded spacing") — the hardcoded spacing was *inherited*, not written, which is exactly
  why a source-text scan (like `KeyCap.css.test.ts`'s) could never have caught it. Left the
  header comment as-is (it's still true about what this file writes) and did not extend
  `KeyCap.css.test.ts` to scan `HelpOverlay.css`, since a naive source-text extension would not
  have gone red on this defect either (nothing was written) and would be evidence-shaped, not
  real protection. The honest guard is the new e2e computed-style assertion below.
- `frontend/src/shared/chrome/HelpOverlay.test.tsx` — NEW. Render test asserting one row per
  `shortcuts.ts` declaration, plus group-label coverage.
- `frontend/src/shared/ui/KeyCap.tsx` / `frontend/src/shared/ui/KeyCap.css` — NEW shared primitive (design.md Decision 5):
  a semantic `<kbd>`, drawing padding from `--space-*` tokens rather than a hand-copied literal.
- `frontend/src/shared/ui/KeyCap.css.test.ts` — NEW. Token check (no hardcoded color/px literal) —
  necessary but not sufficient for cohesion; see the screenshots below for that.
- `frontend/src/features/commandPalette/model/builtInActions.ts` — added
  `buildShortcutsHelpAction`, making the help overlay discoverable from the palette.
- `frontend/src/features/commandPalette/model/builtInActions.test.tsx` — extended for
  `buildShortcutsHelpAction`.
- `frontend/src/features/commandPalette/BuiltInCommandActions.tsx` — wires the new action to
  `useHelpOverlay()`.
- `frontend/src/app/App.tsx` — mounts `HelpOverlayHost`, wrapping `GlobalCommandShortcuts`,
  `BuiltInCommandActions`, and `CommandPalette` inside `AppShell` (authenticated-route-only).
- `e2e/hel510-keyboard-shortcuts.spec.ts` — NEW. Real-browser proof of cases (a)-(g) from
  tasks.md 5.1 (7 cases in 6 tests: (b)+(c), Esc-closes and focus-restore, are merged into one
  test). `?` opens the overlay, Esc closes + restores focus, Tab/**Shift+Tab** stay trapped (both
  directions actually pressed, not just Tab — evaluation-1.md's "cheap, do it" note), `?` is
  suppressed while typing and while the palette is open, and Cmd/Ctrl+K still opens the palette
  while it's already open. Cycle-3 addition (skeptic-final-1.md CR1): a 7th test asserts, via
  `getComputedStyle`, that `.help-overlay__rows` resolves `padding-left`/`margin-top`/
  `margin-bottom` to `0px` and `list-style-type` to `none`, plus the discriminating geometry
  assertion (rows' `x` within 2px of their group eyebrow's `x`) — the honest guard for an
  inherited-UA-default defect that jsdom cannot resolve and a source-text scan cannot see.

- `openspec/changes/keyboard-shortcut-help-overlay/design.md` — skeptic-final-1.md non-blocking
  CR (fixed): Decision 1/3 and the Migration Plan described a "provider-held" `Map`, but what
  shipped is a module-level singleton in `useShortcut.ts` (behaviorally equivalent from every
  caller's point of view, and it's what lets `useLayoutUndoRedo.test.ts`/`CommandPalette.test.tsx`
  pass without wrapping themselves in any provider component). Corrected the doc to describe the
  shipped shape, since this is the published reference HEL-516/519/503 will read.

Two further non-blocking notes from skeptic-final-1.md, deliberately left as-is rather than
changed in this cycle: a dev-time warn for a duplicate `useShortcut` id (currently a silently
dead second binding) would be a genuine small improvement but isn't required by any acceptance
criterion here; `ShortcutDeclaration.label` is currently write-only (nothing reads it — the
overlay renders `description`, not `label`). Both are candidates for a follow-up rather than
in-scope fixes for HEL-510.

## Visual-cohesion evidence (task 5.2)

The 8 screenshots (command palette + help overlay, resting/hover/focus, light and dark) were
generated during cycle 1 but are **not tracked in this repository** (evaluation-1.md CR2): the
repo's `*.png` gitignore rule is a curated allowlist with four explicit `!` negations, none of
which cover `openspec/**`, so committing them would have been the first-ever, ~800KB permanent
exception to that allowlist. They are durably persisted outside the repo at
`.concertino/runs/HEL-510/evidence/openspec/changes/keyboard-shortcut-help-overlay/screenshots/`
(8 files: `palette-resting-{light,dark}.png`, `palette-hover-{light,dark}.png`,
`help-overlay-resting-{light,dark}.png`, `help-overlay-focus-{light,dark}.png`). Conclusion
reached from them, restated here since the images themselves aren't in the diff: the help overlay
reads as a member of the existing `Modal`/command-palette family in both themes — same
header/close-button chrome, matching `:focus-visible`/`--app-focus-ring` treatment. No cohesion
escalation was needed.

## Known limitation / evidence (task 5.3, evaluation-1.md CR3)

Task 5.3 asks for a real-browser confirmation that layout undo AND redo still work after the
`useLayoutUndoRedo` migration. My own cycle-1 check was a shallow smoke test (pressed
Ctrl+Z/Ctrl+Shift+Z with no panel ever dragged, confirming only "no crash") and that limitation
was never written down in any committed artifact — this section is that write-up.

The evaluator's own Phase 3 real-browser probe supersedes it and is what actually closes 5.3: a
real drag on the real resize/drag handle, a real `Ctrl+Z` keypress, `event.defaultPrevented ===
true`, the undo history stack consumed, and redo becoming enabled afterward — i.e. the
`useShortcut`-migrated undo/redo dispatches correctly at the store/history level in a real
browser. Task 5.3 stands satisfied on that evidence.

Separately, and explicitly OUT OF SCOPE for this ticket (per evaluation-1.md, filed as
**HEL-1028** rather than fixed here): the grid does not visually re-render/revert on screen after an
undo/redo dispatch, even though the store and history update correctly. The evaluator reproduced
this via the untouched header Undo/Redo buttons in `app/CommandBar.tsx`, confirming it predates
this migration and is not something this ticket introduced.

A second out-of-scope defect was found by the evaluator and filed as **HEL-1029**: `shared/ui/Modal`
opens with a focus ring around its `<h2>` heading whenever the body has no focusable content, because
`<dialog>.showModal()` focuses the `tabIndex={-1}` title. The help overlay is such a consumer, so it
shows this at rest. It was proved structural to `Modal` (synthetic same-shape dialog in the live page),
NOT specific to this ticket, and was deliberately not worked around locally in `HelpOverlay.css` — doing
so would have hidden a shared defect behind one consumer's stylesheet.
