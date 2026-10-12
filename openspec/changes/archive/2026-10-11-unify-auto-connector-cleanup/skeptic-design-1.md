## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed tree: HEAD c658f1fa033ef0124e670935eda697966ce53dda (artifacts are untracked in the change dir).
Scope: items 1, 2+5, 4, 6 and 7. Item 3 is out by driver decision and is not counted against the design.

### What I verified (with evidence)

- **Spawn-cwd guard:** `assert-cwd.sh` returned `READY ambient=/home/matt/Development/helio branch=task/unify-auto-connector-cleanup/HEL-1505`.
- **D1 call sites:** `grep deleteIfAuto` finds exactly 3 production call sites: SourceService.scala:202, InlineSourceCleanup.scala:120 and :155. No test references `deleteIfAuto` or `autoName`, so deleting both is safe.
- **D1 is safe at `SourceService.createRest` (question b):** the Connector is created via `ImplicitConnectorConfig.forLegacySource(s"Auto: ${request.name}", ...)`. That sets `` `implicit` = true `` in `ConnectorAuthShape` (ImplicitConnectorConfig.scala:32-40) and the name starts with `Auto: `. So `deleteIfUnadoptedImplicit` reaches the same delete as `deleteIfAuto`. The dependents guard is unchanged: if `cleaningUpOnFailure` itself failed to remove the source, the Connector is still kept, the same as today. `createRestWithConfig` only returns `Right` or fails the Future (SourceService.scala:70-78, 245-262), so the `Failure` branch is the only leak path. Convergence is behaviour-identical here. CONFIRMED.
- **D1 at the InlineSourceCleanup sites:** both run after `dataSourceService.delete` (InlineSourceCleanup.scala:114-122, 144-158). That call already applies `deleteIfUnadoptedImplicit` when `connectorRepo` is wired (DataSourceService.scala:700-712). Routing through it there is idempotent: `findByIdOwned` returns `None`, and the call reports `true`. CONFIRMED.
- **D2:** `getMessage` appears 5 times in InlineSourceCleanup.scala (43, 124, 160, 165, 180). Design D2 plus the zero-hit grep probe covers all of them. `e.err.message` at 116 and 150 comes only from `NotFound`, or from our own conflict text (DataSourceService.scala:655-699), so leaving it is fine.
- **D3 under RLS (question c):** `withUserContext` is `db.run((setUserVar andThen action).transactionally)` (DbContext.scala:50-51). V93 `connectors_owner` and V92 `connector_credentials_owner` are both `FORCE ROW LEVEL SECURITY` with an owner `USING` clause. `connectors.credential_id` is `ON DELETE RESTRICT`, so deleting the connector first and then the credential is the only valid order, and it matches `rotateCredential`'s precedent (ConnectorRepository.scala:246-256). Under prod RLS both deletes run in the same user context against rows that user owns, so a single transaction is correct. `deleteAction` is overridable by design (ConnectorCredentialRepository.scala:100-104), so the fault-injection seam exists. The approach is sound, with one gap: see CR3.
- **RLS in tests:** MISTAKES.md:154-158 confirms dev and CI run as superuser (BYPASSRLS). Harnesses that use a non-bypassing role do exist (`CountingDataSource`, `ProductTelemetryDbHarness`, `OutputHistoryApiHarness` match `NOBYPASSRLS|CREATE ROLE|SET ROLE`).
- **D4:** `connectorsSlice` resets only on `deleteSource.fulfilled` (connectorsSlice.ts:185). `undoPatchSet` is a `createAsyncThunk` whose payload `PatchSetUndoResponse.edits[].inlineSources[].result` is `"removed" | "kept" | "alreadyGone"` (patchSet.ts:110; patchSetsSlice.ts:95, 270-288). For the cycle question: patchSetsSlice imports `RootState` type-only, plus the dashboards, panels and sources slices, none of which import connectorsSlice. A value import appears cycle-free, and the design already requires the executor to check. CONFIRMED.
- **D6:** `PatchSetInlineSourceFixture` exists. It builds `DataSourceService` WITHOUT `connectorRepo` (fixture:94) but does build a real `ConnectorRepository` (fixture:84) and uses `VerifiedEmbeddedPostgres.start` (fixture:69). So extending it is feasible. There is logback `ListAppender` precedent for log capture (ApiRoutesSpec.scala:2794).
- **D5 / the spec under test:** `postOverHttp` (CsvUploadLimitsRoutesSpec.scala:105-114) is shared by 12 cases. Several of them expect `200 OK` or `201 Created` (lines 122, 129, 174), not 413.
- **Pekko close behaviour:** pekko-http-core 1.1.0 `reference.conf:63-73` documents `linger-timeout = 1 min`. That setting governs flushing OUTBOUND data after the server is done. It says nothing about whether the server drains or abandons unread request bytes, and that decides whether the client sees FIN or RST. Nothing in the design or the premise evidence probes which one actually happens.

