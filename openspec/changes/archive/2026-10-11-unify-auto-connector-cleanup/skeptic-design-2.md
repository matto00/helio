## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed tree: HEAD c658f1fa033ef0124e670935eda697966ce53dda. The only change is the untracked change dir.
Scope: items 1, 2+5, 4, 6 and 7. Item 3 is out by driver decision and is not counted against the design.

### What I verified (with evidence)

- **Spawn-cwd guard:** `assert-cwd.sh` returned `READY ambient=/home/matt/Development/helio branch=task/unify-auto-connector-cleanup/HEL-1505`.

#### Round-1 change requests

- **CR1 (raw client hangs on keep-alive): ADDRESSED.**
  - D5 Step 2 limits the new helper to the 413 cases that go through a real server. On main those are `CsvUploadLimitsRoutesSpec.scala` lines 134, 179, 203 and 213. The 200/201 cases (122, 129, 174) keep `postOverHttp`.
  - The helper sends `Host`, `Content-Length` and `Connection: close`.
  - Its reader stops on EOF, on reset, or once the response body's `Content-Length` is satisfied, and it has a bounded socket read timeout.
  - The option chosen is stated explicitly.
- **CR2 (straw-man red, undefined gate): ADDRESSED.**
  - Step 0 adds a probe, run before any fix, that records FIN vs RST, `Connection: close` and close timing. If no race is possible, it escalates.
  - Step 1 requires the red through the real `Http().singleRequest` path. The gate is a waiting entity source released when the server side terminates the connection, with no sleeps. Tasks 1.0 and 1.1 match.
  - The "helper that mirrors the old ordering" alternative is gone.
  - The stop condition ("if the real client cannot be made red, stop and escalate") is explicit.
  - The Linux receive-queue caveat is required in the evidence.
- **CR3 (credential id read in an earlier transaction): ADDRESSED.**
  - D3 now re-reads the row inside the one `withUserContext` DBIO with `forUpdate`, and takes `credentialId` from the locked row.
  - This mirrors `rotateCredential`, which I confirmed at ConnectorRepository.scala:246: `table.filter(r => r.id === connectorUuid && r.ownerId === ownerUuid).forUpdate.result.headOption`.
  - The connector is deleted before the credential, which is the only valid order under `ON DELETE RESTRICT`.
  - `credentialRepo.deleteAction` (ConnectorCredentialRepository.scala:103) is a plain DBIO, is documented as overridable, and is unscoped by owner. Its id now comes only from the owner-filtered locked row, and RLS covers prod.
  - On main, the delete is a separate `withUserContext(...delete)` followed by `credentialRepo.delete(credId, user.id)` (ConnectorRepository.scala:296-304), so the premise holds.
- **CR4 (the statement-level owner predicate was not mutation-proven): ADDRESSED.**
  - D7 adds case (ii): a `ConnectorRepository` subclass overrides `findByIdOwned` to bypass the precheck. A mutation that removes ONLY the in-transaction owner predicates must turn (ii) red.
  - This is feasible. `class ConnectorRepository` (line 21) is not final, `findByIdOwned` (line 179) is a public `def`, and test subclasses of this repository already exist (`RestApiConnectorDriverKindGuardSpec`, `SourceCreatePostInsertCleanupSpec`, among others).
  - Under the mutation, B's delete removes A's connector row (no FK from `data_sources`; the connector id lives in JSON config). So (ii) is genuinely failable.
- **CR5 (combined-wiring mutation (a) not failable): ADDRESSED.**
  - D7 names a mutation for each case:
    - prefix check dropped → adopted connector;
    - zero `dependentCount` → shared connector (no FK, so the delete succeeds and the case goes red);
    - DataSourceService call AND InlineSourceCleanup call removed → plain;
    - renamed source → both layers disabled/reverted, or explicitly delegated to the unified-rule spec, with "state which".
  - Both renamed-source options are failable. On main the unified-rule spec is red: `captureImplicitConnector` reads the renamed name, and `deleteIfAuto` keeps a connector whose name does not match exactly (InlineSourceCleanup.scala:32).

#### The design as a whole against the live tree

