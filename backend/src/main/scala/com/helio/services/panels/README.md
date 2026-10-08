# Services — Panels

Panel CRUD, patch application, auto-layout packing, and capability
introspection. `BoundPanelService` was deleted in HEL-904 -- panel-level
data binding/aggregation is gone; `PanelCapabilityService` was retargeted
onto `OutputId` (was `DataTypeId`).

Holds: `AutoLayoutService`, `PanelCapabilityService`, `PanelPacker`,
`PanelPatchApplier`, `PanelServiceHelpers`, `PanelService` (the entry point: the
constructor, every ACL / `Forbidden` / 404 preamble, `audit`), the concerns split out of it
(HEL-1253) -- `ResolvedPanelPatch` (the validated update snapshot), `PanelBindingChecks`
(output / data-source existence, form consistency, default placement size, plus the pure panel
extractors), `PanelCreateBuilder` (`buildForCreate` / `buildAllForCreate`),
`PanelFormFileSubmission` (the file-attached form-submit path), `PanelUpdateValidation` (`update`'s
post-authorize validation chain), `PanelBatchWrites` (`batchUpdate` / `batchCreate` post-ACL
bodies) and `PanelLifecycleWrites` (`create` / `delete` / `duplicate` post-ACL tails) -- plus the layout
rules (HEL-1071): `LayoutValidator` (pure bounds/overlap geometry, mirrors the
frontend `breakpointLayout.ts` and is tested against the shared fixture
`shared-test-fixtures/layout-validity.json`), `LayoutPolicy` (the one write
policy: identical-to-stored passes, absent is preserved, a changed breakpoint
must be valid or the whole write is a 400 — never clamped), `LayoutReflow`
(valid-by-construction md/sm/xs for system-generated layouts) and
`LayoutBreakpointScaling` (the column counts), and `CreatePlacement` (HEL-1260: the one pure placer every
panel-create path — single, batch, duplicate — appends through, at x = 0 below each breakpoint's own bottom).

Does NOT hold: business logic for other domains, or persistence
(`infrastructure/persistence/panels/`) — this directory's files call
repositories, never `db.run` directly (CONTRIBUTING.md). `private[services]`
members here stay reachable from every other domain subpackage (no
encapsulation implied by the split).
