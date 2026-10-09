## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD `399b82d8034fed25a008de2e896f43e7686a4851`. I resolved the base live with `resolve-review-base.sh` (`1bf11f55f8039bf7248fcdb61c28a52810a545db`) and diffed `BASE...HEAD`. Source changes are limited to `helio-mcp/src/{httpClient,server}.ts` plus 3 test files. Nothing touches HEL-1382 or HEL-1383.

### What I verified (with evidence)

- **Spawn guard:** `assert-cwd.sh` returned `READY ambient=/home/matt/Development/helio branch=bug/mcp-per-tool-call-deadline/HEL-1381`.
- **C1, tests come from this worktree:** `npx jest helio-mcp --listTests` lists 43 paths, all under `.../HEL-1381/helio-mcp`. A full run on HEAD (`nice -n 19`, `--maxWorkers=3`) gave 43 suites and 418 tests passed.
- **AC2, red-first on base, re-established by me:** I checked out base `httpClient.ts` and `server.ts` and ran `rateLimitSeam.test.ts`.
  - The `run_pipeline ... two 25s Retry-Afters` test fails with `Received value: [McpError: MCP error -32001: Request timed out]`.
  - The SDK-cancel test also fails.
  - The HEL-1349 59s test still passes.
  - I restored with `git checkout HEAD -- helio-mcp/src`, and the tree is clean.
- **AC2 on the fix:** the same test passes on HEAD. The `isError` text contains "rate limit" and "25s".
- **AC1, budget shared per tool call:** the trace is `server.ts` `scopeHandlers` → `runWithRateLimitScope(findSignal(cbArgs), ...)` → `httpClient.ts` `dispatch`, where `budget = rateLimitScope.getStore() ?? {fresh}`.
  - Mutation: I made `dispatch` always use a fresh budget, keeping only the signal. Two tests go RED: "inside a scope, two sequential 429(25) requests share one budget" and the `run_pipeline` seam test.
  - The abort signal is honored before a wait (already-aborted check) and during it (`sleepUnlessAborted` race). `defaultDeps.sleep` clears its timer on abort.
- **AC3, the HEL-1349 guard is still meaningful:** mutation `RATE_LIMIT_WAIT_BUDGET_MS = 31_000` makes 2 tests RED: "keeps the wait budget at most half of the installed MCP SDK default request timeout" and "1+2+4+8s". Restored.
- **Adversarial probes:** I wrote a temporary scratch test (`helio-mcp/src/zzSkepticScratch.test.ts`), ran it, and deleted it. All 4 checks pass:
  1. **No ALS leak between concurrent scopes:** two concurrent `runWithRateLimitScope` calls, each 429(20) then 200. Both succeed and each sleeps once. A shared budget would give 40s > 30s and throw.
  2. **No leak between concurrent real MCP `callTool`s:** two parallel `list_dashboards` calls, each 429(20) once. Both return non-`isError`.
  3. **No timer leak:** default deps with a real `setTimeout` on fake timers. During the wait `jest.getTimerCount()` is 1. After abort it is 0, and the error message says "cancelled".
  4. **No leak after the scope:** `isInRateLimitScope()` is false once the scope has finished.
- **Bypass risk:** every registration in non-test src goes through `server.registerTool(` or `server.registerResource(` (grep). The wrapper replaces those methods on the instance before any `register*` call. That means a handler registered later on the returned server is wrapped too. `server.scope.test.ts` statically forbids the `.tool(`, `.resource(`, `.prompt(` and `registerToolTask` forms, and it runtime-checks both the tool path and the resource path.
- **Callers outside a scope (scripts, e2e):** the per-request budget is unchanged. The test "outside a scope the same sequence sleeps for both requests" passes. `helio-mcp/src/index.ts` is the only `new HelioHttpClient` site, and it goes through `createServer`.
- **`rateLimitRetry.ts` message contract:** it parses `/retry after (\d+(?:\.\d+)?)s/`. The new message only inserts an optional ` (<note>)` before `; retry after Ns`, so it still parses. The unit tests assert `toContain("retry after 25s")` on both the budget path and the cancel path.
- **Spec delta:** the headers match the base spec's two requirements exactly. `openspec validate mcp-per-tool-call-deadline --strict` reports it valid. Every new scenario has a matching test.
- **Static gates:** `npm --prefix helio-mcp run typecheck` passed with exit 0. ESLint `--max-warnings=0` on the changed `.ts` files passed. Prettier check is clean.
- **UI:** none. This is a helio-mcp-only change, so the design review does not apply.

### Verdict: CONFIRM

### Non-blocking notes
- With a shared budget, a multi-call tool can now return a rate-limit `isError` after a non-idempotent write has already committed. For example, `run_pipeline`'s POST run succeeds and then GET summary is throttled. `scripts/verify.ts:46` wraps every `callTool` in `retryingOnRateLimit`, which would then re-run the pipeline. Base had the same exposure through `-32001`, so this is not a regression. It is worth a follow-up, for example a message note that the write already succeeded.
- `httpClient.ts` is now about 407 lines, just over the CONTRIBUTING roughly-400 threshold. The evaluator noted this as well.
- `evaluation-2.md` is untracked in the worktree. The orchestrator should commit it with the delivery artifacts.
