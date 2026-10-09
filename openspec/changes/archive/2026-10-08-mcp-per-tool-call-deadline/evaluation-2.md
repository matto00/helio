## Evaluation Report — Cycle 2 (evaluation-2.md)

Reviewed: `399b82d8034fed25a008de2e896f43e7686a4851`. The base is `1bf11f55f8039bf7248fcdb61c28a52810a545db`, the same as cycle 1.
The cycle-2 delta is `7117baf1..399b82d8`:
- `helio-mcp/src/httpClient.ts`: `sleepUnlessAborted` now uses a single listener.
- `helio-mcp/src/rateLimitSeam.test.ts`: a new test checks that a cancel reaches the 429 wait through the real SDK.
- `evaluation-1.md` is now committed.

### Phase 1: Spec Review — PASS
Issues: none.

- Cycle 1's only change request is addressed. A new test in `rateLimitSeam.test.ts` makes the call with the real SDK `Client` and `InMemoryTransport`, using `callTool(..., { signal })`. It cancels the call during a 429 `Retry-After: 25` wait, then checks two things: the wait ends with a `HelioRateLimitError` whose message says "cancelled", and there was exactly one fetch. This covers the spec scenario "Cancelled invocation stops waiting" at the SDK seam, so task 1.3's verification claim is now true.
- No scope creep. HEL-1382 and HEL-1383 are not touched.
- C1 is honored. Jest collected 43 suites from `.../HEL-1381/helio-mcp/` (`--listTests`, 43 paths under this worktree).

### Phase 2: Code Review — PASS
I ran the gates myself in WORKTREE_PATH, with `nice -n 19` and `--maxWorkers=3`:

| Gate | Result |
|---|---|
| `npx jest helio-mcp` | exit 0. Test Suites: 43 passed. Tests: 418 passed (417 in cycle 1, plus the new one) |
| `npm --prefix helio-mcp run typecheck` | exit 0 |
| `npx eslint --max-warnings=0` on changed `.ts` | exit 0 |
| `npx prettier --check` on changed files | exit 0 |

Mutations were applied one at a time on HEAD, and each was restored with `git checkout HEAD -- helio-mcp/src`. The tree is clean afterwards.

| Mutation | Result |
|---|---|
| `findSignal` returns `undefined` (`server.ts:35`) | **RED**, 1 failed / 417. The new test `aborting callTool mid-wait ends the wait with exactly one fetch` fails. In cycle 1 this mutation was GREEN; that was the gap |
| `scopeHandlers(server)` commented out | RED, 4 failed / 414. The new cancel test, both scope guards, and the `run_pipeline` seam test fail |
| `RATE_LIMIT_WAIT_BUDGET_MS = 31_000` | RED, 2 failed / 416. Both HEL-1349 guards fail |
| `signal.removeEventListener("abort", onAbort)` removed | RED. The `no per-retry leak` test fails |
| Abort result forced to `false` in `sleepUnlessAborted` | RED, 2 failed. The new SDK cancel test and the unit abort test fail |

I proved the `run_pipeline` seam test RED against base src in cycle 1 (`-32001 Request timed out`). That test is unchanged in this cycle.

Code check on `sleepUnlessAborted` (`httpClient.ts:318-344`):
- There is one listener on the invocation signal, and it is always removed in `finally`.
- It forwards the abort to a private controller. That controller ends the race and also clears the production timer, because `defaultDeps.sleep` clears its timer on abort.
- The `onAbort!` non-null assertion is gone.
- After a normal wait, the `cancelled` promise stays pending only until it is garbage-collected. It holds no listener on the outer signal.

### Phase 3: UI Review — N/A
This is a helio-mcp-only change. No UI-trigger paths are touched.

### Overall: PASS

### Non-blocking Suggestions
- `helio-mcp/src/httpClient.ts` is 407 lines, over the roughly 400-line threshold in CONTRIBUTING.md:24. Note a split proposal in the PR body.

Evidence: my logs are under
`/tmp/claude-1000/-home-matt-Development-helio/9b21e65f-3fe7-47b2-9c41-c08a39656cd5/scratchpad/eval1381/c2/`
(`jest-head.log` and `mut-*.log`). They are not durable, because `persist-evidence.sh` refuses paths outside a git
working tree. The counts and test names quoted above are the self-authenticating content.
