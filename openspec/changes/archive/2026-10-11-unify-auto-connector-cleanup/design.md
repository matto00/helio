## Context

Current origin/main c658f1fa0. See ticket.md and `.concertino/runs/HEL-1505/evidence/premise-validation.md`.

- `InlineSourceCleanup.scala` holds `ImplicitConnectorCleanup` with two methods. `deleteIfAuto(connectorId, sourceName, ...)` uses an exact `Auto: <sourceName>` name match and logs `ex.getMessage` on failure. `deleteIfUnadoptedImplicit(connectorId, ...)` applies HEL-1497's rule: `ConnectorAuthShape.implicit` AND the `Auto: ` prefix AND the real `countRestSourcesReferencing` count, and it logs the class and SQLSTATE only.
- `deleteIfAuto` call sites:
  - `SourceService.createRest`'s insert-failure cleanup. The Connector was just made by `ImplicitConnectorConfig.forLegacySource("Auto: <name>")`, with `implicit = true`. The source was never inserted, or `createRestWithConfig` already removed it via `dataSourceRepo.delete`. This is the ONLY removal of that Connector, so it is not a no-op.
  - `InlineSourceCleanup.deleteCallCreated` and `deleteIfUnreferenced`. Both run after `dataSourceService.delete`, which in production (ApiRoutes.scala:373, with `connectorRepo`) already applied the HEL-1497 rule. Here it is a redundant no-op (`findByIdOwned` returns `None`). In any wiring where `DataSourceService` lacks a `connectorRepo`, its exact-name rule diverges from the owner's ruling: a renamed source blocks cleanup.
- `InlineSourceCleanup` has four `ex.getMessage` log lines (source-delete and source-read failures). PSQL `DETAIL` text can embed row values.
- `ConnectorRepository.delete` (~283):
  1. `findByIdOwned` precheck;
  2. dependents count;
  3. `withUserContext(table.filter(_.id === id).delete)`;
  4. then, separately, `credentialRepo.delete(credId, userId)`, which is its own `withUserContext` transaction.

  A failure at step 4 leaves an orphaned credential row. `withUserContext` already wraps its action in `.transactionally`, and `ConnectorCredentialRepository.deleteAction` (HEL-1338) is the composable DBIO, already used by `rotateCredential`.
- Frontend: `connectorsSlice` resets `status` to `idle` on `deleteSource.fulfilled` (HEL-1497 D6) only. `undoPatchSet` (patchSetsSlice.ts ~270) returns per-edit outcomes whose `inlineSources[].result` is `removed | kept | alreadyGone`.
- `CsvUploadLimitsRoutesSpec.postOverHttp` binds a real server and uses `Http().singleRequest` with a strict entity. For the pdf-over-cap case the server rejects with 413 and closes once the streamed part exceeds the cap, while the client may still be writing. If the client's write hits the closed socket before it reads the response, the request fails with `StreamTcpException: Broken pipe`.

## Goals / Non-Goals

Goals: one auto-Connector rule everywhere; log-safe cleanup; atomic connector+credential delete; a fresh Connectors list after undo; a deterministic 413 test; combined-wiring undo coverage.

Non-goals:
- the `DataSourceService` split (item 3);
- removing the `implicitConnector` request-shape parameter from `InlineSourceCleanup`'s callers (signature churn across PipelineService, PipelineProposalService and the patch-set services, no behavioural gain);
- MCP/agent-delete list staleness (accepted by design);
- `Migrated: ` Connectors (kept by design);
- prod leftovers (HEL-1495).

## Decisions

### D1 -- Converge on `deleteIfUnadoptedImplicit`; delete `deleteIfAuto`
Replace all three `deleteIfAuto` call sites with `deleteIfUnadoptedImplicit(connectorId, user, context)` and delete `deleteIfAuto`. If nothing else uses `autoName`, delete it too. The `sourceName` half of the captured tuple in `InlineSourceCleanup` becomes unused; simplify the capture to `Option[ConnectorId]`.

