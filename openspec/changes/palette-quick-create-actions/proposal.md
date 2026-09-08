## Why

The command palette can navigate but cannot create. Meanwhile HEL-548 already shipped four create-action
seams (`useCreateDashboardAction`, `useAddSourceAction`, `useCreatePipelineAction`, `useCreatePanelAction`),
so the dispatch half of quick-create exists and is unused by the palette. The blocker is reach: of the four
flows, only `CreatePipelineModal` is mounted at the app shell, so the other three would silently no-op from
any route but their own — advertising capability the palette does not have.

Separately, `KeyCap` (HEL-510) renders only in the help overlay, so the palette shows no caps for its own
shortcut-bearing actions. The owner ruled that gap closes here rather than becoming a follow-up.

## What Changes

- Register a "Create" section of `CommandAction`s consuming the four existing HEL-548 seams. No creation
  logic is written or duplicated.
- **Mount `AddSourceModal` and `OutputPicker` at the app shell**, following the F-045 precedent already
  established for `CreatePipelineModal` (`App.tsx:200-209`) — skipping the route that mounts its own
  instance, so the dialog is never doubled. This makes the actions work in place, from any route, with no
  unrequested navigation.
- Gate "New panel" on a non-null `selectedDashboardId`, which the `useCreatePanelAction` seam already
  reports as `disabled` and which `OutputPicker`'s required `dashboardId` prop demands anyway.
- Extend `CommandAction` with an optional shortcut-combo field, and render it in the palette through the
  existing `shared/ui/KeyCap` primitive. No second cap component, no re-declared cap styling.

## Capabilities

### New Capabilities

- `palette-quick-create`: creating a dashboard, source, pipeline, or panel from the command palette,
  available from any route, with availability reflecting whether the target context exists.

### Modified Capabilities

- `command-action-registry`: actions may declare a keyboard shortcut for display, and the palette presents
  it.
- `workspace-create-actions`: the create-action seams gain a second consumer (the palette) alongside empty
  states, and the surfaces they open become reachable from outside their owning route.

## Impact

- `frontend/src/features/commandPalette/model/{types.ts,builtInActions.ts}` — shortcut field, Create actions.
- `frontend/src/features/commandPalette/ui/CommandPalette.tsx` / `.css` — render `KeyCap` per action.
- `frontend/src/app/App.tsx` — shell-mount `AddSourceModal` and `OutputPicker`, route-skipped.
- `frontend/src/app/CommandBar.tsx` — correct a comment falsified by shell-mounting, and a stale
  `title="Assistant (Ctrl/Cmd+K)"` that contradicts the declared Cmd/Ctrl+J binding.
- `frontend/src/features/panels/ui/PanelList.tsx` — its unmount cleanup resets `panelCreationModalOpen`;
  must not fight a shell-mounted instance.
- The four HEL-548 seams — consumed as-is where possible, extended (never forked) if a call site needs it.
- No backend, wire, or schema impact. Downstream: HEL-519 and HEL-503 inherit the `CommandAction` shape.

## Non-goals

- Redesigning the creation modals (HEL-347), or inline creation without the existing modal.
- Collapsing `DashboardList`'s named-create form into the immediate-create seam — HEL-548 D5 deliberately
  kept those separate.
- HEL-1028 and HEL-1029, both filed and explicitly out of scope.
