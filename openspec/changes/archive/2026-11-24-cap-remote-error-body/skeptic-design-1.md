## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed tree: HEAD 2ce5a8f23334b44c5ab448ea928535bc33b5d709 (planning artifacts untracked; no code changes yet).

### What I verified (with evidence)

**(a) The two driver builders are the only places that build remote-body error text. Confirmed.**
- `grep -rn 'HTTP \$' backend/src/main` finds exactly `RestApiConnectorDriver.scala:367` (`Left(s"HTTP $code: $body")`,
  issueAndParse) and `:391` (`Left(s"HTTP $code: ${entity.data.utf8String}")`, issueTest). The other hits omit the
  body: `ContentSourceSupport.scala:362` (`Upstream returned HTTP $code`) and `ClaudeWireModels.scala:147`.
- Every REST request-issuing entry point goes through one of the two builders. `doFetch` (:326),
  `inferSchemaForConnector` (:448) and `fetchEphemeral` (:532) call `issueAndParse`; `testConnection` (:414) and
  `testConnectionEphemeral` (:539) call `issueTest`. The 2xx JSON-parse failure is already curated ("Failed to parse
  JSON response"). `.recover` gives "Request failed". `fetchOverride` bypasses both builders, but only in tests.

**(b) The helper belongs in the domain layer. The decision is right; the rationale contains a false statement (see
notes).**
- `PipelineRootDryRun` is `private[services]` (PipelineRootDryRun.scala:19 and :60), so code in
  `com.helio.domain.connectors` cannot reference `capFetchError` where it lives now. Moving it down to the domain layer
  is the only placement both callers can see.
- design.md Decision 1 says "services depend on domain, never the reverse". That is false in this tree:
  `RestApiConnectorDriver.scala:7` imports `com.helio.services.sources.ContentSourceSupport`, and six domain files
  import `com.helio.services`. The decision still stands. Placing the helper in the domain layer adds no new
  domain→services edge.

**(c) Idempotence. Confirmed by reasoning over the code at PipelineRootDryRun.scala:71-73.**
- For an input of 500 code points or fewer, `cap` returns it unchanged.
- For a longer input `x`, `cap(x)` is `p + marker`, where `p` is the first 500 code points of `x`. That result has
  500 + 14 code points, so a second cap cuts it again. The cut takes the first 500 code points of `p + marker`,
  which is `p` itself, and appends the marker. The result equals `cap(x)`.
- `entity.data.utf8String` replaces malformed UTF-8, so lone surrogates cannot arise. Even if one did,
  `offsetByCodePoints` counts it as one code point, so the argument still holds.
- Task 2.4 pins this with a test.

**(d) Each of the three planned tests would be red before the fix. Confirmed for all three, with one trap noted.**
- *Driver test (1.1):* real driver plus a stub server returning 500 with 100k characters. Today the full body comes
  back, so an exact-equality assertion fails. A working pattern for admitting the loopback stub exists:
  `SourceServiceBareUrlQueryParamsSpec.scala:119-120` passes `isBlocked` that admits `localhost` to a real
  `RestApiConnectorDriver`.
- *test_connection test (1.2):* `AssistantToolExecutor.scala:194-198` takes `sourceService.testRest`, which calls
  `connector.testConnectionEphemeral` (SourceService.scala:382-384), and serializes `TestConnectionResponse.error`
  unchanged. Nothing on this path caps today, so the test goes red.
- *Apply test (1.3):* `apply` (PipelineProposalService.scala:204-219) runs `dryRun` first. The dry run caps through
  `PipelineRootDryRun`, but only to make its own decision. `resolveAllRoots` then creates the source again through the
  driver, and the raw `csr.fetchError` is put on `ResolvedSource.fetchError` (:520). `finishPipeline` interpolates
  that raw text (:616). So the blocked reason carries the full body today, and the test goes red.
- **Trap:** if the apply test's proposal includes an Output with a `fieldMapping` on the failing root, apply's own
  dry run rejects it with text the dry run has already capped. The test would then never reach `finishPipeline`.
  Asserting `run.blockedReason` guards against this, because that assertion cannot be satisfied by a rejection. The
  test should still use `outputs: []` or an output with no fieldMapping, as the existing
  `PipelineApplyProposalRollbackSpec` blocked case does. The stub is also hit twice (once by the dry run, once by the
  create), so it must return 500 on every call.
- *Existing tests that would break:* none found. No assertion on an `HTTP <code>:` error longer than 500 code points.
  - `ApiRoutesSpec.scala:1043-1047` uses a 30-character stub error.
  - `ProposalDryRunRestSchemaSpec.scala:167` uses `include("HTTP 500")`.
  - `ProposalDryRunFetchHardeningSpec` feeds raw strings through a mocked `SourceService` and still goes through the
    dry run's cap.
  - `AssistantToolExecutorSpec.scala:536-551` mocks a 100k fetchError and expects `[truncated]`, which the dry run
    still produces.

**Other design checks**
- *Placeholders:* none found.
- *Contradictions:* proposal, design, tasks and the spec delta agree with each other. The spec delta does not
  conflict with any existing requirement:
  - `proposal-dry-run-validation` "Dry-run fetch-failure text is capped" uses the same 500 code points and the same
    marker.
  - `fetch-error-envelope` and `rest-api-connector` say nothing about non-2xx body text.
- *AC coverage:*
  - AC1 (one shared function, reused by the dry run): tasks 2.1 and 2.2.
  - AC2 (cap in both builders): task 2.3.
  - AC3 (red-first test per path, with a surrogate pair at the cut): tasks 1.1-1.4.
  - AC4 (helio-mcp): task 2.5.
  - AC5 (PR states the stored-text side effect): task 3.2.
- *Scope:* no work beyond the ticket. The extra consumers that now get capped text (source `fetchError`,
  `error_log`, sample 502) are the owner's ruling and are named as a side effect.

### Verdict: CONFIRM

### Non-blocking notes
1. Fix the rationale in design.md Decision 1. The tree already has domain→services imports
   (`RestApiConnectorDriver.scala:7`), so "services depend on domain, never the reverse" is false. The real reasons
   for the domain-layer helper are:
   - `PipelineRootDryRun` is `private[services]`, so the driver cannot see the current helper.
   - Placing the helper in the domain layer avoids adding a new domain→services edge.
2. Task 1.2 says "the assistant tool (or `SourceService.testRest` feeding it)". AC3 names "the `test_connection`
   result". Test through `AssistantToolExecutor.execute("test_connection", ...)` with a real `SourceService` and the
   real driver, so the test covers the tool result the AC names.
3. Apply test (1.3): see the trap above. Do not give it a fieldMapping Output on the failing root, and make the stub
   return 500 on both of its calls (dry run and create).
4. Surrogate case for the driver and apply tests: the cap applies to the whole `HTTP 500: ` + body string, a 10-unit
   prefix. Size the body so the astral character occupies UTF-16 units 499-500 of that full string, not of the body.
   For apply, also assert that the cut sits inside the quoted error, not at the cut of the whole `reason`.
