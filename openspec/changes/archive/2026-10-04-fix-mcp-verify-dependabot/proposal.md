## Why

`npm run verify` — helio-mcp's real-MCP-client smoke harness — has been broken since HEL-913: it sends
`create_pipeline` the retired single-`source` shape and dies with `roots: Required`. Nothing caught it because
nothing ties the script's payloads to the live tool schemas. It also leaves its fixtures behind in the shared dev DB.
Separately, helio-mcp has no Dependabot entry, so it gets advisories but never update PRs (HEL-1204 found 8).

## What Changes

- `helio-mcp/scripts/verify.ts`: every write-tool payload moves to the current shape (`create_pipeline` →
  `roots[]`); payloads are built by pure, importable builders.
- verify mints its own run-scoped PAT from the bootstrap `HELIO_PAT`, runs the server under it, and revokes it by
  exact id; every fixture it creates (pipeline, inline source) is deleted by exact id in a `finally`, and the
  deletions are confirmed.
- A Jest drift guard drives each verify write payload through the real registered tool (in-process MCP client) and
  fails if the tool's input schema rejects it.
- `.github/dependabot.yml`: npm entry for `/helio-mcp` (weekly, limit 10, `dependencies` label), with an
  `mcp-sdk` family group (`@modelcontextprotocol/sdk` + its peer `zod`) ahead of the `dev-dependencies` catch-all;
  `scripts/check-dependabot-groups.mjs` declares that family and loads a manifest for every npm entry in the config.
- `helio-mcp/README.md` "Verifying" section updated (stale `compose.ts` layout entry removed).

## Capabilities

### New Capabilities
- `mcp-verify-harness`: the end-to-end MCP smoke harness — current payload shapes, self-cleaning fixtures, PAT
  lifecycle, and a schema-drift guard.

### Modified Capabilities
- `dependabot-update-grouping`: helio-mcp gains an update configuration with its co-versioned family grouped.

## Non-goals

- No backend change, no migration, no new runtime/dev dependency.
- Not validating MCP tool inputs against `schemas/` HTTP request schemas (wrong layer — see design D2).
- Not extending verify to every write tool helio-mcp exposes; only the ones it calls.

## Impact

`helio-mcp/scripts/`, a new Jest test under `helio-mcp/`, `helio-mcp/README.md`, `.github/dependabot.yml`,
`scripts/check-dependabot-groups.mjs` (+ selftest if it enumerates families). No shipped server code changes.
