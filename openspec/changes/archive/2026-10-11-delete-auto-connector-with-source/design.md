## Context

See proposal.md (Why) and ticket.md (Owner Decisions). Current state at origin/main 48931ae90:

- `DataSourceService.delete` (`backend/src/main/scala/com/helio/services/sources/DataSourceService.scala` ~649-685)
  has no Connector dependency. It reads the source with `findByIdOwned`, refuses on references, and deletes.
- `SourceService.createRest` synthesizes the Connector via `ImplicitConnectorConfig.forLegacySource("Auto: <name>")`
  with `ConnectorAuthShape.implicit = true`. `ConnectorEntityService.withServerOwnedImplicit` makes that flag
  server-owned: POST cannot set it, PATCH cannot flip it, and a rename preserves it.
- `ConnectorRepository.delete(id, user, dependentCount)` precheck: `findByIdOwned` (an explicit
  `owner_id = user` filter under `withUserContext`). It then deletes the connector row and its credential row
  (`connector_credentials`, V92/V93, `ON DELETE RESTRICT`). It refuses (`ConnectorHasDependents`) when
  `dependentCount > 0`. The default `dependentCount` is always 0 and MUST NOT be used.
- HEL-1475's `ImplicitConnectorCleanup.deleteIfAuto` (`InlineSourceCleanup.scala`) keys on the request shape plus an
  exact `Auto: <source name>` match. The request shape is unavailable on a later user delete.
- `PatchSetUndoService` has no undo path for a dataSource `delete` (`UnrecoverableDeleteKinds`), so no restore can
  re-create a source that points at a Connector this change deleted.

## Goals / Non-Goals

Goals: implement the owner rule (Q1-Q3) at a single seam, with an owner-only, log-safe, red-first proof.
Non-goals: those listed in proposal.md, plus any change to `InlineSourceCleanup`'s own step (HEL-1493 is in flight
there).

## Decisions

### D1 -- The rule lives in `DataSourceService.delete`, not the route
Every user- or agent-initiated source delete goes through this method: the route, MCP, patch-set apply-forward and
create-undo, `InlineSourceCleanup`, and `FirstRunDashboardService` rollback. One seam means none of them can leak.
Two sites call `dataSourceRepo.delete` directly and stay out of scope, because neither can leak:
- `SourceService.scala:74` is the create-failure cleanup, and its bare-url path already removes its own Connector
  (HEL-1475);
- `WorkspaceTeardownRepository.scala:155` removes only tagged sources, and a REST source cannot carry a tag.
*Alternative rejected:* route-only. It would leave patch-set and MCP deletes leaking, which is the same defect.

### D2 -- One rule helper, `ImplicitConnectorCleanup.deleteIfUnadoptedImplicit(connectorId, user, context)`
Added beside `deleteIfAuto` in `InlineSourceCleanup.scala`. It:
1. reads `connectorRepo.findByIdOwned(connectorId, user)`; `None` means keep (`true`);
2. keeps the Connector (logging a reason, ids only) unless `ConnectorAuthShape.parse(config).implicit` is true AND
   `name.startsWith(ImplicitConnectorCleanup.AutoPrefix)` (`"Auto: "`, also used by `autoName`);
3. calls `connectorRepo.delete(connectorId, user, id => dataSourceRepo.countRestSourcesReferencing(id))` with the REAL
   count; `Left(ConnectorHasDependents)` means keep (`true`).

It never throws. `deleteIfAuto` is left byte-identical.
*Alternative rejected:* reuse `deleteIfAuto`. Its exact-name rule contradicts Q2: renaming the source must not block
cleanup.

### D3 -- Wiring: optional `connectorRepo: ConnectorRepository = null` on `DataSourceService`
This follows the file's nullable-optional DI pattern (`auditService`, `autoRunTriggerService`). A `null` repo skips
cleanup, logged at debug, so the ~dozen test constructions stay unchanged.

**Init-order hazard:** in `ApiRoutes.scala`, `dataSourceService` (line ~361) is constructed BEFORE
`private val connectorRepo` (line ~381). Passing `connectorRepo` as-is would pass `null`, and production would
silently never clean up. The executor MUST reorder, or make the dependency lazy. A route-level test through the real
`ApiRoutes` wiring (task 3.3) is the proof; a service-level test cannot catch this.

### D4 -- Order and outcome
In `deleteAfterPrecheck`, the source is already in hand. After `dataSourceRepo.delete` succeeds and the audit is
recorded, if `source` is a `RestSource` the service awaits `deleteIfUnadoptedImplicit` and then returns `Right(())`
regardless of its Boolean. Source-first is mandatory: the dependents guard would refuse while the source still
references the Connector. The cleanup is awaited, not fire-and-forget: the response is sent only after it, which
keeps tests deterministic and the Connectors list consistent on the next fetch. An unparseable `connectorId`
(non-UUID) skips cleanup with a warn.

