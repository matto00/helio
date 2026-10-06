## Why

The CI `security` job is red on every PR and on main: GHSA-6qxp-vccf-f47h (high) affects `@modelcontextprotocol/sdk`
>=1.12.0 <1.31.0, and `helio-mcp/package-lock.json` resolves 1.29.0. "Nothing moved, the world did" — no repo change
caused it, and every lane's merge is blocked until it is fixed.

## What Changes

- `helio-mcp/package.json`: raise the `@modelcontextprotocol/sdk` floor from `^1.29.0` to `^1.31.0`, so a future
  `npm install` can never resolve back into the vulnerable range.
- `helio-mcp/package-lock.json`: regenerate so the sdk resolves to exactly 1.31.0 (the smallest fixed version, not
  the latest 1.32.x). Every other locked package is expected to stay put — 1.31.0's dependency ranges are all already
  satisfied by the current lock.
- No source change, no `overrides`, no allowlist entry, no zod change.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

None — dependency security patch only, no spec-level behavior change (`skip_specs: true`).

## Impact

- `helio-mcp/` only: two files. The sdk is helio-mcp's runtime MCP framework (`McpServer`, `StdioServerTransport`;
  `Client`/`StdioClientTransport`/`InMemoryTransport` in tests and the verify/e2e harnesses), so the public API
  helio-mcp uses is diffed 1.29 → 1.31 and exercised by build, typecheck, the root-Jest helio-mcp suite, and an
  stdio smoke test against the freshly built `dist`.
- Coordination: HEL-1297 (PR #801) edits the `scripts` block of the same `package.json`; this change edits only the
  `dependencies` line.

## Non-goals

- zod (Dependabot #760's other half), any other dependency movement, `npm audit fix`.
- Audit thresholds/allowlists, `.github/workflows/ci.yml`, `playwright.config.ts`, `.gitignore`, `frontend/`.
- The helio-mcp verify harness / README (HEL-1297's scope).
- Closing or rebasing Dependabot #760 (owner follow-up after merge).
