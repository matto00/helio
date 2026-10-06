## Context

Verified against the live tree at base `9c41719c3` (Setup premise validation, persisted as evidence):

- `helio-mcp/package.json` declares `"@modelcontextprotocol/sdk": "^1.29.0"`; `helio-mcp/package-lock.json`
  (lockfileVersion 3) resolves `node_modules/@modelcontextprotocol/sdk` to 1.29.0.
- CI step `helio-mcp audit (helio-mcp/)` runs `npx audit-ci --config helio-mcp/.audit-ci.jsonc --directory helio-mcp`
  from the root (`"moderate": true`, empty allowlist). Local red baseline on base: exit 1,
  `GHSA-6qxp-vccf-f47h|@modelcontextprotocol/sdk` (high).
- Registry: 1.30.0, 1.30.1, 1.31.0, 1.32.0, 1.32.1 published. 1.31.0 is the smallest fixed version.
- 1.31.0's `dependencies` are identical to 1.29.0's except `@hono/node-server` widened from `^1.19.9` to
  `^1.19.9 || ^2.0.5`. Every range is already satisfied by the current lock (e.g. `@hono/node-server` 1.19.17,
  hono 4.13.13, express 5.2.1, zod 3.25.76).
- helio-mcp imports from the sdk: `server/mcp.js` (McpServer), `server/stdio.js` (StdioServerTransport, `index.ts`
  only), `types.js`, and in tests/harnesses `client/index.js`, `client/stdio.js`, `inMemory.js`.
- Published-artifact diff (`npm pack` 1.29.0 vs 1.31.0, `dist/esm`): `server/mcp.d.ts`, `server/index.d.ts`,
  `client/index.d.ts`, `shared/protocol.d.ts`, `inMemory.d.ts`, `types.d.ts` are byte-identical. Additive only:
  `StdioServerTransport` gains an optional 3rd ctor arg `{maxBufferSize}`, `StdioClientTransport` params gain optional
  `maxBufferSize`. Runtime behavior changes worth testing: (a) `shared/stdio.js` `ReadBuffer` now throws past a
  10 MB default on a single un-newlined buffer; (b) `server/zod-compat.js` error-message formatting now joins ALL zod
  issues as `"<msg> at <dot.path>"` instead of only the first issue's message; (c) literal-method extraction moved
  to a shared helper (refactor).

## Goals / Non-Goals

**Goals:** helio-mcp audit green with no allowlist; lockfile diff = the sdk entry only; helio-mcp unchanged in
behavior. **Non-Goals:** see proposal.md — Non-goals.

## Decisions

1. **Pin the resolve to exactly 1.31.0 with a `^1.31.0` floor.** In `helio-mcp/`, run
   `npm install @modelcontextprotocol/sdk@1.31.0 --save` (npm 10.9.8 / Node 22, as CI; default save-prefix `^`
   writes `^1.31.0`). Rejected: editing the floor then `npm install` (resolves 1.32.1 — larger change than needed);
   `npm audit fix` (moves arbitrary packages); `overrides` (the parent IS the vulnerable package; nothing to
   override); Dependabot #760 (bundles zod — owner ruling); allowlist (forbidden).
2. **Churn check is mechanical.** jq over `git show <base>:helio-mcp/package-lock.json` vs branch: list every
   `packages` key added, removed, or whose `version` changed. Expected set: exactly
   `{node_modules/@modelcontextprotocol/sdk: 1.29.0 → 1.31.0}`. Any other key must be justified individually in
   `files-modified.md`, or eliminated (if npm moved it gratuitously, revert that hunk). zod's entry must be
   byte-identical to base. `package.json` diff must be the one `dependencies` line.
3. **Installed tree must match the lockfile before gates** (MISTAKES.md "A local gate that fails where CI passes").
   `npm ci` in `helio-mcp/` after the change, then assert `node -p "require('@modelcontextprotocol/sdk/package.json')
   .version"` is 1.31.0 from `helio-mcp/` before build/typecheck/Jest.
