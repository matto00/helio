# Files Modified — HEL-824 Connectors CRUD UI

## Backend

- `backend/src/main/scala/com/helio/api/protocols/sources/ConnectorEntityProtocol.scala` — `dependentCount: Int` added to `ConnectorMeta` (non-optional, `jsonFormat9`); new `RotateConnectorCredentialRequest` protocol type; `ConnectorMeta.fromDomain` now takes an explicit `dependentCount`.
- `backend/src/main/scala/com/helio/api/package.scala` — re-export `RotateConnectorCredentialRequest` for unqualified use in routes (mirrors the existing `ConnectorMeta`/`CreateConnectorRequest` re-exports).
- `backend/src/main/scala/com/helio/services/sources/ConnectorEntityService.scala` — `findAll`/`findById`/`update` now return `(Connector, Int)` pairs via the existing `dependentCount` collaborator (no protocol-layer import into the service); new `rotateCredential` (thin, delegates to the repository).
- `backend/src/main/scala/com/helio/infrastructure/persistence/sources/ConnectorRepository.scala` — new `rotateCredential` (two-step-plus-compensation, mirrors `create`'s existing shape) and `ConnectorRotationNotFound` marker; `update`'s stale "not-yet-built" comment corrected.
- `backend/src/main/scala/com/helio/api/routes/sources/ConnectorEntityRoutes.scala` — GET/POST/PATCH now map `(Connector, Int)` pairs to `ConnectorMeta.fromDomain`; new `PUT /connectors/:id/credential` route.

## Backend tests

- `backend/src/test/scala/com/helio/api/routes/sources/ConnectorEntityRoutesSpec.scala` — dependentCount 0/1/N reflected on list/read, PUT credential rotation (success, empty-credential 400, cross-user 404), updated the `productElementNames` structural assertion for the new field.
- `backend/src/test/scala/com/helio/infrastructure/persistence/sources/ConnectorRepositorySpec.scala` — `rotateCredential` unit tests (success + decryptForUse/old-id-gone, cross-user not-found no partial write, no-master-key fail-closed no partial write) and a real dependent-source-picks-up-rotation integration test via `findByIdInternal` + `decryptForUse`.

## Frontend

- `frontend/src/features/connectors/types/connector.ts` — wire types mirroring the backend protocol.
- `frontend/src/features/connectors/services/connectorEntityService.ts` — `/api/connectors` CRUD + credential-rotation client.
- `frontend/src/features/connectors/state/connectorsSlice.ts` — `createAsyncThunk`s for fetch/create/update/delete/rotate, per-id `deleteConflict` for the 409 `ConnectorHasDependents` case.
- `frontend/src/features/connectors/state/connectorsSlice.test.ts` — tests for the above, including the client-built 409 message and the zero-count fallback.
- `frontend/src/features/connectors/ui/ConnectorCredentialField.tsx` — shared auth-type + credential input, reusable standalone component (create mode: editable auth type; rotate mode: fixed auth type, credential-only).
- `frontend/src/features/connectors/ui/ConnectorCredentialField.css` — DESIGN.md-token styling for the above.
- `frontend/src/features/connectors/ui/ConnectorCredentialField.test.tsx` — tests for the above.
- `frontend/src/features/connectors/ui/CreateConnectorModal.tsx` — create flow, no connection-test action (design.md Decision 3b).
- `frontend/src/features/connectors/ui/EditConnectorModal.tsx` — non-secret edit + masked-credential placeholder + "Replace credential" entry point (hidden for no-auth).
- `frontend/src/features/connectors/ui/RotateCredentialModal.tsx` — rotation flow, explicit irreversibility copy.
- `frontend/src/features/connectors/ui/ConnectorsPage.tsx` — list/create/edit/delete/test, implicit badge, dependent count, 44px mobile touch targets, disabled-delete-with-dependents.
- `frontend/src/features/connectors/ui/ConnectorsPage.css` — DESIGN.md-token styling; stacked mobile card layout (430/768/1100px), full-width conflict-message row.
- `frontend/src/features/connectors/ui/ConnectorsPage.test.tsx` — tests for the above, including the disabled-delete/no-confirm and non-leaking-409-message cases.
- `frontend/src/features/sources/services/dataSourceService.ts` — `RestApiConfigBody.url` relaxed to optional, `connectorId?` added (task 4.8).
- `frontend/src/features/sources/ui/TestConnectionAffordance.tsx` — new optional `buttonClassName` prop so `/connectors` doesn't pull in `add-source-modal__btn` chrome (skeptic note 5).
- `frontend/src/app/AppRoutes.tsx` — `/connectors` route registration.
- `frontend/src/shared/chrome/sections.ts` — new nav destination (`pickerId: "other"`, matching Settings' shape — a real destination, not a pickable sidebar-list section).
- `frontend/src/shared/chrome/sections.test.ts` — test for the above.
- `frontend/src/shared/chrome/navDestinations.test.ts` — test updated for the new nav destination.
- `frontend/src/shared/chrome/BottomNav.test.tsx` — test updated for the new nav destination.
- `frontend/src/store/store.ts` — `connectors` reducer registered.

## E2E

- `e2e/hel813-mobile-touch-target-floor.spec.ts` — new "surface 7: Connectors page" test at 430px/768px (empty-state CTA, create-modal controls, list-row actions after creating a connector). Cycle-1 evaluator found it failed live (Modal entrance-animation race); cycle-2 executor fixed it (settle-wait + locator scoping); re-verified passing at both breakpoints by both the evaluator and the final-gate skeptic (twice, non-flaky) after the cycle-3 breakpoint widening (768→1100px).

## OpenSpec

- `openspec/changes/connectors-crud-ui/tasks.md` — all tasks complete, including 6.3 (live manual/Playwright smoke — performed across the evaluator's cycle-1 UI Review and the final-gate skeptic's two independent live passes; see `evaluation-1.md`, `skeptic-final-1.md`, `skeptic-final-2.md`).
