# HEL-1252: Deleting a data source referenced by a join/lookup/union secondary input, upsert target, or form-panel binding is unguarded

## Description

origin_kind: followup
origin_ticket: HEL-989

HEL-989 made `DELETE /api/data-sources/:id` return 409 whenever any pipeline roots on the source (`pipeline_roots`).
References that live in JSON config are still unguarded: join/lookup/union `SecondaryInput.Source(dataSourceId)` in
`pipeline_steps.config`, upsert `UpsertTarget.ExistingSource(dataSourceId)`, and `FormPanelConfig.dataSourceId` in
`panels.config`. They have no FK and no cascade (so no silent panel loss), but the delete leaves a dangling reference
that only surfaces at run/analyze time.

Decide scope and whether to extend the 409 (naming the referencing pipelines/panels, visibility-scoped per HEL-1002
semantics, same body shape with additive fields). Also consider the `teardown_resources` invisible-pipeline gap: its
any-reference check runs under RLS, so a hidden referencing pipeline is not seen.

## Owner Ruling (recorded by the driver at batch planning)

- Return 409 when the source being deleted is referenced by ANY config reference: pipeline secondary inputs
  (join/lookup/union), upsert/write targets, and form panels bound to a dataset — in addition to the existing
  `pipeline_roots` guard. This list is a starting point; every reference kind must be enumerated from the code.
- Name only the references the caller can see; never leak the names/ids of other tenants' resources, but the block
  still applies to references the caller cannot see.
- Fix teardown's RLS-blind reference check in the same change.

## Acceptance Criteria

1. `DELETE /api/data-sources/:id` returns 409 (no file deleted, no row removed) when the source is referenced by any
   pipeline root, join/lookup/union `secondaryInput` of kind `source`, upsert `existingSource` target, or form panel
   binding — the full set of reference kinds being enumerated from the code and recorded in design.md.
2. The 409 body keeps HEL-989's shape (`resourceKind`, `resourceId`, `resourceName`, `reason`, `message`,
   `pipelines`) with additive fields only, naming only referencing pipelines/panels the caller can see; hidden
   references contribute only an unnamed count to the reason.
3. Workspace tag teardown detects referencing pipelines (and the other reference kinds) the caller cannot see under
   RLS, refuses the teardown, and never names the hidden resource.
4. RLS-dependent behaviour is proven under a non-BYPASSRLS role (dev/CI superuser proves nothing), with a recorded red.
5. The frontend conflict notice and the MCP `delete_data_source` description reflect the broader reference set.
