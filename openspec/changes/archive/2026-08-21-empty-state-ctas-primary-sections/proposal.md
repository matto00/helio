## Why

`DESIGN.md` §7 requires every data-backed view to render an `EmptyState` — never nothing. Coverage across
the five primary sections is uneven: the Type Registry's empty state teaches the model but offers **no
CTA**; every filter-to-zero state renders a bare `<p>No matches</p>` instead of the primitive; and the
panel area renders **literally nothing** after a dashboard's last panel is deleted — a gap HEL-528's
`design.md` D11 traced, locked with a test, and assigned to this ticket by name. HEL-770 (deferred only
because `PanelList.tsx` was mid-rewrite) edits the same branch and is absorbed here.

## What Changes

- **Type Registry** gains a real CTA — "New pipeline", honoring source→pipeline→type→panel — on both its
  main-content and sidebar empty states. No dead "create type" path is offered.
- **Filter-empty becomes a first-class state**, visually and verbally distinct from no-data-yet, on the
  three surfaces that can filter to zero (`DashboardList`, `SidebarItemList`, `DataTypeSelectStep`):
  `EmptyState` with the query quoted and a "Clear filter" CTA, replacing today's bare `<p>`.
- **The panel area's terminal blank is closed.** `panelsSlice` gains a `staleDashboardId` discriminator so
  the post-delete terminal state is distinguishable from the pre-dispatch frame — the exact fact D11 said
  did not exist. The empty state renders in the first; the skeleton (not an empty state) closes the second.
- **HEL-770 absorbed**: `createDashboard`'s thunk starts producing a real message instead of a fixed string;
  `PanelList`'s failure surface gets conditional `intent="error"` parity (error title + icon + that
  message), `DashboardList`'s gets `variant="banner"` so it is announced at all, and only then does
  `createDashboard.rejected` leave `ERROR_TOASTS`.
- **A consumable CTA seam for HEL-554**: each create action becomes a hook returning one uniform shape —
  an `EmptyStateCta` descriptor plus the action's own `error`/`isPending` — so a failed create is surfaced
  rather than swallowed; the panel-creation modal's open state lifts into Redux, matching its three
  sibling modals, and is cleared on unmount so it cannot re-open unbidden.
- Empty-state icons on the five sections move to `lucide-react`, matching their already-lucide error states.

## Capabilities

### New Capabilities

- `empty-state-cta-pattern`: the cross-section standard — main variant, Fraunces title, one §5 primary CTA,
  lucide icon, tokens only, the 44px floor, and the filter-empty vs no-data-yet distinction.
- `workspace-create-actions`: create actions exposed as reusable descriptor-returning hooks (the HEL-554 seam).

### Modified Capabilities

- `frontend-panel-empty-state`: renders in the invalidated/terminal state, not only on a resolved status;
  gains conditional error-intent parity for a failed dashboard create.
- `loading-state-pattern`: the panel list's initial-load condition is no longer "in-flight only" — the new
  discriminator lets it cover the pre-dispatch frame while still never showing a skeleton in either
  no-fetch-coming state.
- `toast-emission-integrity`: `createDashboard.rejected` is reported inline on both paths, never as a toast.
- `sidebar-dashboard-filter`: filter-to-zero renders `EmptyState`, distinct from no-dashboards-yet.
- `panel-creation-datatype-empty-state`: its filter-to-zero state renders `EmptyState`.
- `datasource-ux-empty-states`: the registry empty state directs toward creating a **pipeline** and carries
  a working CTA — retiring a requirement that said "add a data source", which was already false of the
  shipped copy and wrong under source→pipeline→type→panel.

## Impact

`frontend/src/features/{dashboards,dataTypes,panels,pipelines,sources}`, `shared/chrome/SidebarItemList`,
`shared/chrome/SidebarBody`, `features/toasts/state/toastListeners.ts`, and `test/renderWithStore.tsx`
(which enumerates the panels slice field-by-field, so the new field must be threaded there). No backend,
schema, or HTTP API change. Two shared components gain an additive prop surface: `SidebarItemList` gains
`emptyCta` and widens `emptyIcon` to `IconDefinition | ReactNode`. `shared/ui/EmptyState.tsx` gains **one
type-only export** (`EmptyStateCta`, today declared without `export`); its rendering and props are
otherwise untouched. `DESIGN.md` is **not** edited (HEL-774 owns it this session).
