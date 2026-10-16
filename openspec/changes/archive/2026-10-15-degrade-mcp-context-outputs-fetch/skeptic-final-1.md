## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD `4c84404989257b79d6a1c03681257edbc448a52e`. The review base was resolved live with `resolve-review-base.sh`
(it printed `2a9f9e4677f7019f5f6a36c4f72e5146cf25df85` and exited 0). The cwd guard printed `READY`.

### What I verified (with evidence)

- **Diff scope.** `git diff 2a9f9e467...HEAD --stat` shows only helio-mcp (`context.ts`, `index.ts`, a new
  `unhandledRejectionGuard.ts`, 4 test files, `scripts/rateLimitedContextRepro.ts`, README) plus the change
  artifacts. No frontend/backend/schema files changed, so UI review (step 4) is N/A.
- **Root cause and fix (I read the code).** On base, `outputsByPipelinePromise` was created before the fail-fast
  `Promise.all` and awaited only after it, and it had no rejection handler. On HEAD, `context.ts:512-522` chains
  `.then(map => ({map}), err => ({map: new Map(), error}))` after both the fetch and the build step, so the promise
  cannot reject. `outputsError` is spread in only when it is defined (`context.ts:666`). `applyBudget` spreads
  `...context`, so the field survives budgeting.
- **Red reproduced independently on Node v22.23.2.** I built two scratch copies of helio-mcp under
  `.concertino/scratch/HEL-1617/skeptic-{red,green}`:
  - In skeptic-red, `src/context.ts` was replaced with `git show 2a9f9e467:helio-mcp/src/context.ts`. Running
    `node --import tsx scripts/rateLimitedContextRepro.ts` printed an uncaught `HelioRateLimitError ... at async
    fetchAllOutputs (context.ts:176:20)`, then `exit=1`.
  - In skeptic-green (HEAD's code), the same script printed `survived outcome=rate-limit-error` and exited 0.
  - The repro script installs NO `unhandledRejection` guard, so the green holds without the safety net
    (constraint C2).
  - The executor's recorded `red-jest.txt` agrees: both new seam/process suites fail on base, and the process test
    shows status 1 with the same stack.
- **Gates, run fresh** (load ~3, nice 19, 2 workers):
  - `npx jest --maxWorkers=2 helio-mcp/src`: 50 suites, 447 tests passed. This includes the seam test, the process
    test, the guard test and the new `context.test.ts` cases.
  - `npm --prefix helio-mcp run typecheck`: exit 0.
  - eslint `--max-warnings=0` on the changed files: exit 0.
  - prettier `--check` on the changed files: clean.
- **AC1 is met.** The seam test (`rateLimitContextSeam.test.ts`) goes through a real MCP Client, the real server and
  the real HelioHttpClient, with 429 on both `/api/data-sources` and `/api/outputs`. It asserts `isError` and text
  matching `/rate limit/i`. Process survival is proven by the subprocess test (exit 0, stderr does not match
  `HelioRateLimitError|unhandled`).
- **AC2 is met.** `context.test.ts` covers three cases:
  - Outputs-only failure: every pipeline has `outputs` of `[]`, and `outputsError === "outputs boom"`.
  - The field is kept in concise mode and with a budget of 1.
  - The field is absent on success.
  - README and spec delta document `outputsError`.
- **AC3 is met.** Red is proven both by the executor's recorded evidence and by my own reproduction above. Green is
  proven by my reproduction and by the jest run.
- **AC4 is met.**
  - `installUnhandledRejectionGuard` writes `helio-mcp: unhandled rejection: <msg>` to stderr, bounded to 500
    characters, and does not exit.
  - It is installed at the top of `main()` in `index.ts`.
  - It is unit-tested against a fake EventEmitter, with a `process.exit` spy that is not called.
- **Related bullets.** These are assessed and recorded in design.md. The request-volume finding is recorded as not
  fixed (a non-goal). For HEL-1524, a contract-change note was added to the README.
- **No mtime-ordering evidence** was relied on.

### Verdict: CONFIRM

### Non-blocking notes

- The spec clause "keeps serving further tool calls" is not pinned by a second `callTool` in the seam test. Process
  survival is proven by the subprocess test instead. (The evaluator also noted this.)
- The 500-character truncation is duplicated between `unhandledRejectionGuard.ts` and the transport-error log in
  `index.ts`.
- The repro script covers the case where both fetches fail. The case "only Outputs 429s while the `Promise.all` is
  still pending" (which per design.md also crashed base) is covered structurally by the same self-catch, and at the
  unit level only with a fake API.
