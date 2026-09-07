# Files modified — pending-connector-handoff (HEL-955)

## Backend — schema

- `backend/src/main/resources/db/migration/V103__pending_connectors.sql` — drops `connectors.credential_id`'s `NOT NULL`, adds `completed_at`/`completed_by` (D10), and creates `connector_completion_tokens` (D2/D3/D9) with owner-only RLS + privileged grants.

## Backend — domain + persistence

- `backend/src/main/scala/com/helio/domain/model/Connector.scala` — `credentialId` becomes `Option[ConnectorCredentialId]`; adds `isPending`, `completedAt`, `completedBy`.
- `backend/src/main/scala/com/helio/domain/model/ConnectorCompletionToken.scala` — new domain type mirroring `ShareToken`.
- `backend/src/main/scala/com/helio/infrastructure/persistence/sources/ConnectorRepository.scala` — nullable-column mapping, `createPending`, `encryptCredential`/`repointPendingCredential`/`compensateDeleteCredential` (split for D3's encrypt-before-consume-before-repoint ordering), `findByIdUnscoped`, `findPendingByOwnerAndKind`, `rotateCredential` refuses pending (`ConnectorRotationPending`), `delete` handles `Option` credential.
- `backend/src/main/scala/com/helio/infrastructure/persistence/sources/ConnectorCompletionTokenRepository.scala` — new repo: atomic mint-with-supersede (D9), conditional single-use `consume` (D3), privileged-pool `findByHash`.

## Backend — services + guards

- `backend/src/main/scala/com/helio/domain/connectors/RestApiConnectorDriver.scala` — authoritative pending guard in `resolveConnector` (both `Owned`/`Internal` branches), before URI composition and `decryptForUse`.
- `backend/src/main/scala/com/helio/services/sources/SourceService.scala` — new `checkConnectorPending`, a check separate from `checkConnectorKind`.
- `backend/src/main/scala/com/helio/services/sources/ConnectorEntityService.scala` — maps `ConnectorRotationPending` to a 400 naming the completion path.
- `backend/src/main/scala/com/helio/services/sources/ConnectorCompletionNormalization.scala` — new: pure base-URL normalization for D9's re-mint match key.
- `backend/src/main/scala/com/helio/services/sources/ConnectorCompletionService.scala` — new: `createOrRemintPending`, `ownerRemint`, `complete` (encrypt→consume→repoint ordering, D3/D9/D10).

## Backend — API surface

- `backend/src/main/scala/com/helio/api/protocols/sources/ConnectorEntityProtocol.scala` — `pending`/`completedAt`/`completedBy` on `ConnectorMeta`/`ConnectorSummary`; new `CompletionRequest`/`CompletionTokenResponse`/`CreatePendingConnectorRequest`.
- `backend/src/main/scala/com/helio/api/routes/sources/ConnectorCompletionRoutes.scala` — new: anonymous completion route, owner re-mint route, pending-create route.
- `backend/src/main/scala/com/helio/api/ApiRoutes.scala` — wires the completion token repo/service and mounts the three new route classes (anonymous beside `PublicDashboardRoutes`; owner re-mint + pending-create in the authenticated tree, pending-create ordered before `ConnectorEntityRoutes`).

## Backend — tests

- `RestApiConnectorDriverPendingGuardSpec.scala` (new) — fetch-time pending guard, recording-credential-repo proof (task 8.1).
- `ConnectorCompletionServiceSpec.scala` (new) — D3/D9/D4a/D10 coverage including the supersede-vs-consume race.
- `SourceServiceSpec.scala` — pending create-time guard test.
- `ConnectorRepositorySpec.scala`, `ConnectorSummaryCredentialAbsenceSpec.scala`, `ConnectorEntityRoutesSpec.scala`, `WorkspaceContextServiceSpec.scala`, `WorkspaceContextServiceApplyBudgetSpec.scala`, `RlsPolicyGuardSpec.scala` — updated for the new `Option[credentialId]`/`pending` fields and the new RLS table.

## helio-mcp

- `helio-mcp/src/types.ts` — `pending` on `ConnectorSummary`; new `CreatePendingConnectorResult`.
- `helio-mcp/src/helioApi.ts` — new `createPendingConnector`; `listConnectorInstances` carries `pending`.
- `helio-mcp/src/tools/connectorHandlers.ts` — `create_connector` mints a pending Connector (with completion URL) for any non-`none` `authType` instead of refusing.
- `helio-mcp/src/tools/connectorSchema.ts` — accepts non-secret `apiKeyName`/`apiKeyPlacement` inputs.
- `helio-mcp/src/tools/connectorHandlers.test.ts`, `read.buildListConnectorsResult.test.ts` — updated for the above.

## Frontend

- `frontend/src/features/connectors/types/connector.ts` — `pending`/`completedAt`/`completedBy` on `Connector`.
- `frontend/src/features/connectors/services/connectorCompletionService.ts` (new) — unauthenticated completion submission call.
- `frontend/src/features/connectors/ui/ConnectorCompletionPage.tsx` (new) — the out-of-band completion form.
- `frontend/src/features/connectors/ui/ConnectorsPage.tsx` — "Pending completion" badge.
- `frontend/src/app/AppRoutes.tsx` — `/connectors/complete` route outside `ProtectedRoute`.
- Various `*.test.ts(x)` fixtures updated for the new required `pending` field.

## Cycle 2 (evaluation-1.md, all 5 CRs)

- `backend/src/test/scala/com/helio/services/assistant/CredentialSurfaceEnumerationSpec.scala` (CR1) — added the allow-list entry for `connectorHandlers.test.ts` with a documented reason.
- `backend/src/test/scala/com/helio/domain/connectors/RestApiConnectorDriverPendingGuardSpec.scala` (CR3) — the Internal-branch test now asserts on the refusal message (not just `isLeft`), closing the vacuous-assertion gap; mutation re-verified live (guard deleted → both branches red; restored → green).
- `backend/src/main/scala/com/helio/services/sources/ConnectorCompletionService.scala` (CR2/CR4) — new `describePending`/`resolveValidToken` (shared validation, backs the new GET lookup).
- `backend/src/main/scala/com/helio/api/protocols/sources/ConnectorEntityProtocol.scala`, `.../routes/sources/ConnectorCompletionRoutes.scala` (CR4) — new `GET /api/connectors/completion?token=...` + `PendingConnectorAuthShapeResponse`.
- `backend/src/test/scala/com/helio/services/sources/SourceServiceSpec.scala` (CR2) — new round-trip test: `createRest` refuses while pending, succeeds after completion via the SAME Connector, and the bound credential decrypts back to the exact submitted value.
- `backend/src/test/scala/com/helio/services/sources/ConnectorCompletionServiceSpec.scala` (CR4) — new `describePending` coverage.
- `frontend/src/features/connectors/services/connectorCompletionService.ts`, `.../ui/ConnectorCompletionPage.tsx` (+ new `.test.tsx`) (CR4) — the dead auth-type `<Select>` is removed; the page now fetches and renders from the pending Connector's actual persisted auth shape.
- `schemas/sources/{completion-request,completion-token-response,create-pending-connector-request,pending-connector-auth-shape-response}.schema.json` (CR5, new) + short "Wire Contract" cross-references added to the two ticket-scoped spec deltas.
- `tasks.md` — 7.1 and 8.4 now checked, reflecting the above.

All gates re-run clean after these fixes: `sbt test` (3972/3972), `npm test` (root 24/24 + frontend 262/262), `npm run lint/typecheck/format:check/build/check:schemas/check:scala-quality/check:openspec/check:no-credential-leak/check:helio-mcp-types`, and `bash .husky/pre-commit` end-to-end.

## Cycle 3 (skeptic-final-1.md, all 4 CRs + 4 non-blocking notes)

- `backend/src/main/scala/com/helio/domain/model/ConnectorCompletionToken.scala` (non-blocking) — corrected `isValid`'s doc comment (it is the live validity check, not display-only).
- `backend/src/test/scala/com/helio/services/sources/ConnectorCompletionServiceSpec.scala` (CR1/CR2) — added two tests that call `tokenRepo.consume` directly to exercise the write predicate itself (superseded-after-read-as-live, expired-after-read-as-live), mutation-verified live (deleted the predicate's supersede/expiry conditions → both new tests red; restored → green; the old vacuous test stayed green throughout, confirming it never covered this); renamed/annotated the old test as an end-to-end regression guard, not a predicate proof; added the task-4.7 expiry-recovery end-to-end test (owner and anonymous re-mint paths).
- `backend/src/test/scala/com/helio/domain/model/ConnectorCompletionTokenSpec.scala` (new, CR2) — `isValid`'s exclusive expiry-boundary unit tests.
- `backend/src/test/scala/com/helio/services/sources/ConnectorCompletionServiceClampExpirySpec.scala` (new, CR2) — `clampExpiry` unit tests (over-ceiling, zero/negative, unparseable, absent, whitespace).
- `frontend/src/features/connectors/ui/ConnectorsPage.tsx`, `.css`, `.test.tsx` (CR3) — renders the D10 owner-visible completion signal (when/by-whom), visibly distinguishing `anonymous` from a named principal; new tests.
- `openspec/changes/pending-connector-handoff/tasks.md` (CR3) — restored 6.3's by-whom/when wording.
- `frontend/src/features/connectors/ui/ConnectorCompletionPage.tsx` (CR4) — both failure messages now use `auth-error` (keeping `role="alert"`), matching `LoginPage.tsx`'s own pattern.
- `helio-mcp/src/tools/read.ts` (non-blocking) — updated the stale empty-connectors hint to describe the pending-Connector handoff.
- `openspec/changes/pending-connector-handoff/design.md` (non-blocking) — softened D5's "no logging or echoing" claim to note the new GET lookup's query-string token is still infra-access-log-visible.
- `openspec/changes/pending-connector-handoff/evaluation-2.md`, `skeptic-final-1.md` — committed (were untracked).

All gates re-run clean: `sbt test` (full suite), `npm test` (root 24/24 + frontend), `npm run lint/typecheck/format:check/build/check:schemas/check:scala-quality/check:openspec/check:no-credential-leak/check:helio-mcp-types`, and `bash .husky/pre-commit` end-to-end against a fully staged tree.
