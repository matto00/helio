## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed: `7117baf1d0c49a93a2af5a022101b0bbc47864ea` against base `1bf11f55f8039bf7248fcdb61c28a52810a545db`
(resolved live via `resolve-review-base.sh main origin`).

### Phase 1: Spec Review — PASS
Issues: none blocking.

- AC1 (per-invocation budget, SDK abort signal threaded): implemented via `AsyncLocalStorage` scope
  (`httpClient.ts` `runWithRateLimitScope`) plus `scopeHandlers` in `server.ts`, which wraps
  `registerTool`/`registerResource` before any `register*Tools` call. Design D1-D4 are followed.
  `.update(`, `registerPrompt`, `registerToolTask`, deprecated `server.tool(`/`server.resource(` have zero
  hits in non-test `helio-mcp/src`.
- AC2 (red-first seam test): re-established RED myself (see Phase 2).
- AC3 (HEL-1349 guard still meaningful): re-ran the budget mutation myself; red.
- README task 2.1: the README has no per-request-budget wording (only line 326-327, which is about the
  isolated backend lifting limits), so no edit was needed. Correct.
- Scope: only `helio-mcp/src` + the change dir. HEL-1382/HEL-1383 not touched.
- C1 (standing constraint): honored. RED recorded, and every jest run below collected tests from
  this worktree's `helio-mcp/` (`--listTests` prints
  `/home/matt/Development/helio/.claude/worktrees/bug/mcp-per-tool-call-deadline/HEL-1381/helio-mcp/src/...`).
- `node_modules` at the worktree root is a symlink excluded via `.git/info/exclude:8`. It is not
  tracked (`git ls-files | grep node_modules` is empty) and not in the diff.

### Phase 2: Code Review — FAIL
Gates (my own fresh runs, in WORKTREE_PATH, `nice -n 19`, `--maxWorkers=3`):

| Gate | Result |
|---|---|
| `npx jest helio-mcp` | exit 0. Test Suites: 43 passed. Tests: 417 passed |
| `npm --prefix helio-mcp run typecheck` | exit 0 |
| `npx eslint --max-warnings=0` on changed `.ts` | exit 0 |
| `npx prettier --check` on changed files | exit 0 |

Red-first and mutation proofs (each run on this worktree, each restored with `git checkout HEAD -- <file>`;
the tree is clean afterwards):

| Probe | Result |
|---|---|
| Base `httpClient.ts` + `server.ts` with the new seam test | RED, 1 failed / 1 passed. `run_pipeline with two 25s Retry-Afters...` received `McpError: MCP error -32001: Request timed out`. The HEL-1349 59s test still passes |
| `RATE_LIMIT_WAIT_BUDGET_MS = 31_000` | RED, 2 failed / 415. `keeps the wait budget at most half of the installed MCP SDK default request timeout (HEL-1349)` and `with no Retry-After sleeps exactly 1+2+4+8s...` |
| `scopeHandlers(server)` commented out | RED, 3 failed / 414. Both `server.scope.test.ts` scope guards plus the HEL-1381 seam test |
| Listener-cleanup line removed (`sleepUnlessAborted`) | RED, the `no per-retry leak` test |
| Abort result forced to `false` in `sleepUnlessAborted` | RED, the `abort during a wait stops waiting and does not re-send` test |
| **`findSignal` returns `undefined` instead of the SDK signal** (`server.ts:35`) | **GREEN, 417/417 pass. Nothing catches it** |

Issues:

1. **The binding of the SDK `extra.signal` into the scope is untested.** The tests never exercise the
   `findSignal` path at `server.ts:31-37`. The httpClient abort tests build their own
   `AbortController` and call `runWithRateLimitScope` directly. The `server.scope.test.ts` guards only
   assert `isInRateLimitScope()`, never which signal the scope carries. So the abort half of AC1 can be
   silently broken. A future SDK change to the `extra` shape, or any edit to `findSignal`, would pass
   every gate. Examples of such edits: a positional pick, or an `instanceof` across realms.

   This also affects the spec scenario "Cancelled invocation stops waiting" ("WHEN the caller cancels
   a tool invocation"). It is only verified below the seam, and tasks 1.3/3.3 claim this binding is
   verified by the scope guard, which it is not.

   The behavior itself is correct today. I wrote a throwaway probe (`helio-mcp/src/zzEvalProbe.test.ts`,
   deleted afterwards). It used the real SDK `Client` and `InMemoryTransport`, called `list_dashboards`
   with `callTool(..., { signal })`, received a 429 `Retry-After: 25`, and aborted mid-wait.
   - HEAD: GREEN (`sleepEnded=true calls=1`).
   - With the `findSignal` mutation: RED.

   So the missing test is cheap to add, and a mutation makes it fail.

Other checklist items: DRY, readable, modular, type safety and error handling are OK. `as never`/`as unknown`
casts in `scopeHandlers` are confined and commented by intent. No dead code. No over-engineering (ALS is
the single choke point design D1 justifies). Security is N/A. The cancelled-error message keeps the
`retry after <N>s` text that `scripts/rateLimitRetry.ts:20` parses.

### Phase 3: UI Review — N/A
This is a helio-mcp-only change. No `frontend/**`, `ApiRoutes.scala`, `schemas/**` or `openspec/specs/**`
(main specs) files are touched.

### Overall: FAIL

### Change Requests
1. In `helio-mcp/src/server.scope.test.ts`, add a guard proving that `createServer` binds the SDK request's
   `extra.signal` into the scope. Shape it like this:
   - Inject a `HelioHttpClient` whose `fetchImpl` always answers 429 `Retry-After: 25`, and whose `sleep`
     never resolves on its own.
   - Call a tool (e.g. `list_dashboards`) via `client.callTool({...}, undefined, { signal: ac.signal })`.
   - Wait until the sleep has started, then `ac.abort()`.
   - Assert that the wait ends and `fetchImpl` was called exactly once (no re-send).

   Show it RED with `server.ts:35` mutated to `return undefined` (record the output), then GREEN at HEAD.
   Update the verify note in task 1.3 if needed so it cites this test.

### Non-blocking Suggestions
- `helio-mcp/src/httpClient.ts` is now 409 lines, up from about 315. CONTRIBUTING.md:24 says a file
  crossing about 400 lines should get a split proposal in the PR description. Mention it in the PR body
  (or point at HEL-1383-style follow-up).
- `sleepUnlessAborted` (`httpClient.ts:320-346`) registers two `abort` listeners on the outer signal
  (`onAbort` and `onOuterAbort`) and uses a `onAbort!` non-null assertion. One listener that both
  resolves the race and aborts the inner controller would be simpler.

Evidence note: the logs are in
`/tmp/claude-1000/-home-matt-Development-helio/9b21e65f-3fe7-47b2-9c41-c08a39656cd5/scratchpad/eval1381/`
(`jest-head.log`, `red-base.log`, `mut-budget.log`, `mut-scope.log`, `mut-findsignal.log`,
`probe-cancel.log`, `probe-cancel-mut.log`). `persist-evidence.sh` refuses them because they are not
inside a git working tree, so they are not durable. The counts and test names quoted above are the
self-authenticating content.
