## Standing Constraints

- [C1] Red-first: the 3.1 seam test's failing output against base src must be recorded before the fix is claimed; every jest run cited as evidence must show a non-zero count of collected helio-mcp tests from THIS worktree (not the main checkout).

## 1. Backend (helio-mcp)

- [x] 1.1 Add `runWithRateLimitScope` + ALS store in `helio-mcp/src/httpClient.ts`; `dispatch` charges the shared budget inside a scope, local budget outside (verify: httpClient unit tests 3.2)
- [x] 1.2 Honor the scope's abort signal before attempts and during 429 sleeps per design D4 (verify: abort unit test 3.2)
- [x] 1.3 Wrap `registerTool`/`registerResource` in `createServer` so every handler runs in a scope bound to `extra.signal` (verify: scope guard 3.3)
- [x] 1.4 Update the `httpClient.ts` header doc comment to describe the per-invocation budget (verify: reviewed in diff)

## 2. Docs

- [x] 2.1 Update `helio-mcp/README.md` rate-limit section if it describes the per-request budget (verify: grep "per request"/"30" in README)

## 3. Tests

- [x] 3.1 Seam test per design "Test plan": run_pipeline, 5s fetch latency, two 429 Retry-After 25 -> RED on base (-32001, record output), GREEN on fix (isError, "25s")
- [x] 3.2 httpClient unit tests: shared budget in scope, per-request outside scope, abort stops waiting without re-send
- [x] 3.3 Guard: tool registered via `createServer` runs in a scope; no non-test `src/` file uses deprecated `server.tool(`/`server.resource(`
- [x] 3.4 Mutation proofs recorded: budget 31_000 turns HEL-1349 guard red; removing the createServer wrapper turns 3.1/3.3 red
- [x] 3.5 `npm --prefix helio-mcp run typecheck`, root `npx jest helio-mcp`, lint on changed files all green
