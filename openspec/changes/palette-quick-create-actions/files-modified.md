# Files modified — HEL-516

## Source

- `frontend/src/app/App.tsx` — shell-mounts `AddSourceModal` (skipped only on the exact route
  `/sources`) and `OutputPicker` (skipped only on the exact route `/`, gated on
  `selectedDashboardId !== null` and a new `currentDashboardPanelsReady` check), following the
  existing F-045 `CreatePipelineModal` precedent (design.md D1/D3). Registers the new
  `CreateCommandActions` component alongside `BuiltInCommandActions`.
- `frontend/src/features/commandPalette/CreateCommandActions.tsx` — **new**. Calls all four
  HEL-548 create-action seams unconditionally at top level (Rules of Hooks, following
  `usePickerSelection.ts`'s prior art) and registers the resulting `CommandAction`s via
  `useCommandActions`. Writes no creation logic.
- `frontend/src/features/commandPalette/model/builtInActions.ts` — adds `buildCreateActions`
  (builds the "Create" section straight off the seams' own `CreateActionResult`, omitting the
  panel action entirely when its seam reports `disabled`) and attaches the quick-launcher's
  declared `ShortcutCombo` (read by id, not re-typed) to `buildOpenAssistantAction`'s result.
- `frontend/src/features/commandPalette/model/types.ts` — `CommandAction` gains an optional
  `shortcut?: ShortcutCombo` field (design.md D5).
- `frontend/src/features/commandPalette/ui/CommandPalette.tsx` — renders a `KeyCap` per token of
  an action's `shortcut`, inline after the title (never right-aligned), via the existing
  `formatCombo` + `shared/ui/KeyCap` pipeline — the same one the help overlay uses.
- `frontend/src/features/commandPalette/ui/CommandPalette.css` — spacing between the title text
  and its first `KeyCap`; no rule reserves space for an absent cap.
- `frontend/src/features/panels/state/panelsSlice.ts` — extracts `panelsMatchDashboard` (was an
  inline clause of `PanelList`'s `showPanelGridSkeleton` expression) into a shared, exported
  predicate so the app-shell `OutputPicker` mount and `PanelList` can't drift apart (design.md
  D3b).
- `frontend/src/features/panels/ui/PanelList.tsx` — uses the extracted `panelsMatchDashboard`
  in place of its own inline condition (behavior-preserving).
- `frontend/src/features/sources/hooks/useAddSourceAction.tsx` — the seam's `onClick` now checks
  for an already-open, DOM-visible `AddSourceModal` (covers the nested case: `CreatePipelineModal`
  / `AddRootModal` render their own `AddSourceModal` from local state, independent of this seam's
  flag — design.md Decision 7 / CR6) before setting `addModalOpen`, so running "Add source" while
  a nested instance is open never doubles it.
- `frontend/src/app/CommandBar.tsx` — corrects the now-false comment on the "Add panel" kebab's
  `onDashboardView` gate (the gate itself is KEPT, owner ruling, design.md D6) and derives the
  quick-launcher's tooltip string from the `shortcuts.ts` declaration by id instead of the stale,
  hand-typed `"Assistant (Ctrl/Cmd+K)"` literal (task 6.4b) — the binding is actually Cmd/Ctrl+J.

## Tests

- `frontend/src/app/App.test.tsx` — `renderApp` extended to optionally preload
  `sources`/`panels`/`dashboards` state; new `describe` blocks proving (a) `AddSourceModal`/
  `OutputPicker` reach off-route and non-doubling on their owning route (DOM presence, jsdom-
  legitimate), (b) the shell mount withholds the picker when the store's panels belong to a
  different dashboard and re-dispatches the fetch, and (c) the design.md D3a StrictMode-masked
  production defect guard (task 1.3a) — a render-level, no-`StrictMode` test proving the modal
  opens in place on `/sources/:id` and, after dismissal via `onClose`, leaves no dialog on a later
  `/sources` visit. Verified failable by mutation (shell mount temporarily deleted, guard went
  red, restored, green again) during development.
- `frontend/src/features/commandPalette/model/builtInActions.test.tsx` — tests for
  `buildCreateActions` (each action's `run` is exactly the seam's `cta.onClick`; the panel action
  is omitted, not merely disabled, when its seam reports `disabled`) and for
  `buildOpenAssistantAction`'s shortcut being the LITERAL declared combo (not derived from the
  same source on both sides of the assertion — CR8).