The cleanup future MUST NOT be able to fail: its own `.recover` catches everything. It is chained OUTSIDE the existing
zero-root `PSQLException` `.recover` in `deleteAfterPrecheck`, so a cleanup error can never be mistaken for, or
masked as, the HEL-913 conflict mapping.

Implicit Connectors created by `RestSourceConnectorMigration` (named `Migrated: ...`) fail the prefix test and are
kept. That is intended: the owner's rule names `Auto: ` only, and the HEL-1495 prod cleanup owns those leftovers.

### D5 -- Log safety
Every cleanup log line carries the source id, the connector id, the `context` and a reason token. On exception it
carries `ex.getClass.getSimpleName` and the SQLSTATE when it is a `PSQLException`. It NEVER carries `ex.getMessage`
(PSQL `DETAIL` text can embed row values), the credential, or the Connector config. Stricter than HEL-1475's
`getMessage` lines, which this change does not touch.

### D6 -- Frontend cache
`ConnectorsPage` fetches only when `connectorsSlice.status === "idle"`. After a source delete, a Connector this change
removed would stay listed until reload, and a click on it would 404. `connectorsSlice` handles
`deleteSource.fulfilled` (`frontend/src/features/sources/state/sourcesSlice.ts:197`) by resetting `status` to `"idle"`.
That resets unconditionally: the client cannot know whether a Connector was removed, and a refetch is cheap.

### D7 -- Proof (red first)
New spec(s) use `VerifiedEmbeddedPostgres.start`, real `DataSourceRepository`/`ConnectorRepository`/credential repo,
and the test master key. Each scenario in `specs/connectors/connector-management/spec.md` gets a test. Plus:
- **Cross-tenant:** user A's Auto Connector has NO referencing source (A's own source was deleted with the cleanup
  path disabled, or the Connector was inserted directly as implicit). User B's own source config is forged to reference
  that Connector id, and B deletes it. Assert A's Connector and credential row survive. The global dependents count
  is 0 here, so only the owner filter protects A.
- **Log safety:** the Auto Connector's credential stores a sentinel token, created through `createRest` with bearer
  auth (or written directly through the credential repo). A failure is injected into the cleanup: a
  `ConnectorRepository`/`dataSourceRepo.countRestSourcesReferencing` test double that throws a `PSQLException`
  (or another exception) whose MESSAGE contains the sentinel. Capture BOTH the `DataSourceService` and
  `ImplicitConnectorCleanup` loggers. Assert the sentinel is absent from every captured line, and that the source
  delete still returns `Right(())`.
- **Inline compensation:** one existing inline-cleanup spec (e.g. `PipelineCreateInlineSourceCleanupSpec` or
  `InlineSourceLeakPathsRoutesSpec`) gets a `DataSourceService` wired WITH `connectorRepo`. An inline root names an
  existing unreferenced Auto Connector via `connectorId`, and the call is compensated: assert the Connector is removed.
  A user-created Connector named the same way survives.
- The route test from D3.

Red evidence: the spec(s) fail on unmodified main. Mutation evidence, each turning a named test red:
(a) drop the implicit check; (b) drop the prefix check; (c) use the default zero `dependentCount`;
(d) remove the `ownerId === ownerUuid` predicate in `ConnectorRepository.findByIdOwned` ITSELF, which defeats both
owner checks; (e) leave the `ApiRoutes` order unfixed; (f) log `ex.getMessage` (or the Connector config) in the
cleanup's failure path.

## Risks / Trade-offs

- [TOCTOU: a concurrent create references the Connector between the count and the delete] → The same window
  already exists on `ConnectorEntityService.delete`, which has no FK from `data_sources.config`. Accepted, documented.
- [Existing tests assert that an Auto Connector survives a source delete] → reconcile only tests whose premise the
  owner ruling changed, each named in the evaluation notes; never weaken an explicit-Connector test.
- [An old leftover Auto Connector named as an explicit `connectorId` in an inline root is now removed when that
  root is compensated] → this is the owner's Q3 rule; spec scenario added (`inline-source-create-atomicity`).
- [HEL-1493 edits `InlineSourceCleanup.scala`] → add a new method only, re-sync with origin/main before the PR,
  and resolve conflicts additively.

- [Within one patch set, deleting a Connector's last source and then naming that Connector by `connectorId` in a
  later edit now fails, because the Connector is gone] → follows from Q1/Q3; documented, not special-cased.
- [The frontend resets the Connectors list only on a UI source delete; an MCP or agent delete leaves it stale until
  reload] → acceptable: a click on a stale entry 404s, the same as any other concurrent change.

## Migration Plan

No migration (V125 not needed). Rollback is a revert. Existing prod leftovers are HEL-1495.

## Planner Notes

- Self-approved: D1 (service-level seam, covering patch-set/MCP/first-run deletes too, consistent with Q1/Q3), D4
  (awaited, outcome-neutral), D5 (stricter log posture), D6 (unconditional slice reset).
- Follow-up candidate (after HEL-1493 merges): `InlineSourceCleanup`'s own exact-name Connector step is now a
  redundant no-op and can be removed.
