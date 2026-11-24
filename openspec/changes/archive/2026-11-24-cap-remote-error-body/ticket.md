# HEL-1841: Cap the remote error body in test_connection results and the proposal-apply blocked-run reason

## Description

HEL-1727 (PR #1251) capped a failed propose-time fetch's error text at 500 code points plus ` … [truncated]`, without
splitting a surrogate pair. Two other paths still carry the same uncapped `HTTP <code>: <body>` text:

1. `test_connection`. Its result goes into the model's context, and the assistant must call it before proposing. A
   large or hostile remote body can still flood the tool result and the model's context, which is the risk HEL-1727
   targeted.
2. Proposal apply's blocked-run reason (`finishPipeline`).

## Owner scope ruling (2026-11-24, escalation HEL-1841-1795541496006-54b5a5)

Answer: `cap-at-driver-all-paths`. Premise validation found the uncapped text is built in exactly two places,
`RestApiConnectorDriver.issueAndParse` and `issueTest`, and reaches more consumers than the two above (source
create/infer `fetchError`, refresh/rows fetch errors, the persisted run `error_log`, the sample route's 502, the REST
test-connection route). The cap is applied at those two builders, through one shared helper moved from HEL-1727's
`PipelineRootDryRun.capFetchError`, so every consumer is capped.

## Acceptance criteria

- [ ] Both paths reuse HEL-1727's cap (500 code points + ` … [truncated]`, surrogate-safe); no new cap value; one
      shared function, which `PipelineRootDryRun` also uses.
- [ ] The cap is applied in both `RestApiConnectorDriver` builders (`issueAndParse`, `issueTest`).
- [ ] A red-first test per path shows an oversized body truncated, with a surrogate pair at the cut: the
      `test_connection` result, the apply blocked-run reason, and one at the driver.
- [ ] Any helio-mcp change is source only, and the PR notes the MCP redeploy (or states no helio-mcp change).
- [ ] The PR states the side effect: stored source `fetchError` and run `error_log` text are now capped too.