- *Why route, not remove:* at the two `InlineSourceCleanup` sites, after `DataSourceService.delete` has already cleaned up, the call is an idempotent owner-scoped `findByIdOwned` returning `None` (one cheap read). In any wiring without a `connectorRepo` on `DataSourceService`, the SAME rule still runs instead of none. For `SourceService.createRest` it is required: that path never goes through `DataSourceService.delete`.
- *Alternative rejected:* remove the `InlineSourceCleanup` step outright. That relies entirely on `DataSourceService`'s wiring, and a null `connectorRepo` (the nullable-optional DI default) would silently leak.
- *Behaviour delta vs today, all consistent with the binding HEL-1497 rulings:*
  - (a) A renamed source's connector is now removed at the `InlineSourceCleanup` sites even without `DataSourceService` wiring.
  - (b) At `createRest` cleanup, a Connector created by this very call is always implicit and `Auto: `-named, so the result is identical; the dependents guard still applies.

### D2 -- Log safety across the whole file
Every log line in `InlineSourceCleanup.scala` that today interpolates `ex.getMessage` instead logs: the id(s), the context, `ex.getClass.getSimpleName`, and the SQLSTATE when `ex` is a `PSQLException`. Extract the existing SQLSTATE formatting from `deleteIfUnadoptedImplicit` into one small private helper (no duplication). `e.err.message` from a `ServiceError` is our own text and may stay. Acceptance probe: `grep -n "getMessage" InlineSourceCleanup.scala` returns zero hits.

### D3 -- Atomic connector + credential delete (revised after skeptic-design-1 CR3)
In `ConnectorRepository.delete`, keep the precheck (`findByIdOwned`, which yields `Right(false)` for not-owned or not-found) and the dependents count unchanged. Then run ONE `ctx.withUserContext(user.id.value)` DBIO that RE-READS and LOCKS the row inside the transaction, mirroring `rotateCredential` (ConnectorRepository.scala ~246):

1. `table.filter(r => r.id === uuid && r.ownerId === ownerUuid).forUpdate.result.headOption`;
2. on `None`, return `Right(false)`;
3. on `Some(row)`, run `table.filter(r => r.id === uuid && r.ownerId === ownerUuid).delete`, then, when `row.credentialId` is defined, `credentialRepo.deleteAction(thatCredId)`. The credential id comes from the LOCKED in-transaction read, never from the precheck.

`withUserContext` is already `.transactionally`, so a credential-delete failure rolls back the connector delete, and a concurrent rotation serializes on the row lock: it either commits first (we delete the new credential) or blocks until we finish.

- The owner predicate on the locked read and on the delete statement is defence in depth on top of `findByIdOwned` and RLS. Dev/CI runs as a BYPASSRLS superuser (MISTAKES.md), so these application filters are what the tests exercise.
- `credentialRepo.delete(id, userId)` stays for its other callers (if any).
- The dependents TOCTOU window is unchanged (documented in HEL-1497).

### D4 -- Frontend: invalidate Connectors after an undo removed a source
`connectorsSlice` adds a matcher on `undoPatchSet.fulfilled` that sets `status = "idle"` when any outcome in the payload carries an `inlineSources` entry with `result === "removed"`. The client cannot tell whether a removed inline source was a bare-url REST one (the outcome has no kind), so reset on any removal, the same unconditional-reset posture as HEL-1497 D6. A refetch is cheap.

The executor MUST check for an import cycle: `connectorsSlice` importing `patchSetsSlice`. If one exists, match on the action type string via `isAnyOf`/`addMatcher` with a type guard instead of importing the thunk.

### D5 -- Deterministic 413 assertion for the pdf-over-cap test (revised after skeptic-design-1 CR1/CR2)

**Step 0 -- probe first (systematic-debugging, before any fix).** Against the real bound server used by `postOverHttp`, record HOW the server terminates a pdf-over-cap request:
- does it send the 413 and then FIN, or RST;
- does it send `Connection: close`;
- does it close before or after the client has written the whole body.

Capture this with a raw socket that writes slowly and logs read/EOF/reset events, or with `ss`/tcpdump-free observation of the Java exceptions. Record the result in red-evidence.md. If the probe shows the server never closes before the body is fully read (i.e. no race is possible), STOP and escalate: the root cause is unconfirmed.

