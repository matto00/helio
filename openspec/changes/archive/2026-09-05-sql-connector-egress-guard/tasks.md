## 1. Reusable host-level egress entry point

- [x] 1.0 **(round-3 CR3)** Refactor `ContentSourceSupport.checkEgress`: extract its resolve-and-classify block as
      `checkResolvedHost(host, resolveHost, isBlocked): EgressCheck`, and have `checkEgress` call it with
      `uri.getHost`. Behaviour-preserving — `ContentSourceSupportSpec` and `RestConnectorEgressGuardSpec` must pass
      **unchanged**; run them before and after and record both.
- [x] 1.1 Add `ContentSourceSupport.checkEgressHost(host, resolveHost, isBlocked): EgressCheck`, synthesising an
      `https` authority and delegating to the extracted `checkResolvedHost` core with the CALLER-SUPPLIED host (not `uri.getHost`). Do not touch `isBlockedAddress`, and do not
      copy any part of the policy.
- [x] 1.2 **(CR1)** Implement BOTH host-identity defences before any resolution happens: (a) a strict charset gate
      refusing any host with a character outside `[A-Za-z0-9.\-:\[\]]`, and (b) a round-trip assertion that
      `uri.getHost` equals the supplied host, normalising the IPv6 bracket form. Do not rely on the multi-arg
      `java.net.URI` constructor to reject malformed hosts — it demonstrably does not.
- [x] 1.3 **(CR1)** Test one rejected form per injection shape, each asserting `Invalid`: `evil.test/@internal`,
      `evil.test#@internal`, `evil.test?x@internal`, `a:b@internal`, `host,other` (mysql multi-host failover),
      a host with whitespace. Plus a test that the exact string validated is the exact string interpolated into the
      JDBC URL.
- [x] 1.3a **(round-2 CR3)** Use the multi-argument `java.net.URI` constructor (not the single-arg form), and hand the
      caller-supplied `host` — not `uri.getHost` — to `resolveHost`.
- [x] 1.4 Unit-cover `checkEgressHost`: a host resolving to a public address is `Allowed`; a non-resolving host is
      `Unresolvable`; `::1` in bracket form round-trips correctly rather than being refused as a mismatch.

## 2. Prove the SSRF is currently reachable (RED, before any guard is wired in)

- [x] 2.1 Add `backend/src/test/scala/com/helio/domain/connectors/SqlConnectorEgressGuardSpec.scala` starting its own
      EmbeddedPostgres on loopback. No Flyway migration, no shared dev DB, no Playwright, no e2e.
- [x] 2.2 Write a test asserting `SqlConnectorDriver.execute` against that loopback instance **returns rows**, and run
      it green. Capture the transcript. This is the proof the SSRF is real and the fixture actually reaches a database
      — a fixture that could not have connected proves nothing.
- [x] 2.3 Record the transcript in the change directory as evidence before proceeding.

## 2a. Test-injection seam (CR2 — do this before tasks 4/6, do not improvise it)

- [x] 2a.1 Add defaulted `resolveHost` / `isBlocked` parameters to the `ConnectorDriver` **trait** methods (`fetch`,
      `testConnection`, `inferSchema`). **(round-3 CR1)** Default args spare CALLERS but NOT IMPLEMENTERS: every
      existing override breaks with "Missing implementation for member of trait" unless widened in the same commit.
      Re-derive the implementation list with `grep -rn "extends ConnectorDriver"`; the round-3 skeptic found
      `RestApiConnectorDriver.scala:58`, `NewConnectorInferenceSpec.scala:25`, `ConnectorSpec.scala:19`,
      `CreateSourceEnvelopeSpec.scala:30`. Also add them to `SqlConnectorDriver.connect` / `checkConfigEgress` / `execute`.
      `SqlConnectorDriver` is a singleton `object`, so there is NO constructor seam on the driver; do not attempt one.
- [x] 2a.1a Thread an override through `InProcessPipelineEngine`'s constructor to its `fetch` call site
      (`InProcessPipelineEngine.scala:645`), so engine-level specs can admit their known test host.
- [x] 2a.2 Add a defaulted constructor parameter on `SourceService`, wired from `ApiRoutes`, mirroring the existing
      REST pattern (`DataSourceRoutesSpec:85,214`, `RestApiConnectorDriverSpec:87`).
