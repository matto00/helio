## Why

Seven backend services still declare `outputRepo: OutputRepository = null`, and each silently skips an Output
ownership/existence check (or a materialization/alert step) when the repository is absent. The sharpest instance is
`PanelService.rejectMissingOutput`: with no repository a panel bound to an unowned or nonexistent `outputId` is
accepted. HEL-1256 closed the same hole on patch-set undo; this closes it everywhere else, so "forgot to wire the
repository" becomes a compile error instead of a silently weaker check.

## What Changes

- `PanelService`, `PipelineService`, `PipelineRunService`, `DashboardService`, `DashboardContentsService`,
  `DashboardProposalService` and `ProposalPanelSupport.preValidateBindings` take `outputRepo` with **no default**.
- Each null-skip branch on `outputRepo` in those files is removed; an explicit `null` fails fast at construction.
- `ApiRoutes` always builds a real `OutputRepository` (its `dbContext` parameter loses its `null` default);
  production wiring (`Main` passes `dbContext = ctx`) is unchanged.
- Every test fixture constructing these services passes a real repository (EmbeddedPostgres-backed) or a typed
  Mockito double — never `null`.
- New test: a panel whose `outputId` is nonexistent or owned by another user is rejected.

## Capabilities

### New Capabilities
- None.

### Modified Capabilities
- None. Production already wires a real repository, so no externally observable behaviour changes;
  `.openspec.yaml` sets `skip_specs: true`.

## Impact

- Backend only: `com.helio.services.{panels,pipelines,dashboards,proposals}`, `com.helio.api.ApiRoutes`, and the
  test fixtures that construct those classes (~130 construction sites across ~75 spec files).
- No schema, API, migration, or frontend change.

## Non-goals

- Other `outputRepo` null-guards on parameters that are already required (`OutputControlsValidator`,
  `WorkspaceContextService`, `WorkspaceSearchService`, `PatchSetApplyResolvers`, `PatchSetUndoService`'s
  HEL-1256 typed rejection) — noted as a follow-up.
- The other nullable-optional collaborators on these services (`auditService`, `dataSourceRepo`,
  `nodeSnapshotRepo`, ...) and ApiRoutes' other `Option(dbContext)` derivations.
