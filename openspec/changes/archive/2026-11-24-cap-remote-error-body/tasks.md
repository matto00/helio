## Standing Constraints

- [C1] The test_connection red test goes through `AssistantToolExecutor.execute("test_connection", ...)` with a real `SourceService` and the real `RestApiConnectorDriver` against a local stub server, asserting the tool result text.
- [C2] The apply red test has no Output with a fieldMapping on the failing root (else apply's dry run rejects first and finishPipeline is never reached); the stub returns HTTP 500 on every call (dry run and create); it asserts `run.blockedReason` and the stored run `error_log`.
- [C3] Surrogate cases place the astral character at UTF-16 units 499-500 of the WHOLE `HTTP 500: ` + body string (10-unit prefix), and for apply assert the cut is inside the quoted error.

## 1. Red first

- [x] 1.1 Driver test: real `RestApiConnectorDriver` against a local stub server returning HTTP 500 with a
      100,000-character body, for both `fetch` (issueAndParse) and `testConnection` (issueTest): error is exactly the
      first 500 code points + ` … [truncated]`; a surrogate pair straddling the cut is not split; a short error is
      unchanged.
- [x] 1.2 `test_connection` test: the assistant tool (or `SourceService.testRest` feeding it) through the real driver
      against the stub server; tool result error text is capped, surrogate case included.
- [x] 1.3 Proposal apply test: inline REST root against the stub server through the real driver;
      `run.blockedReason` (and the stored run `error_log`) contain the capped text with the marker and not the full
      body, surrogate case included.
- [x] 1.4 Run them, confirm red, commit the red output as `.txt` evidence before implementation.

## 2. Implement

- [x] 2.1 Add the shared helper in `com.helio.domain.connectors` (500 code points, ` … [truncated]`, surrogate-safe),
      moving HEL-1727's implementation and doc comment.
- [x] 2.2 `PipelineRootDryRun` uses the shared helper; no second definition of 500 or the marker remains.
- [x] 2.3 Apply the helper in `issueAndParse` and `issueTest`.
- [x] 2.4 Idempotence test (`cap(cap(x)) == cap(x)`); existing ProposalDryRunFetchHardeningSpec still green.
- [x] 2.5 Grep helio-mcp for any consumer needing change; record the result for the PR.

## 3. Verify

- [x] 3.1 Full affected spec files green (driver, assistant tool executor, apply proposal, dry-run hardening,
      ApiRoutesSpec fetchError tests).
- [x] 3.2 PR body states the side effect (stored source fetchError and run error_log capped) and the helio-mcp result.
