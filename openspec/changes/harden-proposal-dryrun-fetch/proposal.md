## Why

HEL-1638 made propose dry-run apply's checks, including one live schema fetch per inline rest/sql root. That fetch has
three hardening gaps and one stale doc (see ticket.md): an uncapped remote error body flows into the rejection and the
assistant's `is_error` tool result; nothing pins the SSRF guard on that fetch; a step error found after the fetch makes
every retry spend a source-fetch rate-limit unit; and helio-mcp's `propose_pipeline` description says SQL is "never
re-validated here".

## What Changes

- The fetch-failure text an inline root's dry run carries is capped (500 characters, code-point safe, with a visible
  truncation marker) before it reaches any rejection message or tool result. Both the pipeline proposal path and the
  patch-set pipeline-create path share this, because both go through the same root dry run.
- A new spec issues the propose-time dry run of an inline REST root at a loopback URL served by an in-test server,
  with the real egress guard, and asserts the guard's refusal and zero requests reaching the server. A mutation that
  routes the fetch around the guard turns it red.
- The pipeline proposal dry run runs its request-only preflight and cross-owner checks (step and Output checks that need
  no schema) before any root's charged fetch, matching the patch-set resolver's existing order. The Output column
  check still needs the fetched schema and stays after it (documented).
- helio-mcp `propose_pipeline`'s description states what propose actually checks (apply's pre-write checks as a dry run,
  including one rate-limited live fetch per inline rest/sql root), replacing "never re-validated here".

## Capabilities

### New Capabilities

### Modified Capabilities
- `proposal-dry-run-validation`: adds requirements for the fetch-failure text cap, the guarded fetch, and the check order.
- `mcp-pipeline-proposal-tools`: adds a requirement that `propose_pipeline`'s description matches the dry run.

## Impact

- Backend: `services/pipelines/PipelineRootDryRun.scala`, `PipelineProposalService.scala`; new/extended specs under
  `backend/src/test/scala/com/helio/services/pipelines/` and the assistant tool tests.
- helio-mcp: `src/tools/pipelineProposal.ts` description text (+ a description test). Needs an MCP redeploy at release.
- No migration, no API shape change, no frontend change.

## Non-goals

- Capping REST/SQL error text on other paths (source preview, run `error_log`, proposal apply's unrunnable-run reason).
- An SSRF spec for the SQL dry-run fetch (SQL egress is already pinned by `SqlConnectorRebindingSpec`).
- Capping the `test_connection` tool result's error body (`issueTest`, same uncapped `HTTP <code>: <body>`; a
  follow-up candidate).
- Moving the Output `fieldMapping` column check before the fetch (it needs the fetched schema).