4. **Gates.** In `helio-mcp/`: `npm run build` (fresh `dist`), `npm run typecheck`. Root: `npm ci` then
   `npx jest helio-mcp` (helio-mcp has no Jest of its own; its `*.test.ts` run under root `jest.config.cjs`). Verify
   which sdk copy root Jest actually resolves (`helio-mcp/node_modules` vs root `node_modules`) and record it; the
   Jest gate counts as evidence for this bump only if it loads 1.31.0.
5. **Stdio smoke test against the freshly built `dist`, base vs branch.** A scratchpad (uncommitted) script using
   the worktree's own `StdioClientTransport`/`Client` spawns `node helio-mcp/dist/index.js` with a dummy
   `HELIO_*` config pointing at an unused port (no backend needed): `initialize`, `listTools`, `listResources`,
   and one `callTool` with schema-invalid arguments. Record tool count + sorted tool names + resource URIs and the
   invalid-args error text, on base (1.29.0 build) and on branch. Expected: identical tool/resource sets; the error
   text may differ only per change (b). Rejected: `npm run verify` (needs a live backend + PAT, and HEL-1297 is
   rewriting that harness in parallel) — optional only if cheap; the stdio smoke is the required evidence.
6. **10 MiB ReadBuffer (revised after evaluation-1 + owner ruling `include-index-edit`).** The original premise
   ("server reads only small client requests") was false: `create_csv_data_source.content`, `create_data_source.rows`,
   `append_dataset_rows.rows` are uncapped and the backend accepts CSVs up to 15 MiB; evaluation-1 measured an 11 MB
   request closing the session on 1.31.0 (`-32000 Connection closed`, silent). Fix in `helio-mcp/src/index.ts` only:
   `new StdioServerTransport(undefined, undefined, { maxBufferSize: <N> })` where N is derived from the largest
   legitimate request (15 MiB CSV entity limit × worst-case JSON-escape expansion, and any base64 upload path ×4/3,
   plus envelope headroom) and stated with its arithmetic in a short code comment; and an `onerror` on the transport
   (and/or server) that writes to stderr, so an overflow is never silent. Red/green: the same 11 MB request against a
   scratch stub HTTP listener (recorded PID) — bump-alone build (a774c3d99) → `-32000`, fix build → request received
   by the stub (measured: 11,000,259 bytes received; 70 MB request logs the overflow to stderr). N = 64 MiB (4 x 15 MiB CSV; the image upload path is governed by IMAGE_UPLOAD_MAX_FILE_SIZE_BYTES, 10 MiB, ~13.3 MiB base64; not covered: >~9.8 MiB of C0 control bytes in a <=15 MiB CSV, which the backend does not reject — session closes with a stderr log). Response side (client reading helio-mcp output > 10 MiB) is UNVERIFIED: read tools cap row count,
   not bytes, and no backend-backed measurement was made.
7. **Red→green with the exact CI command,** run from the repo root on base and on branch with a scratchpad
   `npm_config_cache`; CI's own `security` job on the PR is the final authority (one CI run at a time).

## Risks / Trade-offs

- [npm re-resolves extra packages] → Decision 2's mechanical check; revert any unjustified hunk.
- [Error-text change (b) breaks a test asserting exact zod messages] → Jest surfaces it; if a source/test edit is
  needed, STOP and escalate to the driver (touch-only-two-files constraint) before editing.
- [HEL-1297 PR #801 edits the same `package.json`] → different hunk (scripts vs dependencies); the later merge
  re-checks mergeability.
- [Another advisory published mid-run] → re-run the audit immediately before the PR; out-of-scope findings escalate.

## Planner Notes

- Owner ruling `include-index-edit` (escalation HEL-1348-1791308333627-b3fa45) widened scope to `src/index.ts`.

- Self-approved: exact-1.31.0 resolve over 1.32.1 (smallest change per AC); `skip_specs: true` (no behavior
  change); smoke script kept in scratchpad, not committed (touch-only-two-files).
