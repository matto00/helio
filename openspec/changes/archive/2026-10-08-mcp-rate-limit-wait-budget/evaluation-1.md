## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD: `5331de188138428dd4b296fb6040b77c1eb4efed`. Base was resolved live with `resolve-review-base.sh` and came back as `60fdb87ded6dd8d571767199b8d3fa05f6b093c7`. The branch is one commit ahead of the base.

### Phase 1: Spec Review — PASS

Issues: none.

- **AC1 (keep the backoff below the SDK timeout, or return a structured error).** Both parts are done.
  - `dispatch` tracks a cumulative `waitedMs` against `RATE_LIMIT_WAIT_BUDGET_MS = 30_000`.
  - A 429 is never slept through when the wait would overrun the budget or the attempts are used up. In that case `HelioRateLimitError` is thrown. It extends `HelioApiError`, has status 429 and carries `retryAfterSeconds`.
  - `MAX_BACKOFF_MS` is removed, which matches D2.
  - The `CHAT_LIMIT_REACHED` path is unchanged.
- **AC2 (a test with a mocked 429 and a long Retry-After that is red before the fix).** I confirmed this myself; see Phase 2.
- **AC3 (check against the SDK version after HEL-1348).** The installed `@modelcontextprotocol/sdk` in `helio-mcp/node_modules` is 1.31.0, with `DEFAULT_REQUEST_TIMEOUT_MSEC = 60000` in both the esm and cjs builds. A guard test imports that constant and asserts the budget is at most half of it.
- **Tasks.** Every item in tasks.md is ticked and matches the code.
- **D7 routing in verify.ts.** `grep -c "client.callTool("` in `helio-mcp/scripts/verify.ts` returns 1. The base had 23, and `callToolRetrying(` now appears 24 times: 23 call sites plus the definition.
- **Scope.** There is no scope creep. The five `verify:isolated` items are excluded, as proposal.md says. There are no backend, schema or dependency changes.
- **Spec delta.** `specs/mcp-rate-limit-handling/spec.md` matches the implemented behaviour.
- **Constraints.**
  - C1 is honoured. I reproduced the red-first evidence independently (below).
  - C2 is honoured. The executor disclosed using `HUSKY=0` only for `npm ci --ignore-scripts`, not for the commit. The commit went through the hooks, and the commit message has no `-n` disclosure because none was needed. Recorded here as instructed.

### Phase 2: Code Review — PASS

Issues: none blocking.

**Gates, run fresh by me in WORKTREE_PATH.** npm cache and logs went to the scratchpad and every command ran under `nice -n 19`.

- `npm --prefix helio-mcp run typecheck` exited 0. `tsconfig.typecheck.json` includes `src/`, `scripts/` and `e2e/`, so the new scripts are type-checked too.
- `npx eslint --max-warnings 0` on the 6 touched helio-mcp files exited 0.
- `npx prettier --check` on those 6 files plus the change's .md and spec files exited 0.
- `npx jest --maxWorkers=3 helio-mcp/` gave 42 suites and 396 tests, all passing. This includes `src/httpClient.test.ts`, `src/rateLimitSeam.test.ts` and `scripts/rateLimitRetry.test.ts`.

**Red-first check (C1), independent of the executor's claim.**

- **Setup.** I made a scratch copy with the branch's tests and the base (`60fdb87de`) `helio-mcp/src/httpClient.ts`, extracted with `git show`.
  - I appended a names-only shim: an empty `HelioRateLimitError` subclass and the `RATE_LIMIT_WAIT_BUDGET_MS` constant. This lets the tests compile without any change in behaviour. I checked with `diff` that the only change from base is the appended shim.
  - The branch's committed source was not touched. The scratch copy was deleted afterwards.
- **Result: 6 failed, 13 passed.**
  - Absurd Retry-After: "Received promise resolved instead of rejected".
  - 59 s case: "Expected HelioRateLimitError, received Object", because the old code slept 59 s and returned the 200.
  - Cumulative 15 s case: the old code produced a plain `HelioApiError` after 5×15 s of sleeping.
  - No-Retry-After schedule: also produced a plain `HelioApiError`.
  - Exhaustion case: also red.
  - **Seam test:** `Received value: [McpError: MCP error -32001: Request timed out]`.
- **SDK guard test.** It cannot go red against base, because it checks a constant. I checked it by mutation instead: setting the budget to `30_001` on the green source makes it fail. So the guard does catch a budget that drifts above half the timeout.
- **Discrepancy with the executor's count.** The commit message says "7 tests failed". I got 6 with a behaviour-neutral shim; the seventh was probably the guard test under a different stub. This does not change the verdict.

**The seam test uses the SDK's default 60 s timeout.**

- `rateLimitSeam.test.ts` builds `new Client(...)` with no options and calls `callTool` with no `{ timeout }`. Jest fake timers advance 65 s.
- To show that the -32001 comes from the SDK's own 60 s default and not from something shorter, I ran a scratch probe against the base code. At 59.5 s the call was still `pending`; at 60.5 s it was `McpError: MCP error -32001: Request timed out`.

**Code quality.**

- **Typing and errors.** The error type is typed properly and keeps working with every `guarded` shell (`${err.name} (status ...)` in 10 tool files). The message contract `retry after <N>s` is documented on both sides: `httpClient.ts` `rateLimitError` and `scripts/rateLimitRetry.ts`. No `any` was added. Test casts like `as unknown as Response` follow the existing harness pattern.
- **Tests.** They are meaningful: exact sleep schedules, fetch counts and the error class are all asserted.
- **Other checks.** No dead imports, no TODO or FIXME, and no inline FQNs. The structure is small and composable: the parser and retry helper are pulled out because `verify.ts` runs `main()` on import.

### Phase 3: UI Review — N/A

No change matches `frontend/**`, `ApiRoutes.scala`, `schemas/**` or `openspec/specs/**`. The new spec lives only under `openspec/changes/`. I did not start dev servers.

### Overall: PASS

### Change Requests

(none)

### Non-blocking Suggestions

- `helio-mcp/scripts/verify.ts:372-374`: the comment calls the `run_pipeline` fallback "mostly dead code now". But that fallback also re-tries any non-rate-limit `isError` after `RATE_LIMIT_BACKOFF_MS`, so it is not purely a rate-limit path. Consider rewording the comment to describe what the branch still covers, rather than calling it dead.
- `helio-mcp/README.md:325-327` still explains the `verify:isolated` rate-limit lift as avoiding the 60 s request timeout. After this change, a long Retry-After produces a `HelioRateLimitError` rather than a timeout. The lift is still justified, but the stated reason is now slightly stale.
- File size:
  - `helio-mcp/scripts/verify.ts` grew from 437 to 451 lines. It was already past the ~400-line threshold where CONTRIBUTING asks for a split proposal, and the PR body could mention that.
  - `httpClient.ts` is at 327 lines, over the ~250 soft budget but under 400.
- Residual risk, already accepted in design.md Risks: a tool that makes several sequential HTTP calls, each near the 30 s budget, can still exceed 60 s. Name it in the PR as a possible follow-up, as the design intends.
