## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed at HEAD `9c41719c376b858ab9269fa6075f8b3b74acabd1` (the change dir is untracked; no commits on the branch yet).
I ran every npm/npx call with `npm_config_cache`/`npm_config_logs_dir` pointed at `hel1348-` dirs in the scratchpad. I ran nothing from the packed tarballs; I only read and diffed them.

### What I verified (with evidence)

**(a) 1.31.0 is fixed and installable.**
- `npm view @modelcontextprotocol/sdk versions` lists ...1.29.0, 1.30.0, 1.30.1, 1.31.0, 1.32.0, 1.32.1. This matches design.md.
- The registry bulk advisory endpoint (`/-/npm/v1/security/advisories/bulk`, queried for 1.29.0/1.30.1/1.31.0/1.32.1) returns exactly one advisory: GHSA-6qxp-vccf-f47h, high, `vulnerable_versions: ">=1.12.0 <1.31.0"`. So 1.31.0 is the smallest fixed version, and it has no other advisory.
- Lock simulation: I copied helio-mcp's package.json and package-lock.json into the scratch dir `hel1348-locksim` and ran `npm install @modelcontextprotocol/sdk@1.31.0 --save --package-lock-only --ignore-scripts` on npm 10.9.8 / Node v22.23.2, the same versions as CI. Result: `found 0 vulnerabilities`.
- Ran `npx audit-ci --config helio-mcp/.audit-ci.jsonc` twice:
  - Against the simulated lock: `Passed npm security audit.`, exit 0.
  - With the exact CI command on the base worktree: `Failed ... high ... GHSA-6qxp-vccf-f47h`, exit 1.
  - Red→green reproduces locally.

**(b) API-surface claims for what helio-mcp imports.**
- I enumerated the import specifiers across helio-mcp (`src`, `scripts`, `e2e`): `server/mcp.js` (12), `types.js` (11), `client/index.js` (7), `inMemory.js` (4), `client/stdio.js` (3), `server/stdio.js` (1). This matches design.md.
- I packed 1.29.0 and 1.31.0 into separate empty scratch dirs (`hel1348-pack129` and `hel1348-pack131`).
  - The `exports` maps are identical.
  - These `.d.ts` files are byte-identical in both esm and cjs: `server/mcp`, `server/index`, `client/index`, `shared/protocol`, `inMemory`, `types`, `server/zod-compat`.
  - `server/stdio.d.ts` differs only by an optional third constructor arg `options?: {maxBufferSize?}`. `client/stdio.d.ts` gains an optional `maxBufferSize` param. `shared/stdio.d.ts` adds `STDIO_DEFAULT_MAX_BUFFER_SIZE` and an optional constructor. All of these are additive. Design.md's claim holds.
- Runtime JS diffs for the imported modules:
  - `server/mcp.js` is identical (not in `diff -rq`).
  - `server/index.js` and `client/index.js` only replace inline literal extraction with `getLiteralValue` (refactor c).
  - `zod-compat.js` `getParseErrorMessage` now joins all zod issues as `"<msg> at <dot.path>"` and checks them before `message` (change b).
  - `shared/stdio.js` `ReadBuffer` throws past 10 MB, and `server/stdio.js` catches that, calls `onerror`, and closes (change a).
  - Design.md's three runtime bullets are accurate.
- I grepped helio-mcp `*.ts` for `Input validation`, `Invalid arguments`, `ReadBuffer` and `maxBufferSize`: zero hits. No test pins the exact zod error text, so change (b) is unlikely to break Jest. The escalate-on-edit risk path is still correctly planned.

**(c) Smallest change.**
- The simulated `npm install ...@1.31.0 --save` changes three things:
  - `package.json`: the one dependency line `^1.29.0` → `^1.31.0`.
  - Lockfile root `packages[""]` dependency line.
  - The sdk entry: version, resolved URL, integrity, and its own `@hono/node-server` range.
- The `packages` key→version diff (base vs simulated) is exactly `node_modules/@modelcontextprotocol/sdk 1.29.0 → 1.31.0`. zod, hono, `@hono/node-server` and express are unchanged.
- The design's "every range already satisfied by the current lock" claim is confirmed.
- A lockfile-only change (keeping `^1.29.0`) would be one line smaller. But it leaves the floor inside the vulnerable range. It also departs from the HEL-1346 precedent (6880ba860), which raised the floor. Exact 1.31.0 rather than 1.32.1 is correct per "smallest change".
- Note for D2: the root `packages[""].dependencies` line also changes. That is a range edit, not a version change, so the D2 key/version check will not flag it. files-modified.md should still mention it, so the diff isn't read as unexplained churn.

**(d) Do the gate, smoke and Jest plans prove what they claim?**
- Jest resolution:
  - The worktree has no root `node_modules`, and the root package-lock has no `@modelcontextprotocol` entry. Root Jest (from the worktree root, tests under `helio-mcp/src`) can therefore only resolve the sdk from `helio-mcp/node_modules`.
  - D3's `npm ci` + version assertion before Jest makes the Jest gate a real 1.31.0 measurement. Jest loads the cjs build and the runtime uses esm; both changed identically per the diff above.
  - D4's "record which copy" is the right guard.
  - The current `helio-mcp/node_modules` is consistent with the lock (`npm ls --all` rc=0, sdk 1.29.0, zod 3.25.76), so the base baseline (task 1.2) is valid.
- Smoke (D5):
  - `loadConfig` needs only `HELIO_PAT` with a `helio_pat_` prefix plus an optional base URL.
  - `initialize`, `listTools` and `listResources` need no backend.
  - Invalid-args `callTool` fails in sdk validation (`mcp.js` → `getParseErrorMessage`) before any handler runs.
  - So base-vs-branch actually exercises the changed runtime paths: the stdio transport and the error formatter.
- CI parity: CI runs `check:helio-mcp-types` (= `npm --prefix helio-mcp run typecheck`, covered by task 2.2) and `npm test` (root jest, task 2.3). No CI gate touching helio-mcp is missing from the plan.

**Placeholders, contradictions, scope:** none found. Tasks map to every AC:
- resolve ≥1.31.0 smallest: 1.3/1.4
- no allowlist: 1.5, C2
- list changed packages: 1.4/2.6
- build, typecheck, Jest: 2.1–2.3
- smoke and API check: 1.2/2.4/2.5
- CI red→green: 1.1/1.5/2.7

The proposal, design and tasks agree with each other. No contract or spec delta is needed (`skip_specs` is justified: no behavior change).

### Verdict: CONFIRM

### Non-blocking notes
1. Task 1.1 order: the worktree has no root `node_modules`, so a bare `npx audit-ci` there fetches the latest audit-ci rather than the root-pinned `^7.1.0` CI uses. Run root `npm ci` before 1.1 (CI also runs root `npm ci` first), or record the audit-ci version used.
2. Smoke script (scratchpad): import `Client`/`StdioClientTransport` by absolute path into the worktree's `helio-mcp/node_modules/@modelcontextprotocol/sdk/...`, and record that copy's `package.json` version on each run. Otherwise the client side's sdk version is unverified.
3. Smoke comparison: diff the full `listTools()` JSON (inputSchemas included), not just the sorted names. It costs nothing and covers schema serialization too.
4. files-modified.md: note that the lockfile root `packages[""]` dependency-range line and the sdk entry's own `@hono/node-server` range change alongside the version. Both are expected and are not package-version churn.
5. Root `npm run lint` (`eslint .`) also covers helio-mcp in CI; running it once on the branch is cheap.