### Answers to the orchestrator's specific questions

- **(a) D5 and TCP RST on Linux.** The receiving half is sound. On Linux, `tcp_reset()` sets `sk_err` and calls `tcp_done()` without purging `sk_receive_queue`, and `tcp_recvmsg` drains queued data before it reports `sk_err`. So a reader thread does get the 413 bytes that arrived before the RST. Two real caveats remain:
  - On the server side, `tcp_close()` with unread receive data sends RST and drops any not-yet-transmitted send-queue bytes. On loopback, with a reader keeping the window open, the 413 is almost always already on the wire. That is not a guarantee, and the evidence should say so.
  - More importantly, the design never establishes that the server closes with RST at all, versus FIN-then-drain. If it is FIN, the forced ordering it describes does not make any client fail, and the mandated red cannot be produced. See CR2.
  The design also has a concrete functional bug for the sibling cases. See CR1.
- **(b) D1 at createRest:** safe and behaviour-identical (see above).
- **(c) D3 under RLS:** a correct single transaction, but it uses a credential id read in a different, earlier transaction (CR3). The statement-level owner predicate is not actually mutation-proven by the planned test (CR4).
- **(d) D7 failability:** unified-rule, log-safety, atomicity and frontend reds are failable on main as described. Three are not:
  - the cross-tenant mutation does not prove the new statement predicate (CR4);
  - combined-wiring mutation (a) is not failable as written (CR5);
  - the D5 red may be satisfied by a straw-man helper (CR2).

### Verdict: REFUTE

### Change Requests

1. **D5: the raw-socket client hangs on keep-alive responses for the sibling cases.**
   - **Problem:** D5 replaces `postOverHttp` for every case and has the reader read "until EOF or reset". The 200 and 201 siblings (CsvUploadLimitsRoutesSpec.scala:122, 129, 174) get a keep-alive response, and the server does not close the connection. The reader then blocks until the server idle-timeout or the bounded join expires, so those cases time out or fail.
   - **Revise D5** to specify:
     - the request carries `Connection: close` and a `Host` header (HTTP/1.1 requires it, and Pekko returns 400 without it);
     - and/or the reader stops at the end of the `Content-Length`-delimited body;
     - the reader socket has an `SO_TIMEOUT`, so the reader thread itself cannot hang.
   - Alternatively, scope the new client to the 413 cases only and leave `singleRequest` for the success cases. State which option is chosen.

2. **D5 / AC1: the red must be against the real old client, after a probe-confirmed mechanism.**
   - **Problem 1 (straw man):** D5 allows "a helper that mirrors the old ordering" as the red. A hand-written write-everything-then-read socket helper that propagates its own write `IOException` is red by construction. It proves nothing about `Http().singleRequest`, which is what flaked in CI. AC1 says "shows the old client approach failing".
   - **Problem 2 (no gate defined):** for the old approach, the forced-ordering gate ("block until the reader thread has captured the 413") is undefined, because `singleRequest` has no reader thread.
   - **Revise D5 / task 1.1 to:**
     - (i) Add a probe step, before the fix, that records how the Pekko server actually closes after the early 413: FIN (EOF observed) or RST (`Connection reset` / EPIPE), and whether it drains the remaining body. Record it in the evidence.
     - (ii) Require the red against the real `singleRequest` path, using a non-sleep gate. For example, send a streamed `HttpEntity.Default(contentType, contentLength, head ++ Source.future(gate).flatMapConcat(_ => remainder))`, where `gate` completes on a server-side signal: the accepted connection's termination via `newServerAt(...).connectionSource()` plus `watchTermination`.
     - (iii) State the stop condition. If the real old client cannot be made red under the forced ordering, the race hypothesis is unconfirmed (systematic-debugging law): stop and raise it rather than ship the raw client on an unproven root cause.
     - Remove the "helper that mirrors the old ordering" alternative, or require the probe from (i) to show it is equivalent to the real client's failure mode.

