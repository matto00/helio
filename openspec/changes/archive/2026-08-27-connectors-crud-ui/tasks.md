## 1. Backend — dependent count on read paths

- [x] 1.1 `ConnectorEntityProtocol`: add `dependentCount: Int` to `ConnectorMeta`.
- [x] 1.2 `ConnectorEntityService.findAll`/`findById`: return `(Connector, Int)` pairs (or a small `ConnectorWithDependents`) using the service's existing `dependentCount: ConnectorId => Future[Int]` collaborator (already injected for the delete guard — reuse it, do not add a second count mechanism). Do NOT import `ConnectorMeta`/the protocol layer into the service (skeptic design-round-2 non-blocking note 1) — `ConnectorEntityRoutes` maps the pair to `ConnectorMeta.fromDomain(connector, count)` at its four call sites (GET list, GET single, POST, PATCH); `POST` passes `dependentCount = 0`, `PATCH` passes the real count (note 2) — the field is non-optional, `connectorMetaFormat` becomes `jsonFormat9`.
- [x] 1.2b Acceptable to issue N `countRestSourcesReferencing` calls for N Connectors at realistic scale (skeptic design-round-2 non-blocking note 4) — no grouped-count optimization required for this ticket; note it as a known shape, not a defect.
- [x] 1.3 Unit test: list/read reflects the correct dependent count for a Connector referenced by 0, 1, and N `rest_api` sources, updating as sources are added/removed.

## 2. Backend — credential rotation endpoint

- [x] 2.1 `ConnectorRepository`: add `rotateCredential(id: ConnectorId, newCredentialPlaintext: String, credentialName: String, user: AuthenticatedUser): Future[Either[ConnectorRotationError, Connector]]` — orchestration lives HERE (mirrors `create`'s existing two-step-plus-compensation shape, which also lives in this repository, not the service — design.md Decision 1). Scoped by `findByIdOwned` first (not-found for another owner's Connector); on success, mints a new credential row via `credentialRepo.create`, repoints `credential_id` on the `connectors` row, best-effort deletes the old credential row; on repoint failure, compensates by deleting the just-minted new row before propagating the failure.
- [x] 2.2 `ConnectorRepository.update`'s existing "rotation is a distinct, not-yet-built operation" comment: update to reference `rotateCredential` instead of describing rotation as unbuilt.
- [x] 2.3 `ConnectorEntityService`: add `rotateCredential(id, newCredentialPlaintext, user): Future[Either[ServiceError, Connector]]` — thin: validates the new value is non-empty, delegates to `connectorRepo.rotateCredential(...)`, maps the result to `ServiceError`. No new constructor dependency (the service does not gain a `ConnectorCredentialRepository` reference — `ConnectorRepository` already has one).
- [x] 2.4 `ConnectorEntityRoutes`: add `PUT /connectors/:id/credential`, entity `{ credential: String }` (new protocol type `RotateConnectorCredentialRequest` in `ConnectorEntityProtocol`), reject empty credential with 400, else `ServiceResponse.run(connectorService.rotateCredential(...))`.
- [x] 2.5 Unit tests: `ConnectorRepositorySpec`/`ConnectorEntityServiceSpec` — rotation success (new plaintext decryptable via `decryptForUse`, old credential id no longer resolvable), rotation on another user's Connector returns not-found, rotation with no master key configured fails closed with no partial write (no `connectors` row change, no orphaned new credential row).
- [x] 2.6 Integration test: create a Connector + a dependent `rest_api` data source referencing it, rotate the credential, assert the source's outbound-auth resolution path (`ConnectorRepository.findByIdInternal` → `decryptForUse`) returns the NEW plaintext — proves dependents pick up rotation transparently (design.md Decision 1).
- [x] 2.7 Confirm (do not re-fix, only verify with a fresh test if none exists) HEL-822 cycle-2 fixes are covered by existing tests: `implicit` server-owned on POST/PATCH, no-auth Connector creation. If uncovered, add a minimal regression test; do not touch the already-fixed production code.

## 3. Frontend — feature slice scaffolding

