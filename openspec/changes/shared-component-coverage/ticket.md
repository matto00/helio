# HEL-440: Shared-component coverage: replace one-off UI with shared primitives

## Description

`DESIGN.md` §6 lists the canonical primitives in `frontend/src/shared/ui/` (Modal, TextField, Textarea, Select, EmptyState, Toast, DataGrid) and chrome in `frontend/src/shared/chrome/` (Popover, ActionsMenu, SidebarItemList, StatusMessage, InlineError, SaveStateIndicator, AccentPicker) and says: "Use these; do not hand-roll equivalents." Older feature code still hand-rolls raw `<input>`/`<select>`/`<table>`/modal markup instead of the primitives, breaking §6 (raw-element detection) and §5 button recipes.

## Scope

* Inventory hand-rolled equivalents across `features/` (sources, pipelines, dataTypes, panels editors, dashboards) — raw `<input>`/`<textarea>`/`<select>` not routed through `TextField`/`Textarea`/`Select`, raw `<table>` where `DataGrid` fits, bespoke modal markup not using shared `Modal`, and ad-hoc menus not using `ActionsMenu`/`Popover`.
* Migrate each to the shared primitive, preserving behavior and props. Where a primitive is genuinely missing a capability, extend the primitive rather than forking it, and call that out in the PR.
* Normalize buttons to the four §5 recipes (Primary/Secondary/Ghost/Danger) at `--control-sm/md` height, `--app-radius-sm`, `--weight-medium`, `--text-xs/sm`. No new button styles.
* Every `font-size`/color/spacing introduced during migration uses tokens (defer to the token-audit ticket for pre-existing drift, but do not add new violations).

## Acceptance Criteria

* No feature renders a raw `<input>`/`<select>`/`<textarea>` for a standard form control where the shared primitive applies; verified by an updated raw-element guard test.
* Loading/empty/error states in migrated views go through `EmptyState`/`StatusMessage`/`InlineError`/spinner per §7.
* Buttons in touched views match one of the §5 recipes; no bespoke button CSS remains in those files.
* Existing feature behavior unchanged; `npm test` and `npm run lint` pass with zero new warnings.

## Out of Scope

* Building brand-new primitives beyond small extensions needed for parity (e.g. a shared `Button` component is a separate future decision).
* Pure token drift unrelated to component replacement (token-audit ticket, HEL-439 — already shipped).

## Dependencies

Coordinate merge order with the token-audit ticket (HEL-439 — already merged) to minimize churn.

## Reconciliation note (added at Planning, HEL-440 run)

Per operator instruction, this ticket's Planning phase must explicitly reconcile scope against overlapping siblings HEL-725, HEL-708, HEL-720 before drafting proposal/design/tasks, and record the decision on the Linear tickets. See `design.md` for the recorded decision and reasoning.
