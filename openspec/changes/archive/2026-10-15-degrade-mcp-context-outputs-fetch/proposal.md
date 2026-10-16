## Why

`get_workspace_context` starts the Outputs fetch before a fail-fast `Promise.all` and awaits it only afterwards. When a
429 past the retry budget rejects the `Promise.all`, the Outputs promise is orphaned; if it also rejects, Node 22's
default `--unhandled-rejections=throw` kills the whole helio-mcp process (HEL-1617, broke a helio-news production run).
Even on the success path, an Outputs failure fails the whole call, contradicting the code's own "degrades only the
outputs field" comment.

## What Changes

- The Outputs fetch in `buildWorkspaceContext` gets its own catch: on failure every pipeline's `outputs` is `[]` and a
  new optional top-level `outputsError` string carries the failure message (omitted on success — additive).
- `index.ts` installs a `process.on("unhandledRejection")` safety net that logs a bounded line to stderr and keeps the
  server running.
- A red-first test reproduces the crash (429s past the budget on `listDataSources` and `listAllOutputs`) and asserts the
  tool returns an `isError` rate-limit result with no unhandled rejection.
- `helio-mcp/README.md` gains a short contract-change note for HEL-1524's required `expectedLayoutVersion`.

## Non-goals

- Reducing context-build request volume / concurrency (assessed and recorded; follow-up if warranted).
- Changing retry budgets, backoff, or the per-invocation deadline (HEL-1349/HEL-1381).
- Making `expectedLayoutVersion` optional again.

## Capabilities

### New Capabilities

### Modified Capabilities
- `mcp-rate-limit-handling`: adds a requirement that a rate-limited workspace-context build never crashes the
  process and degrades the Outputs section with a signal.

## Impact

`helio-mcp/src/context.ts`, `helio-mcp/src/index.ts` (or a small extracted module), new test(s) under
`helio-mcp/src/`, `helio-mcp/README.md`. No backend, frontend, schema or migration change. The gitignored
`helio-mcp/dist` must be rebuilt by local consumers for the fix to take effect.
