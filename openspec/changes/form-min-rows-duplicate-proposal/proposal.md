## Why

HEL-1618 holds a multi-field form panel to at least 5 rows on the desktop grid (a compact counter keeps 4), and the
backend auto-layout already clamps forms to 5. Three backend paths still create a form panel below 5 rows because
they copy a height verbatim: panel duplicate, proposal apply, and `PUT /api/dashboards/:id/contents`. A form created
that way clips its fields and submit button until someone resizes it.

## What Changes

- Panel duplicate (`POST /api/panels/:id/duplicate`): a duplicate of a form that is not a compact counter gets at
  least 5 rows in every breakpoint. The copy is appended below every stored item, so growing it never moves or
  overlaps another panel. A compact counter keeps its source's height.
- Proposal apply (`DashboardProposalService.apply`, combined-proposal apply through it) and replace contents
  (`PUT /api/dashboards/:id/contents`, owner ruling: in scope): an authored `lg` placement of a non-counter form
  below 5 rows grows to 5 only when the space directly below it is free of other authored panels (the client's
  `liftResizedForm` rule); otherwise it keeps its authored height. No other panel moves. md/sm/xs are reflowed from
  the result as today.
- One backend compact-counter predicate that matches the client's `isCompactCounterConfig` exactly (exactly one
  field and its control is `counter`), and one shared form-minimum-rows rule both paths use.
- Unchanged, pinned by guard tests: dashboard import (owner ruling) and dashboard duplicate
  (`POST /api/dashboards/:id/duplicate`, owner ruling `exclude-with-guard-test`) keep the saved layout as saved.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `form-panel-rendering`: "A form panel is sized for a grid cell" now requires panel duplicate, proposal apply and
  replace contents to hold a non-counter form to 5 rows (lift-when-free for authored placements), and states that
  import and dashboard duplicate keep saved heights.

## Impact

- Backend only: `services/panels/CreatePlacement.scala`, `services/proposals/ProposalLayoutSupport.scala`,
  `services/panels/PanelLifecycleWrites.scala`, `infrastructure/persistence/panels/PanelMutationRepository.scala`,
  `services/proposals/DashboardProposalService.scala`, `services/dashboards/DashboardContentsService.scala`,
  `domain/panels/FormPanel.scala` (predicate), plus tests. No API shape change, no migration, no frontend change.
