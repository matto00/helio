## Why

`.panel-list__add` renders below the 44px mobile touch-target floor
(DESIGN.md §8) because `PanelList.css` never got the
`@media (max-width: 768px) { min-height: 44px }` floor rule that
`EmptyState.css` established for its CTAs. This is the seventh instance of
this exact gap in this repo; it must be fixed and audited for siblings.

## What Changes

- Add a `@media (max-width: 768px)` floor rule (`min-height: 44px`) to
  `.panel-list__add` in `frontend/src/features/panels/ui/PanelList.css`,
  placed AFTER the base rule, following `EmptyState.css:219-228`.
- Audit sibling header controls in `PanelList.css` for the same gap; fix any
  found the same way.
- No behavioral/API change — pure CSS presentation fix, verified by
  rendered-height measurement, not by reading declared CSS.

## Capabilities

### New Capabilities

`panel-list-mobile-touch-targets`: interactive controls in the panel-list header and its adjacent zoom widget meet the 44px mobile touch-target floor

### Modified Capabilities

(none — pure CSS presentation fix, no spec-level behavior change)

## Impact

- `frontend/src/features/panels/ui/PanelList.css` only (plus any sibling
  controls the audit finds in the same file).
- No backend, API, or schema impact.

## Non-goals

- Building the mechanical guard (static CSS test / runtime sweep) suggested
  in the ticket as "worth considering" is not committed scope here — see
  design.md for the scoping call.
