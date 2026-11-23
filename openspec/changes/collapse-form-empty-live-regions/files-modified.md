- `frontend/src/features/panels/ui/form/FormPanel.css` — field stack `position: relative` plus out-of-flow rule for empty alert/status direct children; misleading comment rewritten
- `frontend/src/features/panels/ui/form/FormPanelView.tsx` — `onReconciled` hook on `reconciliationTail` and per-burst rejection flag (clears a stale cross-burst error)
- `frontend/src/features/panels/ui/form/FormPanelView.test.tsx` — tests (a) red-first, (b)/(c) mutation-checked guards
- `frontend/src/features/panels/ui/form/FormPanel.css.test.ts` — CSS source-shape guard
- `e2e/hel1819-form-live-region-gap.spec.ts` — geometry, in-flow message and per-kind height table checks (new spec because HEL-1826 has not merged)

D1 absolute-descendant grep: shared/ui controls used by the form: only `.ui-toggle__input` (1px sr-only checkbox) is absolute with no positioned ancestor; its containing block moves to the field stack, which is harmless. `IconButton::after` is under its own `position: relative`; `Select` portals its popover out of the form.
