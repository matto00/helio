## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD: `5331de188138428dd4b296fb6040b77c1eb4efed`. The base was resolved live with `resolve-review-base.sh` and came back as `60fdb87ded6dd8d571767199b8d3fa05f6b093c7`. The first attempt failed with a transient DNS error and the immediate re-run succeeded. The base equals `origin/main`, and the branch is one commit ahead.

### What I verified (with evidence)

- **Spawn-cwd guard.** `assert-cwd.sh` returned `READY ambient=/home/matt/Development/helio branch=bug/mcp-rate-limit-backoff-cap/HEL-1349`.
- **Diff read in full.** I read `git diff 60fdb87de...HEAD` for `helio-mcp/src` and `helio-mcp/scripts`. The code change is confined to `httpClient.ts`, two new tests, `scripts/rateLimitRetry.ts` and its test, and `verify.ts`. There are no backend, frontend or schema changes, so no UI review was needed.

#### Gates, re-run fresh by me

All npm cache and log output went to the scratchpad, and every command ran under `nice -n 19`.

- `npm --prefix helio-mcp run typecheck` exited 0.
- `npx eslint --max-warnings 0` on the 6 touched helio-mcp files exited 0.
- `npx prettier --check` on those 6 files plus the change's .md and spec files exited 0.
- `npx jest --maxWorkers=3 helio-mcp/`: 42 suites and 396 tests, all passing.

#### Red-first evidence, reproduced independently

- **Setup.** In a scratchpad copy I used the base `httpClient.ts` (from `git show 60fdb87de:`) plus a shim that only adds the names: an empty `HelioRateLimitError` subclass and the budget constant. I ran the branch's `httpClient.test.ts` and `rateLimitSeam.test.ts` against it.
- **Result: 6 failed, 13 passed.**
- **Seam test failure.** It fails with `Received value: [McpError: MCP error -32001: Request timed out]`. That is the SDK's default request timeout: `new Client(...)` is built with no options, `callTool` has no `{ timeout }`, and the fake clock advances 65 s. So the red is the real symptom the ticket describes, not a stand-in.
- **Unit test failures.** They are the right ones: an absurd Retry-After resolved instead of rejecting, the 59 s case returned the 200 response, and both the cumulative and no-Retry-After cases threw a plain `HelioApiError`.
- I deleted the scratch copy afterwards. Nothing in the worktree was modified.

#### Adversarial logic review of `dispatch` (httpClient.ts)

- **Can a request sleep past the budget?** No.
  - Before any sleep the code checks `waitedMs + delay > RATE_LIMIT_WAIT_BUDGET_MS` and throws if it is true. Only after that check does it add the delay and sleep, so the total sleep is always 30 s or less.
  - Unusual headers stay inside the bound. `1e309` and negative values are not finite or not ≥ 0, so they fall back to the backoff schedule. An empty header gives 0, which is the same as before.
- **Can a request sleep less than the server's Retry-After?** No.
  - The per-wait clamp (`MAX_BACKOFF_MS` / `Math.min`) has been removed. The delay is exactly `retryAfterSeconds * 1000`, or the whole request fails.
  - A mutation that re-adds a 30 s clamp would sleep 30000 ms in the 59 s case, so the test asserting `slept` equals `[]` would go red.
  - A mutation from `>` to `>=` would turn the `[15000, 15000]` assertion red.
- **Exhaustion with short Retry-Afters.** Five 1 s retries and then `HelioRateLimitError` with `retryAfterSeconds: 1` (6 calls), which is tested.
- **`CHAT_LIMIT_REACHED`.** Still checked before the generic 429 branch and unchanged.
- **Error text reaching the agent.** All 13 `guarded` shells across 10 tool files format the error as `${err.name} (status ${err.status}) for ${err.url}: ${err.message}`. So the `isError` text contains `HelioRateLimitError`, "rate limited" and `retry after <N>s`, which `rateLimitRetry.ts` parses. The seam test confirms this end to end.
- **No other consumer depends on the old behaviour.** A grep for `429` and `instanceof HelioApiError` outside httpClient found only the generic shells.

#### verify.ts call sites

- `client.callTool(` now appears exactly once, inside `callToolRetrying`, and all 23 former call sites use the helper.
- **Expected-error sites** (invalid params at :296 and unknown shape at :315). The helper only re-calls when the text contains `HelioRateLimitError` and a parseable `retry after`. A 400 or 404 is returned unchanged on the first call, and the unit test "returns a non-rate-limit error without retrying" pins that. If one of these sites hits a 429, the helper now waits it out instead of failing the text check, which is the intended D7 behaviour.
- **Re-calling writes** (create_pipeline, add outputs, run_pipeline). A 429 means the backend refused the request, so the re-call does not duplicate a write.
- **Partial-success case.** run_pipeline's later poll requests could hit a 429 after the submit succeeded, and the re-call would then submit a second run. The old `run_pipeline` loop already re-called on any error, so this exposure is no wider than before.
- **Bounds.** At most 3 re-calls and 180 s of sleep per call site, which is tested.

#### Acceptance criteria

1. **Keep backoff below the SDK timeout, or return a structured rate-limit error with the retry-after.** Met, both halves.
   - There is a 30 s cumulative budget (`httpClient.ts`, `RATE_LIMIT_WAIT_BUDGET_MS`, checked in `dispatch`).
   - `HelioRateLimitError` carries `status 429` and `retryAfterSeconds`, and its message says `retry after <N>s`.
2. **A test with a mocked 429 and a long Retry-After that is red before the fix.** Met. The 59 s unit test and the seam test were both red against base in my own run.
3. **Check against the SDK version after HEL-1348.** Met.
   - The installed `@modelcontextprotocol/sdk` is version 1.31.0, with `DEFAULT_REQUEST_TIMEOUT_MSEC = 60000` (I grepped `dist/esm/shared/protocol.js`).
   - The guard test imports that constant and asserts the budget is at most half of it. The evaluator showed by mutation that this guard can fail (setting the budget to 30001 turns it red).

#### Iron Laws

- This is a behaviour bug with a defined root cause (a 60 s per-wait clamp equal to the SDK timeout, with no cumulative bound) recorded in ticket.md and design.md.
- The regression tests exercise the fixed path, and I confirmed they are red against base.

#### Gate-integrity note

No report I relied on discloses unsound evidence mtimes. My red-first evidence comes from content (a base file pulled with `git show`) and does not depend on ordering. No gate defect to record.

### Verdict: CONFIRM

### Non-blocking notes

- **Stale comment in isolatedRun.ts.** `helio-mcp/scripts/isolatedRun.ts:254-255` still justifies the rate-limit lift as avoiding "a 429 whose Retry-After outlasts the MCP client's 60s request timeout". After this change such a 429 produces `HelioRateLimitError`, not a timeout. The lift is still worthwhile because it avoids waiting, but the reason given is stale.
- **Stale README text.** The same applies to `helio-mcp/README.md:326`, which the evaluator also noted.
- **verify.ts fallback comment.** The comment at `verify.ts` (run_pipeline fallback) calls the branch "mostly dead code". It still retries any non-rate-limit `isError`, so the wording undersells it.
- **Accepted residual risks to name in the PR, per design Risks:**
  - A tool that makes several sequential HTTP calls can still exceed 60 s in total.
  - Retry-After values of about 31-58 s now surface as an error instead of being waited out. verify.ts absorbs this; other MCP agents see an actionable error that includes the retry-after value.
