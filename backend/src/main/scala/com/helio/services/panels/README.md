# Services — Panels

Panel CRUD, patch application, auto-layout packing, and capability introspection.

Holds: `AutoLayoutService`, `BoundPanelService`, `PanelCapabilityService`, `PanelPacker`, `PanelPatchApplier`, `PanelServiceHelpers`, `PanelService`.

Does NOT hold: business logic for other domains, or persistence
(`infrastructure/persistence/panels/`) — this directory's files call
repositories, never `db.run` directly (CONTRIBUTING.md). `private[services]`
members here stay reachable from every other domain subpackage (no
encapsulation implied by the split).