3. **D3: read the credential id inside the delete transaction.**
   - **Problem:** D3 deletes `existing.credentialId`, which comes from the `findByIdOwned` precheck, a separate earlier transaction. Take a concurrent `rotateCredential` that commits between the precheck and the delete. It repoints `credential_id` to a new row and deletes the old one. The delete transaction then removes the connector, `deleteAction(old)` deletes 0 rows, and the NEW credential is orphaned. That is exactly the orphan class item 4 exists to close.
   - **Revise D3:** inside the single `withUserContext` DBIO, lock and read the row first: `table.filter(r => r.id === uuid && r.ownerId === ownerUuid).forUpdate.result.headOption`, mirroring `rotateCredential` (ConnectorRepository.scala:246). Then delete it and `deleteAction(locked.credentialId)`. A concurrent rotation then serialises on the row lock.

4. **D7 / AC4: the cross-tenant mutation does not prove the statement-level owner predicate.**
   - **Problem:** D7 mutates the owner predicate out of BOTH `findByIdOwned` and the new delete filter. That shows the test detects cross-tenant deletion, but the new predicate in the delete statement is never shown to be load-bearing: removing only that predicate stays green, because `findByIdOwned` still guards. AC4 says "The delete statement itself is owner-scoped ... (mutation-proven)".
   - **Add a case that reaches the delete with the precheck bypassed.** For example, a `ConnectorRepository` test subclass overrides `findByIdOwned` to return the foreign Connector. Show that removing ONLY the delete-statement owner predicate turns that case red. Keep the both-predicates mutation as well.
   - Optional (non-blocking): run the cross-tenant and atomicity cases once under a non-BYPASSRLS role, using the existing harness precedent, so the prod RLS path is exercised too.

5. **D7 combined-wiring mutation (a) is not failable as written, and the mutation-to-case mapping is unnamed.**
   - **Problem:** in the D6 wiring, `DataSourceService.delete` (with `connectorRepo`) applies the prefix rule BEFORE `InlineSourceCleanup` runs. So "revert to the exact-name rule at a call site" at an `InlineSourceCleanup` call site leaves all four cases green: the renamed source's Connector is already gone.
   - **Revise D7:** name each mutation with the case it turns red:
     - (b) dropping the prefix check turns "adopted connector" red;
     - (c) using a zero `dependentCount` turns "shared connector" red;
     - for "renamed source", the mutation must disable or alter the DataSourceService-side rule (or both layers). Otherwise drop (a) here and rely on the unified-rule spec (task 2.1), which isolates `InlineSourceCleanup`.
   - Require each mutation run's red output to be recorded per case.

### Non-blocking notes

- SourceService.scala:75 (`cleaningUpOnFailure`) also logs `e.getMessage`. It is outside AC3's file scope; consider covering it or filing a follow-up.
- The log-safety spec should exercise all four source-path sites (124, 160, 165, 180), not only "source-delete". The zero-hit grep covers them statically, but a runtime sentinel check per site is cheap.
- The `inline-source-create-atomicity` delta adds a new requirement that overlaps the existing "Compensating an inline REST root also removes its implicit Connector" requirement (base spec lines 20-33). Consider expressing it as a MODIFIED requirement, so the archived spec does not carry two partially overlapping rules.
- D5 evidence should state the Linux-specific basis for the reader-thread approach (the receive queue survives RST), and the residual server-side send-queue caveat, rather than presenting it as a universal guarantee.