- `frontend/src/features/commandPalette/ui/CommandPalette.test.tsx` — an action with a `shortcut`
  renders one `KeyCap` per token; one without renders none.

## E2E (real-browser reach evidence)

- `e2e/hel516-palette-quick-create.spec.ts` — **new**, committed. Proves each create action from
  a route where its host is NOT mounted (source/panel from `/pipelines`, pipeline from `/sources`,
  dashboard with no navigation); proves "never presented twice" on each surface's own owning
  route; proves the design.md D3a positive-reach direction (`AddSourceModal` opens in place on
  `/sources/:id`) — cross-referenced to `App.test.tsx`'s 1.3a guard for the non-vacuous negative
  direction, per task 5.3.
- `e2e/hel516-screenshots.spec.ts` — **new**, committed. Captures the palette's Create section +
  KeyCap at rest/hovered/focused in both light and dark, plus the help overlay, into
  `.concertino/runs/HEL-516/evidence/` (gitignored) for the visual-cohesion review (task 5.4).

## Cycle 2 — evaluation-1.md change requests

- `frontend/src/features/commandPalette/CreateCommandActions.tsx` (CR1) — the four HEL-548 seams
  each build a fresh `CreateActionResult` object every render, so memoizing on THOSE objects'
  identity never actually hit: the `useMemo` recomputed every render, `useCommandActions`'s
  register/dispose effect churned every render, and each churn cycle reshuffled the palette's
  `Create`/`Navigation`/`General` section order non-deterministically (`commandRegistry.ts`'s
  `actionsById` is a `Map`, whose iteration order is insertion order — a dispose+re-register
  re-inserts at the end). Fixed by keeping a ref to each seam's latest result (updated every
  render, no effect) and memoizing the actions array on the PRIMITIVE values that determine its
  shape (each action's `label`, and `disabled` for panel), with `run` reading through the ref.
  Chosen over extending the seams themselves, so their other consumers
  (`usePickerSelection`, the sources/pipelines/panels empty states) are unaffected. (CR2) also
  hosts the nested-modal collision guard, moved here from the shared seam (see below).
- `frontend/src/features/commandPalette/CreateCommandActions.test.tsx` — **new**. Regression
  guard for CR1 (counts `notify()`-driven re-renders across 5 unrelated re-renders, rather than
  comparing final ID order, which can settle into the same order whether it churned once or
  many times — an earlier draft of this guard passed even against the buggy version for exactly
  that reason) and for CR2 (both branches of the collision guard, via DOM presence). Both
  mutation-verified during development (reverting the fix turned each red; restoring turned it
  green).
- `frontend/src/features/sources/hooks/useAddSourceAction.tsx` (CR2) — reverted to its original,
  unguarded form. The nested-modal collision check moved to the palette's own call site
  (`CreateCommandActions.tsx`) instead of living in this shared seam, so `SourcesPage`'s own
  button and the sources empty state are unaffected by a check that only the palette's new entry
  point needed.
- `frontend/src/features/sources/ui/AddSourceModal.tsx` (CR2) — exports
  `ADD_SOURCE_MODAL_ARIA_LABEL`, the modal's accessible name, so the collision guard reads it
  from a shared constant instead of a re-typed literal (renaming the label can no longer
  silently turn the guard into a no-op).
- `frontend/src/features/commandPalette/model/builtInActions.ts` — `buildCreateActions`'s
  parameter type narrowed to `Pick<CreateActionResult, "cta">` (CR1's ref-based wrapping only
  needs `cta`).
- `frontend/src/app/App.test.tsx` (CR3, CR4) — new test proving `currentDashboardPanelsReady`'s
  empty-dashboard fallback arm is reached and evaluates true for a genuinely-empty (zero-panel)
  dashboard off-route, mutation-verified. Also (CR4) replaced the unjustified `as never` type
  escape hatch on `configureStore`'s call: `preloadedState`'s sources/panels/dashboards slices
  are now always fully materialized (default state merged with the caller's overrides) instead
  of conditionally spread, whose inferred type included an "absent" branch `configureStore`
  couldn't reconcile against a reducer that never returns `undefined`.
- `e2e/hel516-palette-quick-create.spec.ts` — (CR1) added a real-browser section-order
  determinism test across 5 independent fresh boots; (CR2) added the real-browser nested-modal
  case task 1.5 asked for, with a `toPass`-based assertion that holds the dialog count at 1 for a
  full second rather than a bare `toHaveCount` (which resolves on the FIRST observed match — a
  naive version of this exact test false-passed during development by catching a transient
  window before the second dialog actually mounted, ~700-900ms later); (CR3) added the "already
  on this board" parity assertion task 1.2a originally asked for but was never written — proves
  the picker's off-route content matches `/`'s own post-fetch result for the same dashboard, not
  merely that it mounts. All three mutation-verified.

## Bug found and closed (not a new ticket — see design.md Decision 3a)

`SidebarBody.tsx:87` sets `sources.addModalOpen` from `/sources/:id`, where nothing was mounted
to read it. In dev, `main.tsx`'s `React.StrictMode` double-invocation clears the flag at
`SourcesPage`'s mount before render, masking the defect — a production build (no StrictMode)
would have opened the modal unbidden on arrival at `/sources/:id`. Shell-mounting `AddSourceModal`
closes it (the flag now has a reader on every route); the mutation-verified guard above regression-
guards it going forward.

## Cycle 3 — skeptic-final-1.md change requests

- `frontend/src/shared/chrome/HelpOverlay.tsx` (CR1) — **fix to already-merged HEL-510 code,
  found while investigating this ticket's own palette section-order artifact, not authored by
  this ticket.** `HelpOverlayHost` passed a fresh object literal as `HelpOverlayContext`'s
  value every render, so `useHelpOverlay().open`'s identity changed every render; since
  `buildShortcutsHelpAction` (a `builtInActions.ts` consumer) is called with that value inside
  `BuiltInCommandActions`'s own `useMemo`, every render of the shell churned that
  component's ENTIRE registration (dispose+re-register), pushing its actions to the tail of
  `commandRegistry.ts`'s insertion-order `Map`. Fixed by memoizing the context value on `[]`
  (the `setIsOpen` setter it closes over is already a stable `useState` setter).
- `frontend/src/features/commandPalette/model/builtInActions.ts` (CR1) — added
  `SECTION_DISPLAY_ORDER`, the palette's top-level section order declared as data in one place
  (defaults to `Navigation, General, Create` — the order once every registrant's own
  registration is stable). Changing the order is now a one-line edit to this array.
- `frontend/src/features/commandPalette/ui/CommandPalette.tsx` (CR1, CR2) — `groupBySection`
  now sorts its groups by `SECTION_DISPLAY_ORDER` instead of first-encountered order, so the
  palette's displayed section order is independent of any registrant's mount/render timing (an
  unlisted section still falls back to first-encountered order, appended after every listed
  one). Also (CR2) wraps a shortcut's `KeyCap` tokens in a new `.command-palette__item-combo`
  span so the title-to-combo spacing rule targets that wrapper instead of every individual
  `.ui-keycap` — the previous per-cap rule also widened the gap BETWEEN caps within the same
  combo, doubling the help overlay's 4px intra-combo spacing. `KeyCap` itself is untouched.
- `frontend/src/features/commandPalette/ui/CommandPalette.css` (CR2) — moved the title-to-combo
  margin rule to `.command-palette__item-combo`; intra-combo spacing is now owned solely by
  `KeyCap.css`'s pre-existing `.ui-keycap + .ui-keycap` rule, matching the help overlay exactly.
- `frontend/src/features/commandPalette/ui/CommandPalette.test.tsx` (CR1) — new render-level
  guard: sections render in the DECLARED order even when the underlying (already-ranked) action
  list encounters them in the wrong order first. Mutation-verified (reordering
  `SECTION_DISPLAY_ORDER` turns it red).
- `e2e/hel516-palette-quick-create.spec.ts` (CR1) — the determinism test now asserts the actual
  expected order (`["Navigation", "General", "Create"]`) on every boot, not merely that boots
  agree with each other (a consistently-wrong order would have satisfied the old assertion).
  Mutation-verified in a real browser: reverting the `HelpOverlay` fix no longer flips this test
  (the display-layer sort now absorbs that churn, which is the intended overall improvement),
  but reordering `SECTION_DISPLAY_ORDER` itself does turn it red — confirmed by running that
  exact mutation and observing `["Create", "Navigation", "General"]`.
