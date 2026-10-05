## Why

Only a single `POST /api/panels` for an Output panel stores a layout item. Every other create path leaves the
dashboard's stored `layout` without the new panel. A live probe showed this for text, markdown, image and divider
creates, for every `POST /api/panels/batch` item (Output included), and for panel duplicate. Proposal apply and
contents replace also omit panels that have no authored `lg` placement. Such an "orphaned" panel is placed only at
render. Its position moves whenever a later create is stored at the bottom of the stored items. A drag repairs only
the breakpoint being edited. The dev DB holds 15 orphaned panels across 7 dashboards.

## What Changes

- Server-side create-time placement for every create path:
  - single create of every kind;
  - batch create (every item);
  - panel duplicate;
  - proposal apply and contents replace, for panels without an authored layout.

  Each new panel is appended to every breakpoint, below that breakpoint's own stored items, at a kind default size.
  Every placed item passes the HEL-1071 validator. Placements are written atomically with no lost update.
- `POST /api/panels/batch` and `POST /api/panels/:id/duplicate` return the per-breakpoint `layouts` the server stored,
  as single create already does. The web client adopts them as a placement extension (HEL-1230 class 3).
- Owner ruling `extend-owner-repair` (HEL-1260 escalation, answered 2026-10-05) covers existing orphans. HEL-1233's
  once-on-open owner repair also fires for a breakpoint that is valid but missing a live panel. The client sends the
  displayed layout. The server accepts an "incomplete" breakpoint only as append-only:
  - every stored item for a live panel is unchanged;
  - entries for deleted panels may be dropped;
  - only missing live panels are added.

  Non-owners keep render-time placement. This reverses HEL-1233's "missing panels are never written by the repair".
- `PanelServiceDefaultLayoutSpec`'s "never write the dashboard layout" test encodes the bug and is inverted.

## Capabilities

### New Capabilities
- (none)

### Modified Capabilities
- `dashboard-layout-validation`: every panel create stores a valid item at every breakpoint.
- `panel-batch-create`: batch create places every item and returns its `layouts`.
- `panel-duplication`: duplicate stores a layout item instead of relying on render-time placement.
- `stored-layout-repair`: a valid breakpoint missing a live panel is repairable, append-only, owner-only.
- `breakpoint-layout-resolution`: the "a breakpoint only missing panels is never written on view" clause is reversed
  for the owner's once-on-open repair.

## Impact

- Backend:
  - `PanelService` (create/batchCreate/duplicate placement);
  - `ProposalLayoutSupport`;
  - `DashboardLayoutRepair` / `DashboardService.repairLayout`;
  - the dashboard repository (atomic append);
  - `PanelRoutes` and `PanelProtocol` for the new response field.
- Frontend:
  - `repairPatch.ts`, `useStoredLayoutRepair.ts`;
  - the `duplicatePanel` thunk;
  - the `e2e/hel1023` repair stubs.
- No migration (V115 is reserved for HEL-1271). No change to `ApiRoutes.scala`/`Main.scala`, `PipelineRunService`,
  `NodeSnapshotRepository` or analyze.

## Non-goals

- A one-off backfill of existing orphans for dashboards the owner never opens. Non-owner views keep render-time
  placement.
- Changing render-time resolution (HEL-1023) or the HEL-1071 validity contract.
- Changing auto-layout or the MCP layout tools.