- [x] 3.1 `frontend/src/features/connectors/` — types (`Connector` including `dependentCount`, `ConnectorAuthType`, request/response shapes matching backend protocol), `state/connectorsSlice.ts` (`createAsyncThunk` for fetch/create/update/delete/rotate, mirrors `sourcesSlice`/`settingsSlice` shape).
- [x] 3.2 Register `/connectors` route (`App.tsx` or router config, wherever `/sources` is registered) rendering `ConnectorsPage`.
- [x] 3.3 Add "Connectors" nav link alongside Data Sources / Data Pipelines (sidebar `NavLink`).

## 4. Frontend — ConnectorsPage

- [x] 4.1 `ConnectorsPage.tsx` — fetch-on-mount, list rendering (table or `DataGrid`, design.md Decision 4), `EmptyState` when zero Connectors.
- [x] 4.2 List row: name, kind, base host/URL, masked-credential placeholder, dependent count (design.md Decision 1b — shown always, e.g. "2 sources" / "0 sources"), implicit badge (`StatusChip`) when `config.implicit === true`, edit/rotate/delete/test actions.
- [x] 4.3 `ConnectorCredentialField` shared component (design.md Decision 3) — auth-type selector (none/bearer/api_key + header-or-query placement) + credential input, reusable props, no page-specific coupling.
- [x] 4.4 Create flow — modal (mirrors `AddSourceModal`'s pattern), uses `ConnectorCredentialField`, submits `POST /api/connectors`, omits credential entirely when authType=none, no connection-test action in this flow (design.md Decision 3b).
- [x] 4.5 Edit flow (non-secret fields) — modal, name/baseUrl/config (excluding auth secret), submits `PATCH /api/connectors/:id`; credential field shows masked placeholder + "Replace credential" action, never the real or empty-implying value; "Replace credential" is hidden/disabled for a no-auth (`authType: "none"`) Connector (design.md Risks note).
- [x] 4.6 Rotate flow — "Replace credential" action opens `ConnectorCredentialField` in rotation mode, explicit irreversibility copy, submits `PUT /api/connectors/:id/credential`, on success shows a toast and returns to masked-placeholder state.
- [x] 4.7 Delete flow — `ConfirmInline`-style confirmation; on 409 `ConnectorHasDependents`, surface a clear explanation referencing the row's own dependent count (design.md Decision 1b / spec "Delete blocked shows dependent explanation") — not a generic error toast.
- [x] 4.8 Connection-test — reuse `TestConnectionAffordance`, posting `{ type: "rest_api", config: { connectorId } }` to `POST /api/sources/test` (design.md Decision 3b), offered from the list row / edit modal only, for an already-saved Connector. `RestApiConfigBody` (`frontend/src/features/sources/services/dataSourceService.ts`) currently has a required `url: string` and no `connectorId` — deliberately relax `url` to optional and add `connectorId?: string`, checking `createRestSource`/`inferFromJson` callers rather than widening the shared type blindly (skeptic design-round-2 non-blocking note 3).
- [x] 4.9 DESIGN.md pass — tokens only, no literal px/ad-hoc colors; reuse `shared/ui/` primitives per design.md Decision 4. Watch for `TestConnectionAffordance`'s internal `add-source-modal__btn` CSS class coupling when reused on `/connectors` (skeptic design-round-2 non-blocking note 5) — restyle locally if it imports sources-modal-specific chrome.

## 5. Touch-target coverage (HEL-813)

- [x] 5.1 Add "surface 7: Connectors page" test to `e2e/hel813-mobile-touch-target-floor.spec.ts` at 430px and 768px — list row actions, create/rotate/delete modal controls, empty-state CTA (design.md Decision 5).

## 6. Verification

- [x] 6.1 `npm run lint`, `npm run typecheck`, `npm test` (frontend); `sbt test` (backend) — confirm the ~13 pre-existing `CONNECTOR_MASTER_KEY`-missing failures are the only failures in a fresh worktree before attributing any new failure to this change.
- [x] 6.2 `openspec validate connectors-crud-ui --type change --strict` passes.
- [x] 6.3 Manual/Playwright smoke: create (with credential, and no-auth), edit non-secret fields, rotate credential, delete with and without a dependent source, connection-test on a saved Connector, implicit-Connector badge visible for a synthesized Connector (seed one via the legacy bare-`url` source create path if needed), dependent count visible and accurate before and after adding/removing a dependent source.
