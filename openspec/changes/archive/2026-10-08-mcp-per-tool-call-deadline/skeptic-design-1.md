## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed at HEAD 1bf11f55f8039bf7248fcdb61c28a52810a545db (planning artifacts untracked under
openspec/changes/mcp-per-tool-call-deadline/). Every claim below was checked against the worktree's
own `helio-mcp/src` and the installed `@modelcontextprotocol/sdk` 1.31.0. The live session MCP was not used.

### What I verified (with evidence)

- **Per-request budget premise.** `helio-mcp/src/httpClient.ts` `dispatch` declares `let waitedMs = 0` per
  call and compares it against `RATE_LIMIT_WAIT_BUDGET_MS = 30_000`. Confirmed.
- **runPipeline request count.** `helioApi.ts:803-823`: POST `/run` and GET `/api/pipelines/:id` always run,
  then `stepCountFields` reads steps only when counts exist. The planner's correction (2 requests always,
  3 when there are counts) is right.
- **The run_pipeline handler renders isError.** `tools/write.ts:590-621` uses `guarded(...)` (write.ts:51),
  which catches `HelioApiError` and returns `{isError:true}` with `err.message`. That message includes
  "retry after 25s" (`rateLimitError`), so the seam test's "25s" assertion can be met.
- **Every tool goes through `registerTool` on the `createServer` instance.** A grep for
  `.tool(`, `.resource(`, `.prompt(`, `registerPrompt`, `setRequestHandler` and `new McpServer` in non-test
  `src/`, `scripts/` and `e2e/` found only `new McpServerImpl` in server.ts:29. The only real
  registrations are `server.registerTool(` in tools/*.ts (several hits in *Handlers.ts files are just
  comments) plus one `server.registerResource` in server.ts. No source uses `.update({callback})`,
  `registerToolTask` or experimental task tools, either of which would bypass the wrapper.
- **SDK handler invocation (D2).** `sdk/dist/esm/server/mcp.js`:
  - `executeToolHandler` calls `handler(args, extra)` when there is an inputSchema and `handler(extra)`
    when there is none.
  - Resources call `readCallback(uri, extra)` or `(uri, variables, extra)`.
  - So `extra` is always the **last** argument, and a pass-through wrapper that reads `extra.signal` from
    the last argument is sound.
  - `registerTool(name, config, cb)` and `registerResource(name, uriOrTemplate, config, readCallback)`
    both take the callback last.
  - The deprecated `tool()` (mcp.js:694) calls `_createRegisteredTool` directly and does not go through
    `registerTool`. That is exactly why D2 adds the deprecated-form guard. The design is right about this.
- **Abort semantics (D4 and the design Context).** In `shared/protocol.js`:
  - The client-side timeout handler calls `cancel(...)`, which sends `notifications/cancelled` and rejects
    with RequestTimeout (-32001) (lines ~670-712).
  - On the server, the cancellation notification runs `_requestHandlerAbortControllers.get(id)?.abort()`
    (line ~174), and `extra.signal` is that controller's signal (line ~319).
  - The design's statement is accurate: the abort arrives only after the client has already timed out,
    so the shared budget is what actually fixes the bug.
- **AsyncLocalStorage propagation (D1, top risk).** The scope is entered inside the handler, so ALS does not
  need to propagate through SDK internals, only from the handler into `dispatch`. I probed that path under
  the same fake-timer library the seam test uses (`@sinonjs/fake-timers` 13.0.5 from the main checkout,
  Node v22.23.2). The probe ran a handler inside `als.run` that awaited fake-`setTimeout` sleeps,
  sequentially and in `Promise.all` branches, with timers advanced from outside the scope.
  Output: `[["a","scope1","scope1"],["b","scope1","scope1"],["c","scope1","scope1"],"scope1"] outside= undefined`.
  The store survives both kinds of continuation and does not leak outside the scope.
  Probe: scratchpad `als-probe.cjs` (not load-bearing for a verdict beyond this point).
- **Seam test is red on base and green on fix (by trace).**
  - Base: POST takes 5s to fetch, gets 429, sleeps 25s and re-fetches for 5s (t=35). The GET summary then
    takes 5s to fetch, gets 429 and starts a 25s sleep, which crosses the SDK default of 60s. The client
    rejects with -32001.
  - Fix: at t=40 the GET summary's 429 asks for 25s on top of the 25s already waited. 25+25 > 30, so the
    client throws `HelioRateLimitError` ("retry after 25s"), `guarded` turns it into isError, and the
    result arrives well before 60s.
  - The task also requires recording the actual RED output on base (3.1), which is the right discipline.
- **HEL-1349 guards kept failable.** `httpClient.test.ts:142` asserts `RATE_LIMIT_WAIT_BUDGET_MS <=
  DEFAULT_REQUEST_TIMEOUT_MSEC / 2`. Task 3.4's 31_000 mutation turns it red. The existing
  `rateLimitSeam.test.ts` (one request, 429/59s) still passes under the fix, because 59 > 30 throws at once.
- **Callers outside a scope are unchanged.** `scripts/rateLimitRetry.ts` and the verify/e2e paths do not go
  through `createServer` handlers, so they keep the per-request local budget, as the spec says.
  The message contract `retry after <N>s` is unchanged.
- **Concurrency.** The check-then-add on the shared `waitedMs` is synchronous within `dispatch`, so
  `Promise.all` branches cannot race past the budget. Over-counting only ever makes the call fail earlier,
  which the design discloses.
- **Scope.**
  - HEL-1382 and HEL-1383 are excluded.
  - dist is not rebuilt.
  - There is no API, schema or backend change, so no contract delta is required.
  - Every AC maps to a task: AC1 is covered by 1.1-1.3, AC2 by 3.1, AC3 by 3.4.
  - The ALS approach meets the AC's "or an equivalent deadline" allowance, and D1 justifies it against
    explicit threading.
- **README.** Line 326 mentions only the 60s client timeout in the verify:isolated context, not a
  per-request budget. Task 2.1 is a grep-conditional check, so it is correctly scoped.

### Verdict: CONFIRM

### Non-blocking notes

- **Spec delta.** The delta MODIFIES only "Bounded transparent retry...". The unmodified requirement "Rate-limit
  error instead of an over-long wait" still says "push the **request's** cumulative waiting past the
  budget". This is not a contradiction: requirement 1 now covers the invocation case. Still, consider also
  MODIFYING requirement 2 to say "the request's (or, inside a tool invocation, the invocation's)
  cumulative waiting", so the archived spec reads consistently.
- **D4 message.** Keep the `retry after <N>s` substring in the cancelled-while-rate-limited message so
  `scripts/rateLimitRetry.ts`'s parse contract holds. The design implies this but does not state it.
- **D4 sleep timer.** When the abort wins the race against a real `setTimeout` sleep, the timer stays
  pending until it fires. That is harmless, but if the executor wants to, a `clearTimeout`-able default
  sleep (or `unref`) avoids holding the event loop in production.
- **3.3 guard coverage.** The deprecated-form guard could also flag `registerToolTask`/`experimental.tasks`
  and `server.prompt(`/`registerPrompt`. None exist today, and each would equally bypass the wrapper.
- **Root jest.** The worktree root has no `node_modules` (only `helio-mcp/node_modules`). The executor
  should confirm that task 3.5's root `npx jest helio-mcp` resolves the intended jest/ts-jest and
  collects this worktree's tests (watch the HEL-880 `<rootDir>/.claude/worktrees/` anchoring). It should
  not trust a green result with 0 tests.
