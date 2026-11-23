# HEL-1827: HEL-1625 context-analyze hardening: raw source-id lookup, per-pipeline fallback on missing steps, N+1 mutation for the statement-count spec

## Description

origin_kind: followup
origin_ticket: HEL-1625 (PR matto00/helio#1235, merged as 07a118001). The owner chose a standalone ticket.

The final reviewer's non-blocking notes on `GET /api/pipelines/context-analyze` and the helio-mcp `get_workspace_context` batch path:

1. **Raw source-id lookup.** The batch resolvers normalise source ids with `UUID.fromString`, so the batch could find a non-standard id (for example upper-case) that per-pipeline `/analyze` would not. The API cannot produce such an id today. Look up the raw id the way `/analyze` does, and fix the wrong "compares as uuid" comment on `findByIdsOwned`.
2. **Missing `steps` fallback.** In helio-mcp, a batch item with no `steps` array should fall back to the per-pipeline analyze call instead of producing a `stepsError`. The MCP payload must stay byte-identical to the HEL-1619 goldens.
3. **N+1 mutation.** The statement-count spec's only red so far is a compile failure. Record a real N+1 mutation, one query per pipeline, that turns it red.

helio-mcp is a source change only. The hosted MCP picks it up at its next redeploy.

## Acceptance criteria

- [ ] Item 1: a test fails first.
- [ ] Item 2: a test fails first, and the goldens are unchanged.
- [ ] Item 3: the mutation run is committed and shows red.