- [x] 2a.2a **(round-3 CR2)** Forward the same defaulted parameters through `CreateSourceEnvelope.build`
      (`SourceService.scala:65`) and `ConnectionTest.run` (`SourceService.scala:220`) — without this the
      service-level override never reaches the `inferSchema` that opens the connection. Trace the create path end to
      end and DEMONSTRATE the override arrives at `connect`; proving it was passed is not proving it was used.
- [x] 2a.3 Confirm no mutable global, system property, or environment variable is used as a test hook — a guard
      switchable by ambient process state is not a guard. If no clean seam exists, escalate rather than improvise.

## 3. Connect-time guard (the security boundary)

- [x] 3.1 Add `SqlEgressRefusedException` and `SqlConnectorDriver.checkConfigEgress(config, resolveHost, isBlocked):
      Either[String, Unit]`, failing closed on `Disallowed`, `Invalid`, **and** `Unresolvable`.
- [x] 3.2 Call it from `SqlConnectorDriver.connect` before `DriverManager.getConnection`, throwing on `Left`.
- [x] 3.3 Flip task 2.2's test to assert the loopback call is now **refused**, and that the failure is the egress
      refusal — not a timeout, a missing driver, or a fixture error.

## 4. Blocked-class coverage (AC1, AC2)

- [x] 4.1 One assertion per class, via an injected resolver: loopback `127.0.0.1`, link-local `169.254.169.254`,
      private `10.0.0.1`, `192.168.1.1`, `172.16.0.1`, IPv6 loopback `::1`, IPv6 ULA. Not one representative.
- [x] 4.2 DNS-name cases: a `.test` hostname resolving to each internal address is refused, proving the guard checks
      the resolved address rather than string-matching `"localhost"`.
- [x] 4.3 Confirm the multi-record case: a host resolving to one public **and** one internal address is refused.

## 5. Create-time guard (AC1)

- [x] 5.1 Guard `SourceService.createSql`, treating `Disallowed`/`Invalid` as `BadRequest` and `Unresolvable` as
      acceptable.
- [x] 5.2 Test rejection at create time for each blocked class, and that nothing is persisted on rejection.
- [x] 5.3 Test that an unresolvable host is still creatable, and that connecting to it is nonetheless refused.

## 6. Legitimate hosts still work (AC4)

- [x] 6.1 A resolver mapping a `.test` hostname to a public address returns `Allowed`.
- [x] 6.2 Using the admit-the-known-test-host `isBlocked` override, a real end-to-end connection to the EmbeddedPostgres
      instance still succeeds and returns rows — proving the guard refuses because of the policy, not indiscriminately.

## 7. Mutation check

- [x] 7.1 Neutralise the refusal branch, re-run, and confirm the blocking tests go red **on the refusal assertion**.
      If the red is for any other reason, record and discard it and fix the test until the red is for the right reason.
- [x] 7.2 Restore the guard, confirm green, and record both transcripts as evidence.

## 8. Regression sweep and hygiene

- [x] 8.1 **(CR3)** Regression sweep covering BOTH connect-time and create-time breakage — specs that merely *create*
      a SQL source with a loopback host now get a `400`, not just those that open a connection. Re-derive the list
      independently by grep; the round-1 skeptic's enumeration, to be checked against and not trusted, was:
      `SqlConnectorDriverSpec:36`, `InProcessPipelineEngineSpec:76`, `AuditMutationInstrumentationSpec:1108`,
      `PipelineAnalyzeProposalRoutesSpec:149`, `PipelineRunRoutesSpec:289,305`,
      `PipelineApplyProposalRollbackSpec:82,162`, `DataSourceRoutesSpec:964`. State the count found.
- [x] 8.1b **(round-2 CR2)** Repair each affected spec by injecting an admit-the-known-test-host `isBlocked` override
      through the task-2a seam (engine constructor / service constructor / driver parameter). Deleting a spec,
      marking it `ignore`, or rewriting it to route around the guard is NOT an acceptable repair — a fixture edited to
      make the suite pass is a symptom, not a fix. State per spec which seam was used.
- [x] 8.1a **(CR4)** Grep to confirm no SQL config-update path exists (only rename at `DataSourceService.scala:552`;
      inline proposal creation routes through `createSql` at `PipelineProposalService.scala:344-351`). Record the
      result. If an update path IS found, it needs the same guard and AC1's "or updated" is not vacuous.
- [x] 8.2 Confirm no real credential and no real internal hostname appears anywhere in the diff; use `.test` names and
      documentation-range addresses only.
- [x] 8.3 Run the backend gates (`sbt test` scoped as needed, plus the repo's pre-commit gates). Do not run e2e or
      Playwright.
