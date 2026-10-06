# HEL-1348: Fix GHSA-6qxp-vccf-f47h: bump @modelcontextprotocol/sdk to ≥1.31.0 in helio-mcp (CI security job red)

## Description

CI's `security` job now fails at the helio-mcp audit step on **GHSA-6qxp-vccf-f47h**. It affects
`@modelcontextprotocol/sdk` versions >=1.12.0 and <1.31.0. The advisory landed around 2026-10-06 17:05Z and is red on
every PR (for example PR matto00/helio#797, HEL-1291, run 37501186767).

`helio-mcp/package.json` declares `"@modelcontextprotocol/sdk": "^1.29.0"`, and the lockfile resolves 1.29.0. The fixed
version is 1.31.0.

**Owner ruling (2026-10-07):** fix it now, **bumping the sdk only**. Dependabot PR matto00/helio#760 bundles a zod
update, so don't use it. After this merges, close #760 or rebase it to zod-only.

## Acceptance Criteria

- `@modelcontextprotocol/sdk` resolves to ≥ 1.31.0, with the smallest change.
- **No allowlist entry.** helio-mcp's audit gate is at moderate (HEL-1204).
- List every lockfile package whose version changed.
- helio-mcp build, typecheck and Jest pass. The verify harness or an MCP smoke test still works: check that the
  transport and tool registration API didn't change between 1.29 and 1.31.
- Show the helio-mcp audit step red→green on CI.
- **Added by owner ruling (2026-10-06, escalation HEL-1348-1791308333627-b3fa45, answer `include-index-edit`):**
  sdk ≥1.31.0 adds a 10 MiB stdio ReadBuffer cap and `StdioServerTransport` closes the session on overflow. In
  `helio-mcp/src/index.ts`: pass `{ maxBufferSize }` to `new StdioServerTransport(...)`, set at or above the largest
  request helio-mcp can legitimately forward (backend CSV entity limit 15 MiB, plus JSON-escaping/base64 overhead),
  with the value and its derivation stated; and register an `onerror` handler that logs to stderr.
- Red/green proof: an 11 MB inline-CSV `create_csv_data_source` request gives `-32000 Connection closed` on the bump
  alone (a774c3d99) and is forwarded to the backend with the fix.
- `files-modified.md` and design D6 corrected; response side marked unverified.

## Driver constraints (binding for this run)

- Bump the sdk ONLY; do not touch zod; do not use Dependabot PR #760.
- No allowlist entry; if no installable fixed version exists, escalate.
- Touch only `helio-mcp/package.json`, `helio-mcp/package-lock.json` and (per the owner ruling) `helio-mcp/src/index.ts`
  (plus this change dir); any further file means escalate to the driver first. HEL-1297 (PR #801) is editing the helio-mcp verify
  harness and README in parallel. Never touch `.github/workflows/ci.yml`, `playwright.config.ts`, `.gitignore`,
  `frontend/`.
- Build helio-mcp fresh in the worktree; never use the session's helio MCP tools (stale dist).
- Audit red→green with the exact CI command `npx audit-ci --config helio-mcp/.audit-ci.jsonc --directory helio-mcp`,
  locally and on CI. At most one CI run at a time.
- No writes under `~`: project-local/scratchpad `npm_config_cache` and logs dir, kept out of the commit.
- Never select kill/delete targets by pattern, name or time window; never `pkill`/`pgrep`/`killall`.
- Precedents: HEL-1319 (9c247cf6), HEL-1346 (6880ba86).
