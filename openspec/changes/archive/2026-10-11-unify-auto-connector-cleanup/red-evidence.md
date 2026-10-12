# HEL-1505 red evidence

## Item 1 -- D5 Step 0 probe (done) and Step 1 (real singleRequest red NOT achievable)

Step 0, raw-socket probe against the real bound server (25 MiB pdf form to POST /api/data-sources, Connection: close,
64 KiB writes, reader thread logging):

    PROBE t=85ms read 291 bytes
    PROBE t=87ms reader EOF (FIN)
    PROBE response head: HTTP/1.1 413 Content Too Large | Connection: close | Content-Length: 122 | {"message":"CSV is too large: ..."}
    PROBE t=87ms writer IOException at offset 2621440 (chunk 40 of total 26214802): java.net.SocketException: Broken pipe

So the race IS possible: the server sends 413 + Connection: close + FIN after ~2.6 MB of a 26.2 MB body and the client
writer then gets Broken pipe.

Step 1 attempts with the REAL Http().singleRequest:
- Forced ordering (HttpEntity.Default, Source.single(prefix > entityLimit) ++ futureSource gated on the server-side
  connection flow's watchTermination, remainder 64 KiB chunks), 6 iterations: terminatedBeforeResult=true, result
  Success(413) in 6/6. The old client PASSES under this ordering (the response is already read before the gate opens).
- Plain old postOverHttp x40 locally: 0 failures.
The failing ordering needs the client to process a write failure before the already-arrived response (a Pekko
TcpConnection actor-mailbox race), which no gate on the server-side termination can force.

## Items 2+5, 4, 6, 7 (logs: backend/target/hel1505-logs/*.log, untracked)

Command shape: `nice -n 19 sbt -J-Xmx3g -batch -Dsbt.server.autostart=false "testOnly <spec>"` from backend/ (project path
line names this worktree; `[hel1468-guard] ScalaTest summary: failed=N aborted=0 unreadable=0` present in every run).

### Item 4 -- ConnectorRepositoryDeleteAtomicitySpec
RED on unmodified main code (atom-red.log), 2 failed / 2 passed:
- "leave BOTH rows intact when the credential delete fails": `0 was not equal to 1` (connector gone, credential orphaned).
- "refuse another user's delete even when the precheck is bypassed": `Right(true) was not equal to Right(false)`.
GREEN after D3 (atom-green.log, with ConnectorRepositorySpec): 22 succeeded, 0 failed.
Mutations (each restored afterwards):
- M2 remove ONLY the in-transaction owner predicate (`owned`): case (ii) red, 1 failed (atom-m2.log).
- M1 remove it AND findByIdOwned's owner predicate: cases (i) and (ii) red, 2 failed (atom-m1.log).
RLS is bypassed in dev/CI (superuser), so these application filters are what is exercised.

### Items 2+5 -- InlineSourceCleanupUnifiedRuleSpec (DataSourceService WITHOUT connectorRepo)
RED on main (unified-red.log): 9 failed / 4 passed -- renamed source keeps its Auto Connector (deleteCallCreated and
deleteIfUnreferenced), a non-implicit Connector named exactly `Auto: <source name>` is wrongly deleted (both), and all 5
log-safety cases print the sentinel (`... Key (token)=(SENTINEL-1505-row-value-do-not-log)`) from deleteIfAuto, both
deleteCallCreated/deleteIfUnreferenced recovers (outer and inner) and the capture read.
GREEN after D1/D2 (unified-green.log; with SourceCreatePostInsertCleanupSpec, DataSourceDeleteAutoConnectorSpec,
patchsets.*, leak-path and proposal cleanup specs): 253 succeeded, 0 failed. No existing test's premise changed.
Probe: `grep -n getMessage InlineSourceCleanup.scala` -> zero hits; `grep deleteIfAuto|autoName` in backend/src -> zero hits.

### Item 7 -- PatchSetUndoCombinedConnectorWiringSpec (green on main by construction, mutation-proven)
Green: 4/4 (combined-green.log). Mutations, each restored:
- drop the `Auto: ` prefix check -> "adopted connector" red (comb-m-prefix.log)
- default zero dependentCount -> "shared connector" red (comb-m-dependents.log)
- deleteIfUnadoptedImplicit becomes a no-op (removes both DataSourceService and InlineSourceCleanup call effect) -> plain,
  renamed-source and shared cases red (comb-m-plain.log)
Renamed-source convergence at the InlineSourceCleanup call sites is proven by the unified-rule spec above (red on main),
not by the combined-wiring spec, whose DataSourceService cleanup also covers that case in production wiring.

### Item 6 -- connectorsSlice.test.ts
RED before the reducer (npm test run): `Expected: "idle" Received: "succeeded"` for the removed-inline-source case.
GREEN after: `npx jest --testPathPatterns=connectorsSlice` 14 passed. kept-only and empty cases unchanged. Only `removed`
resets (design D4); `alreadyGone` does not. No import cycle: no non-UI slice imports connectorsSlice besides the store.

### Gates
Targeted backend (`*Connector* *InlineSource* *PatchSetUndo* *SourceCreatePostInsertCleanupSpec
*DataSourceDeleteAutoConnectorSpec *PipelineProposalImplicit*`): 401 succeeded, 0 failed (final-targeted.log).
Frontend: full `npm test` before the reducer change: only the new red case failed (6155 passed); lint, typecheck,
format:check clean after.

## Item 1 -- resolution (driver technical decision: raw-socket-naive-client-red; not an owner ruling)

PR-body disclosure: `Http().singleRequest` could not be forced red: its failure is a Pekko client-internal ordering race
(a write failure reaching the connection actor before the already-arrived 413 is read), and the forced-ordering gate on
server-side termination passed 6/6 with the old client while the plain old spec failed 0/40 locally. The deterministic red
is therefore a naive raw-socket client against the same request, and the fix is a tolerant reader-thread client.

Same request for red and green: the 25 MiB pdf form (`pdfOverCapForm()`) POSTed to `/api/data-sources` on the same
`routes()` served by the same real Pekko server (connectionSource + watchTermination), via the single helper
`postOverHttpExpectingEarlyClose` in CsvUploadLimitsRoutesSpec.
- RED (csv-naive20.log, `tolerant = false`: write everything, then read; no reader thread): 20/20 failures with
  `java.net.SocketException: Broken pipe`, both ungated and with the write-after-close gate (`gateOnServerClose = true`:
  prefix past entityLimit written, then bounded wait for the server flow's termination, then the remainder).
- GREEN (`tolerant = true`: reader thread started before any write, write IOException tolerated, socket closed only
  after the reader joined): the same request returns 413 with a message, ungated (the shipped pdf case) and under the
  forced ordering (shipped test "...written after the server closed (forced ordering)"). csv-naive.log: 19/19 passed.
- Real-server 413 cases now using the helper: infer over-limit, data-sources over-limit, pdf over cap, oversized metadata
  part. Success (200/201) cases keep `postOverHttp`. Caveat: relies on Linux keeping response bytes that arrived before an
  RST readable.

Stress (one sbt JVM, `nice -n 19`, MemAvailable 50 GB before, 50 repeated `testOnly` in one batch session):
- fixed spec: 50/50 runs "Tests: succeeded 18, failed 0", 0 `*** FAILED`, 0 Broken pipe (csv-stress-fixed.log).
- OLD spec (git checkout of the file, restored afterwards): 50/50 runs "succeeded 17, failed 0" -- the flake does not
  reproduce locally even over 50 runs, consistent with the 0/40 earlier. Supporting evidence only, not proof.

### Cycle 2 additions
- The item-1 decision above was the driver's technical decision, not an owner ruling.
- The naive client is now guarded by a shipped test ("premise guard: a naive write-everything-then-read client hits Broken pipe
  on the same pdf request"); cycle2.log: CsvUploadLimitsRoutesSpec + ConnectorRepositoryDeleteAtomicitySpec 23 passed, 0 failed.
- The atomicity fault-injection case now also asserts the credential still decrypts to the known test plaintext.
- Persisted logs (main checkout): /home/matt/Development/helio/.concertino/runs/HEL-1505/evidence/backend/target/hel1505-logs/
  csv-naive20.log (red 20/20), csv-naive.log (green 19/19), csv-stress-fixed.log (50/50), csv-stress-old.log (50/50 old spec passing).
