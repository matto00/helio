## Standing Constraints

- [C1] Delete an auto Connector on source delete only if implicit=true AND name starts with `Auto: ` AND the REAL dependents count (countRestSourcesReferencing) is 0 after the source is gone; owner-scoped via findByIdOwned only.
- [C2] Connector cleanup never fails, rolls back or changes the source delete; logs carry ids/reason/exception class/SQLSTATE only — never getMessage, credential, or config.
- [C3] Red first: new specs use VerifiedEmbeddedPostgres.start; `[hel1468-guard]` visible in sbt output; no inline FQNs; no migration (V125 only if proven necessary, re-checked before commit).
- [C4] Do not modify InlineSourceCleanup's existing deleteIfAuto/deleteCallCreated (HEL-1493 overlap); add only.

### Backend

## 1. Backend

- [x] 1.1 Add `ImplicitConnectorCleanup.AutoPrefix` and `deleteIfUnadoptedImplicit` per design D2/D5; treat `Right(false)` as nothing-to-do; verify by tests 3.1-3.5
- [x] 1.2 Add optional `connectorRepo` to `DataSourceService`; call the helper after a successful `RestSource` delete per D3/D4; verify by 3.1 and 3.6
- [x] 1.3 Wire `connectorRepo` into `DataSourceService` in `ApiRoutes.scala`, fixing the init-order hazard (D3); verify by route test 3.7

### Frontend

## 2. Frontend

- [x] 2.1 Reset `connectorsSlice.status` to `"idle"` on `deleteSource.fulfilled` (D6); verify by a `connectorsSlice.test.ts` case

### Tests

## 3. Tests

- [x] 3.1 Red-first service spec (VerifiedEmbeddedPostgres): bare-url source delete removes Connector + credential row; record red output on main in red-evidence.md
- [x] 3.2 Reused Auto Connector kept while referenced, removed with the last source
- [x] 3.3 Renamed Connector (no `Auto: ` prefix) kept; renamed source still cleaned up; user-created Connector named `Auto: x` kept
- [x] 3.4 Cross-tenant per D7: A's Auto Connector has zero referencing sources; B's forged reference + delete leaves A's Connector + credential intact
- [x] 3.5 Log safety per D7: sentinel in credential AND in an injected exception message; capture DataSourceService + ImplicitConnectorCleanup loggers; sentinel absent; delete stays `Right(())`
- [x] 3.5a Inline compensation per D7: connectorRepo-wired DataSourceService; unreferenced Auto Connector named by connectorId removed on compensation; user-created one survives; create the Auto Connector by direct repo insert (not createRest+delete)
- [x] 3.6 Reconcile existing specs whose premise the ruling changed (list each in red-evidence.md); never weaken explicit-Connector tests
- [x] 3.7 Route test via real ApiRoutes: `DELETE /api/data-sources/:id` removes the Auto Connector (red with the unfixed init order)
- [x] 3.8 Mutation evidence (a)-(f) from design D7 recorded in red-evidence.md, each turning a named test red
- [x] 3.9 Full gates: `sbt testFull` (with `[hel1468-guard]` visible), frontend lint/typecheck/jest; `openspec validate delete-auto-connector-with-source --type change`
