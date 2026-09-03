## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence)

Every citation below was read from source in this worktree, not from round 1's report or the
planner's summary.

**Round-1 CR1 (error classification) — resolved, and the load-bearing new claim is TRUE.**
- `SourceService.scala` maps driver `Left`s to `ServiceError.BadGateway` at lines 167, 189, 198,
  279, 294, 322, 335, 342 (`grep -n BadGateway`; line 338 is a comment, not a site). So an egress
  refusal from `issueAndParse` on the infer/refresh/preview paths does surface as a 502 — as
  Decision 8 and the amended `rest-api-connector` / `connection-test-endpoint` specs now state.
- The specific claim I was asked to check — that `POST /api/sources/test` returns **200 with
  `ok = false`**, not an error status — is **TRUE on both of its branches**:
  - `connectorId` branch → `ConnectionTest.run` (`ConnectionTest.scala:22-25`):
    `case Left(err) => TestConnectionResponse(ok = false, error = Some(err))`, wrapped `Right(_)`.
  - bare-`url` branch → `SourceService.scala:229-230`: `case Left(err) => Right(
    TestConnectionResponse(ok = false, error = Some(err)))`.
  Only the pre-flight validation failures (auth present, both/neither of `connectorId`/`url`) are
  `BadRequest`; a driver-returned refusal is not one of those. Task 4.3's split (infer = 502-class,
  test = 200/`ok=false`) is correct.

**Round-1 CR2 (wiring site) — resolved and correct.**
- `grep -rn "new RestApiConnectorDriver" backend/src/main/scala` → exactly one hit,
  `com/helio/app/Main.scala:165`. Design Decision 5 and task 2.5 now name it.
- `ApiRoutes.scala:73` is `connector: RestApiConnectorDriver` — a received param, not a
  construction. Confirmed.
- The `dataSourceUrl*` seam is at `ApiRoutes.scala:104` (`dataSourceUrlResolveHost`) and `:111`
  (`dataSourceUrlIsBlocked`), matching the cited 104-111 range.
- `ConnectorEntityService` is constructed at `ApiRoutes.scala:470-472`; task 3.4's "line 472" is the
  construction expression. Correct.
- The fixture strategy is now stated (Decision 5: route-level specs build their own driver with
  `fetchOverride = None` + hostname-keyed `isBlocked`, and hand it to `ApiRoutes`), which is what CR2
  asked for.

**Round-1 CR3 (`fetchOverride`) — resolved.**
- `RestApiConnectorDriver.scala:45` `fetchOverride` default `None`; `:228` `fetch` short-circuits on
  it; `:385` `fetchEphemeral` short-circuits on it; `:408` `testConnectionEphemeral` does **not** —
  it goes straight to `buildEphemeralRequest` → `issueTest`. The asymmetry Decision 2 and task 4.3
  describe is real.
- Issuer exhaustiveness re-verified independently: only two `singleRequest` calls in the file
  (`:281` in `issueAndParse`, `:306` in `issueTest`); `testConnection` (`:323`) → `issueTest`;
  `fetch(config, maxRows, ctx)` (`:350`) delegates to `fetch(config, ctx)`; `inferSchemaEphemeral`
  → `fetchEphemeral`. No fifth exit.
- Tasks 4.4 and 4.7 now mandate `fetchOverride = None`. Task 1.0 additionally requires listing which
  egress tests set it.

