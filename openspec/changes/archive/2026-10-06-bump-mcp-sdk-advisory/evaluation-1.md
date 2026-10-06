## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD `a774c3d99f08c705c232e998c4ed81036f7b42ed` against live-resolved base `9c41719c376b858ab9269fa6075f8b3b74acabd1`
(origin/main). Scratch logs and scripts: `/tmp/claude-1000/-home-matt-Development-helio/7c91d5de-7eee-4b42-a6c7-dffd6f7b4dc2/scratchpad/hel1348-eval-*`.
Every npm/npx call used the scratchpad `npm_config_cache` / `npm_config_logs_dir`.

### Phase 1: Spec Review — FAIL

Re-measured, all confirmed:

- **Scope.** `git diff --stat base...HEAD`: outside the change dir, only `helio-mcp/package.json` (1 line) and
  `helio-mcp/package-lock.json` (6+/6-). `package.json` diff is exactly the `dependencies` sdk line `^1.29.0 -> ^1.31.0`.
  zod, `.audit-ci.jsonc`, ci.yml, frontend untouched. Worktree is clean (`git status --short` empty).
- **Lockfile churn (jq over `packages`, base vs HEAD).** Added: none. Removed: none. Version changed: only
  `node_modules/@modelcontextprotocol/sdk` 1.29.0 -> 1.31.0. Entries differing at all: `""` (root range line) and the
  sdk entry (whose own `@hono/node-server` range widened to `^1.19.9 || ^2.0.5`). `node_modules/zod` is byte-identical.
  The locked integrity `sha512-UvTMgnNl...VcL/pw==` matches `npm view @modelcontextprotocol/sdk@1.31.0 dist.integrity`.
- **Audit red -> green (root-pinned audit-ci 7.1.0, `node_modules/audit-ci/package.json`).**
  - HEAD, from the worktree root, `npx audit-ci --config helio-mcp/.audit-ci.jsonc --directory helio-mcp`: exit 0,
    "Passed npm security audit.", 0 vulnerabilities (`hel1348-eval-audit-head.log`).
  - Base: the same binary and arguments, run from a scratch root holding base's `helio-mcp/{package.json,package-lock.json,.audit-ci.jsonc}`
    (`git show 9c41719c3:...`): exit 1, only `GHSA-6qxp-vccf-f47h|@modelcontextprotocol/sdk` (high, range `>=1.12.0 <1.31.0`)
    (`hel1348-eval-audit-base.log`). No allowlist change.
- Task 2.7 (CI run id) is unchecked but owned by the orchestrator after the PR. That's acceptable.

Issue (spec-divergence against design D6 / task 2.5): **the 10 MB ReadBuffer assessment is asserted, and part of it
is factually wrong.** Details and evidence are under Phase 2 finding 1.

### Phase 2: Code Review — FAIL

