# HEL-249: Remove Divider panel type

Remove the Divider panel type. Low value, takes up creation-modal real estate, doesn't fit the data-bound-panel narrative.

## Scope

* Remove `divider` from the panel-type picker in `PanelCreationModal`
* Remove `divider` from `PANEL_TEMPLATES`
* Remove `DividerConfigField`, `DividerOrientation`, `DividerTypeConfig` if unused after
* Remove backend `divider*` fields if Panel model has them and no other code paths read them. Otherwise leave the column in place to avoid a migration; just stop offering the type at creation.
* Existing divider panels in the wild (if any): leave them rendering — don't delete data — but no new ones can be created.

## Definition of done

* Divider not in panel-type picker
* Codebase cleanup of dead UI/types
* Backend either cleanly removed or explicitly documented as legacy-only

## Out of scope

* Canvas / creative-tools panel sub-type (separate roadmap ticket)

## Additional orchestrator context

- Epic: HEL-239 (v1.5 Panel System v2)
- Small, independent ticket — minimal overlap with parallel work.
- Running in parallel with HEL-243 (Metric config redesign): minimal overlap expected, but if both touch the panel-type picker, rebase onto origin/main before finalizing at delivery.
- Decide and document explicitly: fully remove DividerPanel domain/config code, or hide-from-creation-only for back-compat. Hiding-not-deleting is usually safer for back-compat unless the ticket's scope items indicate otherwise (ticket says remove config fields/types "if unused after" removal from picker/templates — so those can go; only the backend persisted-type/column should stay if other code paths would otherwise need a migration).
- Bind to DESIGN.md for any frontend change.
- Delivery protocol: repo auto-merge is disabled; the human handles merges. Present the PR and pause at delivery — do not merge. If a rebase requires a force-push, pause and ask the human directly rather than routing it through a relayed approval.
