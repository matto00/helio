# HEL-1617: helio-mcp crashes (unhandled rejection) when get_workspace_context hits rate-limit 429s past its retry budget

## Description

Found 2026-10-16 while fixing a helio-news production failure. The crash broke a live run and left 7 production news
boards empty.

**Bug:** in `helio-mcp/src/context.ts` `buildWorkspaceContext` (around lines 485–520),
`outputsByPipelinePromise = fetchAllOutputs(api).then(...)` starts BEFORE the fail-fast
`Promise.all([listDataSources, ...])`. When that `Promise.all` rejects first, for example on a 429 past the 30s retry
budget (HEL-1349/HEL-1381), the outputs promise is never awaited. If it also rejects, Node 22 treats it as an unhandled
rejection and kills the whole MCP server process. The comment claims an outputs failure "degrades only the outputs
field", but `fetchAllOutputs` has no catch, and `src/` has no `unhandledRejection` handler.

Evidence: the helio-news verification run log (driver scratchpad `helio-news-fix/run.log`, since LOST in a /tmp wipe —
the crash must be reproduced red-first by a test instead), with Node's unhandled `HelioRateLimitError` from
`fetchAllOutputs (dist/context.js:128)`.

## Fix

- Make the outputs fetch degrade as documented: catch it to an empty map, or use `Promise.allSettled`.
- Consider a `process.on('unhandledRejection')` safety net that logs and keeps serving.
- Add a red-first test where `listDataSources` and `listAllOutputs` both return 429s past the budget. The process must
  survive, and the tool must return a structured error.

## Acceptance Criteria

1. When `listDataSources` (fail-fast group) and `listAllOutputs` both return 429s past the retry budget, the helio-mcp
   process does not crash (no unhandled rejection) and `get_workspace_context` returns a structured `isError` result
   naming the rate limit.
2. When only the Outputs fetch fails, `get_workspace_context` still succeeds: every pipeline's `outputs` is `[]` and the
   failure is signalled (not silently indistinguishable from "no Outputs").
3. A red-first test reproduces the crash on the unfixed code and passes on the fix; red and green are both recorded.
4. A process-level `unhandledRejection` safety net logs to stderr and keeps serving.

## Related (assess and record; do not fix here without escalating)

- `get_workspace_context` sends about 4 requests per pipeline; on a 55-pipeline workspace one call uses up the
  120/60s rate limit. Consider lower context-build concurrency or a slimmer default.
- HEL-1524 made `expectedLayoutVersion` REQUIRED on `update_dashboard_layout`, a breaking MCP contract change with no
  fallback. It broke helio-news silently. At minimum, document it in the release notes or changelog.
