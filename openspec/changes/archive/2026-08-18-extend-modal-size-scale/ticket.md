# HEL-716: Extend Modal's size scale and retire PanelCreationModal/PanelDetailModal's hand-rolled <dialog> lifecycles

## Description

From the beta UI/UX polish sweep (PR #382).

**Scope**
`PanelCreationModal` and `PanelDetailModal` each hand-roll their own `<dialog>` open/close lifecycle (native `showModal`/`close`, backdrop-click, Escape handling) instead of using the shared `Modal` primitive, causing subtly divergent animation/backdrop/focus-trap behavior from every other modal in the app. `Modal` currently only supports sizes sm/md/lg, which doesn't cover these two wizard-scale surfaces.

* Extend `Modal`'s size scale (e.g. add `xl`/`full`) to cover wizard-scale content.
* Migrate `PanelCreationModal` and `PanelDetailModal` onto `Modal`, removing their duplicated `<dialog>` lifecycle code.

## Acceptance Criteria

* Both modals open/close/animate/trap-focus identically to every other `Modal`-based surface in the app.
* No hand-rolled `<dialog>` element remains outside `shared/ui/Modal.tsx`.

## Metadata

- Priority: Medium
- Parent: HEL-346
- Project: Helio v1.7 — UI/UX Cohesion & Authoring
- URL: https://linear.app/helioapp/issue/HEL-716/extend-modals-size-scale-and-retire
