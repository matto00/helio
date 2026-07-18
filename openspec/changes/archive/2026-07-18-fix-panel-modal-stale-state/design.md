# Design — fix-panel-modal-stale-state (HEL-307)

## Context

`PanelDetailModal` (`frontend/src/features/panels/ui/PanelDetailModal.tsx`) seeds all form state via
`useState(initial*)` computed from the `panel` prop — title (line 83), background/color/transparency
(84–86), `chartAppearance` (87) — and each subtype editor (`BindingEditor`, `MarkdownEditor`,
`TextContentEditor`, `ImageEditor`, `DividerEditor`, `CollectionEditor`, plus the
`useBoundOrLiteralState` / `useChartDisplayState` / `useTableDisplayState` hooks underneath them)
does the same with its own `useState(initial*)` seeds. `useState` initializers run only on mount.

Both call sites render the modal without a `key`:

- `DesktopPanelGrid.tsx:285–290` — `{detailPanelId !== null ? <PanelDetailModal panel={panels.find(...)!} ... /> : null}`
- `MobilePanelStack.tsx:128–130` — `{detailPanel ? <PanelDetailModal panel={detailPanel} ... /> : null}`

When `detailPanelId` changes A→B while the modal is mounted, React reuses the instance; every state
seed keeps A's values while `panel` (and `panel.id`) now point at B. `handleEditSubmit`
(PanelDetailModal.tsx:189–225) then dispatches the staged appearance payload **unconditionally**
against `panel.id` — so a save in the stale state writes A's title/appearance onto B. This is the
data-corruption path called out in the ticket; the fix removes it structurally.

`usePanelDetailModalLifecycle` calls `showModal()` in a mount-only effect and never resets form
state on panel change, confirming nothing else compensates.

## Goals / Non-Goals

**Goals**: form state always matches the shown panel; no cross-panel save; regression test.
**Non-goals**: preserving unsaved edits across a switch; restructuring modal state; any
`PanelDetailModal.css` churn (HEL-309 owns that).

## Decisions

1. **Fix at the call sites with `key={panel.id}`** (both `DesktopPanelGrid` and `MobilePanelStack`).
   A keyed remount resets the *entire* subtree in one move: modal mode, dirty flags, discard-warning
   state, and every subtype editor's internal state — including `useBoundOrLiteralState` and the
   chart/table display hooks — with zero per-field code. The mount-only `showModal()` effect re-runs
   on remount, so the dialog stays open across the switch.
   - *Alternative rejected*: `useEffect` watching `panel.id` that calls `resetFormToPanel()`. It
     covers only the modal's own five state atoms; every subtype editor would need its own reset
     effect (or an extended imperative-handle contract), and future editors would silently regress.
     Keyed remount is the idiomatic React solution for identity-keyed state.
   - *Alternative rejected*: guarding `handleEditSubmit` with a captured id. Fixes corruption but
     leaves the stale display; and the keyed remount already removes both.
2. **Executor must probe-confirm before fixing** (systematic-debugging Iron Law): reproduce the
   stale title on the live app (or a component test) against unfixed code, confirm the instance-reuse
   root cause, then apply the fix and show the same probe passing.
3. **Regression test lives at the call-site composition level.** A component test that renders a
   harness switching the `panel` prop identity the way the grid does (conditional render keyed by
   panel id), asserting: (a) B's values appear in title/appearance/binding fields after a direct
   switch; (b) a save-after-switch dispatches nothing containing A's staged values against B's id.
   Follow the established patterns in `PanelDetailModal.*.test.tsx`.
4. **Audit, don't patch, the remaining fields.** The executor verifies by inspection (and spot
   probes) that every editor's state is component-local under the keyed subtree — i.e. nothing
   caches panel-keyed form state in a module singleton or Redux that would survive remount. Expected
   result: keyed remount covers everything; if an exception is found, fix it and note it.

## Risks / Trade-offs

- [Remount discards A's unsaved edits silently] → Accepted and spec'd: matches close-then-reopen;
  the discard warning only guards explicit close/cancel paths today.
- [Remount re-runs `usePanelData` fetch for B] → Same cost as close-then-reopen; acceptable.
- [`panels.find(...)!` non-null assertion at the desktop call site] → Unchanged behavior; out of
  scope.

## Migration Plan

Frontend-only, two-line fix + tests. No rollout concerns; revert = drop the `key` props.

## Planner Notes (self-approved)

- Discard-on-switch (no warning) chosen over prompting: switching panels while the modal is open is
  the same user intent as closing and reopening; adding a prompt would expand scope.
- No spec delta for `panel-edit-mode-save-cancel`: the save/cancel flow itself is unchanged.

## Open Questions

None.