Gates I ran myself in `WORKTREE_PATH` (none of the configured frontend/backend gate globs match `helio-mcp/**`, so these
are the ticket's own gates):

- Root `npm ci`: exit 0.
- `helio-mcp`: `npm ci` exit 0. The installed `node_modules/@modelcontextprotocol/sdk/package.json` version is **1.31.0**.
  Note that `require('@modelcontextprotocol/sdk/package.json')` resolves to the `dist/cjs/package.json` type marker and
  prints `undefined`, so read the file directly.
- `rm -rf dist && npm run build`: exit 0. `npm run typecheck`: exit 0.
- Root `npx jest helio-mcp`: exit 0, **38 suites / 371 tests passed** (`hel1348-eval-jest.log`). The root `node_modules`
  has no `@modelcontextprotocol` directory at all, so the only copy Jest can resolve is `helio-mcp/node_modules` (1.31.0).
- **Independent stdio smoke** (`hel1348-eval-scripts/smoke.mjs`), with each tree's own `Client` + `StdioClientTransport`
  spawning that tree's freshly built `dist/index.js` against an unreachable backend. Base is a scratch `git archive`
  build with 1.29.0 installed. Its `tsc` exit 2 is test-file-only `@types/jest` errors from living outside the repo
  (1135 errors, all in `*.test.ts`), and `dist` was emitted. HEAD is the worktree build.
  - Server info, tool count (76), sorted names, full `listTools` JSON including inputSchemas (133,103 bytes), and
    resources (`helio://workspace/context`) are all identical.
  - The schema-invalid `create_data_source({})` response is still `isError`, -32602. Base text is a raw zod issue JSON;
    HEAD text is `Required at name\nRequired at columns\nRequired at rows`, matching design change (b). No source or test
    asserts that text (grep).
  - A backend-unreachable call (`list_dashboards`) gives an identical error on both.

**Finding 1 (blocking): the ReadBuffer assessment in `files-modified.md` is not supported by evidence, and its
server-side claim is false.**

- Claim: "The server-side transport reads only client requests (small)." This is false. helio-mcp accepts uncapped
  inbound payloads:
  - `create_csv_data_source.content: z.string().min(1)` at `helio-mcp/src/tools/write.ts` (~line 257)
  - `create_data_source.rows` at `write.ts:100`
  - `append_dataset_rows.rows` at `write.ts:128`
  - `write.ts:150`

  The backend accepts CSVs up to 15 MiB / 300k cells (`CsvLimits.maxBytes = 15728640`). In 1.31.0,
  `StdioServerTransport._ondata` catches the `ReadBuffer exceeded maximum size` throw and then **calls `this.close()`**
  (`node_modules/@modelcontextprotocol/sdk/dist/esm/server/stdio.js:14-22`). An oversize request therefore kills the
  whole MCP session. It is not just rejected.
- Measured (`hel1348-eval-bigreq.log`, `hel1348-eval-scripts/bigreq.mjs`), with `create_csv_data_source` inline content
  against an unreachable backend:

  | CSV bytes | base 1.29.0 | HEAD 1.31.0 |
  |---|---|---|
  | 1,000,034 | backend-unreachable tool error | same |
  | 9,000,019 | backend-unreachable tool error | same |
  | 11,000,024 | backend-unreachable tool error (request reached the HTTP layer) | **`MCP error -32000: Connection closed`**; server stderr shows nothing (helio-mcp registers no `onerror`) |

  So this bump causes a real, silent regression: any inline-CSV or row-array request whose JSON line exceeds 10 MiB
  now terminates the helio-mcp session. On 1.29.0 it was forwarded to a backend that would accept it if under 15 MiB
  and 300k cells. JSON escaping (`\n`, quotes) puts the effective raw-CSV threshold below 10 MiB.
- Claim: "none was observed near that size (largest in the smoke: listTools, well under 1 MB)." This is vacuous. The
  smoke never reached a backend, so no row or summary tool response was ever observed. "Tool responses are row/summary
  payloads with server-side limits" is also asserted: read tools cap row *count* (`limit ... max(500)`), not bytes per
  cell. The client-side 10 MiB risk for helio-mcp's own sdk-1.31 clients (tests, verify/e2e harnesses) is unmeasured.
- The advisory itself (base audit log title: "OAuth client could send credentials to an authorization server chosen by
  the MCP server") is unrelated to ReadBuffer. The 10 MiB cap is an unrelated behavior change that came along with the
  minimum fixed version, so the assessment matters.

No other code-quality issues. The diff has no source change, no dead code, and no over-engineering.

### Phase 3: UI Review — N/A

No UI-triggering paths changed (only `helio-mcp/**` and the change dir). Dev servers were not started, as briefed.

### Overall: FAIL

### Change Requests

1. Rewrite the "10 MB ReadBuffer assessment" section of
   `openspec/changes/bump-mcp-sdk-advisory/files-modified.md` (and the matching design D6 outcome) to match the
   evidence:
   - (a) Inbound requests are NOT small. Name `create_csv_data_source.content`, `create_data_source.rows` and
     `append_dataset_rows.rows` (`helio-mcp/src/tools/write.ts:100,128,150` + the `content` schema) and the backend's
     15 MiB / 300k-cell CSV cap.
   - (b) State that 1.31.0's `StdioServerTransport` closes the session on overflow, and cite your own measured repro:
     a >10 MiB request gives `-32000 Connection closed` on 1.31.0 versus a forwarded request on 1.29.0.
   - (c) Either measure the response side against a real backend, or label it explicitly as unverified, with the
     row-count-not-bytes caveat. Remove "none was observed near that size", which nothing measured.
2. Because C1 forbids a source edit without the driver's approval, raise the resulting decision with the
   orchestrator/driver and record the ruling in `files-modified.md`:
   - (a) ship the bump as-is and file a follow-up ticket to pass
     `{ maxBufferSize: <>= CSV entity limit x JSON-escape headroom> }` as the third argument of
     `new StdioServerTransport(...)` in `helio-mcp/src/index.ts`, and to register a transport/server `onerror` that
     logs to stderr so the failure is no longer silent; or
   - (b) include that change here.

   The evaluator's recommendation is (a), given the CI-wide red. It is not the evaluator's call.

### Non-blocking Suggestions

- In `files-modified.md`, note that `require('@modelcontextprotocol/sdk/package.json').version` prints `undefined`
  (it resolves to the `dist/cjs` type marker). Anyone re-running the "installed version" check should read
  `helio-mcp/node_modules/@modelcontextprotocol/sdk/package.json` directly.
