# Services — Panels

Panel CRUD, patch application, auto-layout packing, and capability
introspection. `BoundPanelService` was deleted in HEL-904 -- panel-level
data binding/aggregation is gone; `PanelCapabilityService` was retargeted
onto `OutputId` (was `DataTypeId`).

Holds: `AutoLayoutService`, `PanelCapabilityService`, `PanelPacker`,
`PanelPatchApplier`, `PanelServiceHelpers`, `PanelService`.

Does NOT hold: business logic for other domains, or persistence
(`infrastructure/persistence/panels/`) — this directory's files call
repositories, never `db.run` directly (CONTRIBUTING.md). `private[services]`
members here stay reachable from every other domain subpackage (no
encapsulation implied by the split).