- **D1:** `deleteIfAuto` has exactly 3 call sites (SourceService.scala:202, InlineSourceCleanup.scala:120 and :155). `autoName` is used only by `deleteIfAuto`. `DataSourceService.removeUnadoptedConnector` (DataSourceService.scala:701-712) already uses `deleteIfUnadoptedImplicit`. AC2 can be traced to a task.
- **D2 / AC3:** `getMessage` occurs at InlineSourceCleanup.scala lines 43 (`deleteIfAuto`, which is being deleted), 124, 160, 165 and 180.
  - D7's log-safety spec names every one of these paths.
  - The source-delete failure paths (124, 160) need `DataSourceService.delete` to fail. `DataSourceService` is `final`, but `DataSourceRepository` (line 23) is not, and `DataSourceService.delete` calls `dataSourceRepo.findByIdOwned`, `findReferences` and `delete`. A throwing repository double therefore reaches those recovers, so the injection is feasible.
- **D3 failure semantics:** callers already handle a failed Future: `ConnectorEntityService.delete` (line 163) and `ImplicitConnectorCleanup`'s `.recover`. The "a failed cleanup never fails the source delete" ruling is preserved, because `removeUnadoptedConnector` is chained after the source delete and `deleteIfUnadoptedImplicit` never throws.
- **D4:**
  - `connectorsSlice.ts` imports only `sourcesSlice` among the feature slices.
  - `patchSetsSlice.ts` imports the dashboards, panels and sources slices and the `RootState` type, but nothing from connectors, so a value import of `undoPatchSet` is cycle-free.
  - The payload type has `inlineSources?: InlineSourceUndoOutcome[]` with `result: "removed" | "kept" | "alreadyGone"` (patchSet.ts:103-110).
  - `ConnectorsPage.tsx:141` refetches on `status === "idle"`, so an idle reset produces the AC5 refetch.
- **D6:** confirmed in round 1, and the fixture is unchanged on this HEAD.
- **Spec deltas:**
  - No contradiction with the base `inline-source-create-atomicity` requirement "Compensating an inline REST root also removes its implicit Connector". That requirement covers in-call compensation, where adoption cannot happen mid-call. The base already defers explicitly referenced auto Connectors to "the source-delete rule".
  - The connector-management delta matches D3.
- **AC coverage:** AC1 → D5 / tasks 1.x; AC2 → D1 / 2.1, 2.3; AC3 → D2 / 2.2, 2.4; AC4 → D3 / 3.x; AC5 → D4 / 4.x; AC6 → D6 / 5.x; AC7 → C2 / Migration Plan. No AC is uncovered, and no task is out of scope.

### Verdict: CONFIRM

### Non-blocking notes

- **D5 Step 2, write-side exception handling.** When the writer catches the write `IOException`, it must NOT close the socket (for example via try-with-resources around the write) before the reader is joined. Closing the socket would discard the buffered 413 that the reader-thread approach depends on. Close only after the join.
- **D5 Step 1 gate deadlock.** If the server drains rather than closes, the waiting source never releases. Bound the gate with a timeout, so that the probe-negative outcome escalates instead of hanging the test JVM.
- **D5 Step 1 wording.** "or the client's `Http().outgoingConnection` flow termination" could be read as permitting a non-`singleRequest` red. Task 1.1 pins `singleRequest`, and that is binding.
- **D2 helper placement.** `ImplicitConnectorCleanup` and `InlineSourceCleanup` are separate classes, so put the SQLSTATE formatter on the `ImplicitConnectorCleanup` companion (or a private object in the file) so that both can share it without duplication.
- **Carried from round 1.** SourceService.scala:75 still logs `e.getMessage`. This is outside AC3's file scope; file a follow-up if not covered here.
- **Spec deltas, carried from round 1.** The new requirement could be a MODIFIED version of the existing compensation requirement instead of a second, partially overlapping ADDED one. This is cosmetic.
- **D4 and `alreadyGone`.** D4 resets only on `removed`. `patchSetsSlice` already refetches sources on `removed || alreadyGone` (line 178). Resetting connectors only on `removed` matches the spec delta, and `alreadyGone` means some other path deleted the source (the sources page already resets on `deleteSource`; the MCP and agent paths are accepted as stale). This is acceptable as designed.