**Step 1 -- red against the REAL old client, no sleeps.** Reproduce the CI failure through the real `Http().singleRequest` path, not a hand-written mirror of its ordering. Mechanism (or an equivalent the probe justifies):
- send a streamed `HttpEntity.Default` with the full `Content-Length`;
- its source emits enough bytes to exceed the cap, then WAITS on a promise completed when the server side has terminated that connection (e.g. bind via `Http().newServerAt(...).connectionSource()` / `bindFlow` and `watchTermination` on the per-connection flow, or the client's `Http().outgoingConnection` flow termination);
- then emits the remainder.

That forces the write-after-close ordering deterministically. Record the red: the exact exception (`StreamTcpException: Broken pipe`, connection reset, or whatever the probe-confirmed real failure is) from the existing `postOverHttp`-style `singleRequest` assertion. If the real client cannot be made red, stop and escalate.

**Step 2 -- fix: the 413 cases use a race-tolerant client; success cases keep `singleRequest`.** Add a separate test helper, `postOverHttpExpectingEarlyClose` (name free). Use it ONLY for the cases that expect the server to reject mid-body (the 413 cases that go through a real server). The 200/201 cases keep the existing `postOverHttp` unchanged, which avoids keep-alive hangs.

The helper is a test-local raw-socket HTTP/1.1 client that:
1. sends `Host`, `Content-Type`, `Content-Length` and `Connection: close` headers, with the body bytes taken from the same strict-marshalled entity;
2. starts a reader thread BEFORE writing, which reads into a buffer until EOF, reset, or the `Content-Length` of the response body is satisfied, with a bounded socket read timeout (e.g. 30 s) so it can never hang;
3. writes the head and body, catching any `IOException` on write (Broken pipe / reset) as not-a-failure;
4. joins the reader with a bounded timeout and parses the status line and body.

It returns the same `(StatusCode, String)` shape, so the existing assertions are unchanged. Under the Step 1 forced ordering (the same waiting-source gate applied to the raw writer), the new helper MUST pass.

The evidence must state that the reader-thread approach relies on Linux keeping response bytes readable after an incoming RST once they arrived before it (the CI runners and dev are Linux).

If the probe shows a cleaner deterministic fix (e.g. a server-side configuration that drains or delays close), the executor may use it instead, provided Step 1's real-client red still turns green under the same forced ordering.

Supporting evidence only (not proof): 30+ consecutive green runs of the spec.

### D6 -- Combined-wiring undo spec (item 7)
A new spec (`PatchSetUndoCombinedConnectorWiringSpec` or similar) built on the HEL-1493 `PatchSetInlineSourceFixture`, extended or parameterised so that `DataSourceService` IS constructed with the real `connectorRepo`, alongside the real `InlineSourceCleanup` (with `connectorRepo`) and `PatchSetUndoService`. It uses `VerifiedEmbeddedPostgres.start`, a throwaway owner, and the test master key. Cases, each applying a patch set with a bare-url REST inline-root pipeline create and then undoing it:
- **plain:** the source and its Auto Connector are removed, plus the credential row; the outcome reports `removed`.
- **adopted connector:** the Connector is renamed (no `Auto: ` prefix) before undo. The source is removed; the Connector and credential are kept.
- **renamed source:** the source is renamed before undo. The source and Connector are removed, plus the credential.
- **shared connector:** a second source references the same Auto Connector before undo. The inline source is removed; the Connector and credential are kept. Deleting the second source then removes them.

### D7 -- Proof (red first, mutation-proven where green on main) (revised after skeptic-design-1 CR4/CR5)
Specs use `VerifiedEmbeddedPostgres.start`; sbt runs must show `[hel1468-guard]`.

- **Unified rule (red on main):** `InlineSourceCleanup` wired with a `DataSourceService` WITHOUT `connectorRepo` (isolating the cleanup's own rule) and a renamed source. `deleteCallCreated` and `deleteIfUnreferenced` remove the Auto Connector. Red on main, where the exact-name mismatch keeps it. This spec, not the combined-wiring spec, is what proves the InlineSourceCleanup call sites converged.
- **Log safety (red on main):** inject failures whose exception MESSAGE contains a sentinel into EVERY failure-logging path in `InlineSourceCleanup.scala`:
  - the connector cleanup (via a `ConnectorRepository`/`dataSourceRepo` double that throws);
  - the source-delete `.recover`s in `deleteCallCreated` and `deleteIfUnreferenced` (outer and inner);
  - the source read in `captureImplicitConnector` (lines ~124, 160, 165, 180 on main, plus `deleteIfAuto`'s).

  Capture the `InlineSourceCleanup` and `ImplicitConnectorCleanup` loggers and assert the sentinel appears in no line. Red on main.
- **Atomicity (red on main):** a `ConnectorCredentialRepository` subclass whose `deleteAction` returns `DBIO.failed`. Call `ConnectorRepository.delete` and assert it fails/reports failure AND that the connector row AND the credential row still exist. Red on main, where the connector is gone and the credential is orphaned.
- **Cross-tenant, two layers (mutation-proven):**
  - (i) User B calls `ConnectorRepository.delete` (and the cleanup) on user A's Connector id; A's Connector and credential survive. Mutation: remove the owner predicate from `findByIdOwned` AND the in-transaction read/delete filters. Must turn red.
  - (ii) A case that BYPASSES the precheck: a `ConnectorRepository` test subclass overriding `findByIdOwned` to return A's row regardless of owner. B's delete must still leave A's rows intact, because of the in-transaction owner predicates alone. Mutation: remove ONLY the in-transaction owner predicates, which must turn (ii) red.

  Evidence states that RLS is bypassed in dev/CI (superuser), so these app-level filters are what is exercised. Optionally also run under a non-bypass role if an existing harness supports it.
- **Combined wiring (D6), named mutations:**
  - dropping the `Auto: ` prefix check in `deleteIfUnadoptedImplicit` must turn the adopted-connector case red;
  - using the repository's default zero `dependentCount` in `deleteIfUnadoptedImplicit` must turn the shared-connector case red;
  - removing the `connectorRepo` from the spec's `DataSourceService` wiring while ALSO reverting `InlineSourceCleanup` to an exact-name check must turn the renamed-source case red. Alternatively, the renamed-source convergence relies on the unified-rule spec above; state which.
  - removing `deleteIfUnadoptedImplicit`'s call from `DataSourceService.removeUnadoptedConnector` AND from `InlineSourceCleanup` must turn the plain case red.
- **Frontend:** a `connectorsSlice.test.ts` case for `undoPatchSet.fulfilled` with a removed inline source → `status: "idle"`, and with only `kept` → unchanged. Red before the reducer change.
- **413 flake:** per D5 Steps 0-2.

## Risks / Trade-offs

- [Behaviour change at InlineSourceCleanup sites when DataSourceService lacks connectorRepo] → now matches the owner's binding HEL-1497 rule; production wiring is unaffected (already cleaned up by DataSourceService).
- [Extra `findByIdOwned` read per inline cleanup] → negligible; cleanup paths are rare.
- [Raw-socket test client is more code] → kept test-local, small, documented; justified by determinism.
- [Concurrent lanes HEL-1487/1476/1490] → no file overlap expected; re-sync before PR.

## Migration Plan

No migration (next free number V126 untouched). Rollback is a revert.

## Planner Notes

Self-approved: D1 (route rather than remove, under the binding HEL-1497 ruling), D2 (sanitize all `getMessage` lines in the file, same file, same intent), D4 (unconditional reset on any removed inline source). Item 3 is explicitly out of scope by driver decision.

## Executor notes (from skeptic-design-2, non-blocking)

- The raw-socket writer must NOT close the socket before the reader thread is joined; an early close discards the 413.
- The Step 1 waiting-source gate needs a bounded timeout; if the server drains instead of closing, the test must fail or escalate, not hang.
- Task 1.1 pins `Http().singleRequest` as the red client (binding); `outgoingConnection` is only a possible termination-observation mechanism.
- Put the shared SQLSTATE log formatter on the `ImplicitConnectorCleanup` companion object.
- SourceService.scala:75 `getMessage` is outside AC3's file scope; it becomes a follow-up, not part of this change.