**Round-1 CR4 (Decision 3 citation) — resolved.**
- `ContentSourceSupport.scala:227-237` carries the probe-confirmed root-cause comment ("…not a
  cosmetic rename of `isSuccess`") and `val code = response.status.intValue()`. Design Decision 3 and
  task 2.4 now quote the explicit 2xx-range idiom, not `isSuccess && !isRedirection`.
- The defect being fixed is still present: `RestApiConnectorDriver.scala:285` and `:309` both use
  `response.status.isSuccess()`.

**Not reached by round 1, checked now.**
- Ticket ACs → task coverage: create/update per-class (4.1/4.2 ← AC1); infer/test per-class (4.3 ←
  AC2); rebinding pin (4.5 ← AC3); redirect (4.6 + 2.4 ← AC4); enumeration (5.1 ← AC5); stored-data
  disposition (5.2 ← AC6); live Sleeper endpoint (5.3 ← AC7). All seven ACs traceable; no orphan task.
- `ContentSourceSupportSpec.scala:249-265` is indeed the DNS-rebinding regression block with the
  unresolvable-hostname construction task 4.5 now names. The model is real and discriminating.
- Spec-file cross-consistency: `outbound-egress-guard`, `connectors/connector-management` (400-class,
  create-time non-authoritative), and `rest-api-connector` (502-class fetch-time, create/update
  unaffected) agree with each other and with Decision 4 / Decision 8.

### Verdict: REFUTE

Two of the four round-1 change requests' fixes did not propagate all the way, and one of them
re-creates in `proposal.md` the exact contradiction CR1 was raised to remove. Both are small and
purely editorial to the artifacts — no rework of the approach.

### Change Requests

1. **`proposal.md` still asserts the 400-class outcome that Decision 8 and both amended specs now
   reject.** `proposal.md:46-47` (Impact) reads: "`POST/PATCH /api/connectors`, `POST
   /api/sources/infer`, `POST /api/sources/test`, and every REST source refresh/preview/pipeline-run
   fetch **gain a 400-class rejection** for disallowed destinations." That is now false for three of
   the four listed surfaces: `infer` and refresh/preview/pipeline-run are 502-class (Decision 8,
   `rest-api-connector/spec.md`), and `test` is a 200 with `ok = false` (`connection-test-endpoint/
   spec.md`, verified above against `ConnectionTest.scala:24-25` and `SourceService.scala:229-230`);
   only the Connector create/update path is 400-class. Rewrite that Impact bullet to state the three
   distinct outcomes. Left as-is, the proposal and the specs contradict each other on the single
   point round 1 refuted, and an executor reading the proposal first will write the wrong assertion.

2. **Decision 8's own sentence is inaccurate in two ways, in the section whose entire purpose is to
   settle error classification.** design.md:130-131 says `SourceService` "blanket-maps **every**
   driver `Left` to `ServiceError.BadGateway` (502) at **nine** sites (lines 167, 189, 198, 279, 294,
   322, 335, 342)."
   - It lists eight line numbers, not nine, and `grep -n BadGateway` returns exactly eight
     construction sites (338 is a comment line).
   - "every driver `Left`" is false: `testRest`/`testSql` do **not** route a driver `Left` through
     `BadGateway` — they convert it to a `Right(TestConnectionResponse(ok = false, …))` (200). This
     is the one path Decision 8's conclusion does not apply to, and it is the path task 4.3 correctly
     treats differently — so the decision text contradicts its own task.
   Correct the count and scope the sentence to the fetch/infer paths, explicitly excepting the
   `testRest`/`testSql` 200-with-`ok=false` channel (with the `ConnectionTest.scala:24-25` citation).

### Non-blocking notes

- **Task 4.3 is the weakest link left in the `fetchOverride` fix.** 4.4 and 4.7 now *mandate*
  `fetchOverride = None`; 4.3 only says "respect that `fetchEphemeral` consults `fetchOverride` while
  `testConnectionEphemeral` does not". The infer half of 4.3 runs through `fetchEphemeral`
  (`:385`), so a fixture-built driver carrying a `fetchOverride` makes that assertion pass without
  ever reaching the guard — the same defect class CR3 refuted on. Recommend adding "the driver MUST
  be constructed with `fetchOverride = None`" to 4.3 as well, matching 4.4/4.7's wording. Not
  blocking, because the hazard is named in the task line itself and task 1.0 forces the executor to
  enumerate which egress tests set it.
- **On design.md's length: I agree with the planner.** All ~23 lines over the guideline are Decision
  8, Decision 2's bypass paragraph, and Decision 5's split wiring sites — i.e. exactly the content
  round 1 required. Cutting skeptic-mandated material to hit a style target would trade a real
  correctness record for a cosmetic one. No change requested.
- Decision 2's guard key is `request.uri.toString`, which on the resolved path may carry an injected
  query-param credential (`injectAuthQueryParam`). `resolveValidated`'s messages echo only the host,
  so the refusal message is safe — but the executor must not log the URI on refusal (HEL-311
  convention). Carried forward from round 1's notes; still unaddressed in the artifacts, still
  non-blocking.
- Decision 6's table scope (`backend/src/main/scala`, not the test tree) is now stated in Decision 6
  itself and in the Planner Notes. Good.
