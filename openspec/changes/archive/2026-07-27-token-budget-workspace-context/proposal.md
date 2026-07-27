## Why

`GET /api/workspace/context` (HEL-371/372/373/374) now returns sample rows, per-column statistics,
semantic roles, and join hints for every DataType. There is no ceiling on the result: a workspace
with many wide, populated DataTypes can produce a multi-megabyte payload. When this feeds the
HEL-341 server-side Claude call it burns prompt tokens and cost, and could blow the context
window. The payload must fit a configurable budget, shrinking deterministically — same input and
budget always produce the same output — never by arbitrary/random truncation.

## What Changes

- Add a deterministic, pure budgeting pass (`WorkspaceContextBudget`) that runs after assembly, in
  a fixed priority order: keep all structure (ids, columns, `columnStats` scalars, pipeline steps,
  dashboards) always; shrink `sampleRows` row count next; then `columnStats.exampleValues` list
  length; then `joinHints` count — never dropping a resource itself.
- Add a `truncation` object to the response: whether/how much was shrunk, the caps actually
  applied, and whether even the fully-shrunk structural floor still exceeds the budget. Always
  present (empty/false-valued when nothing was trimmed) — no `Option`-omission risk.
- Add an optional `budgetBytes` query param on `GET /api/workspace/context`; a configurable,
  generous default (env-var override) applies when omitted.
- Make the existing `Page.Default` (200-item) list truncation self-describing: `truncation` reports
  which resource kinds (`dataSources`/`dataTypes`/`dashboards`) were paginated past their fetched
  page, computed from the already-fetched `PagedResult.total` vs. `items.length` — no new query,
  no raised limit (a higher limit would work against this ticket's own cost goal).
- Port the identical priority order and caps to `helio-mcp/src/context.ts`'s
  `buildWorkspaceContext`, independently implemented (no shared runtime), with its own tests.
- `schemas/workspace-context.schema.json` documents `truncation` and its fields.

## Capabilities

### Modified Capabilities

- `workspace-context-assembly`: the response gains a required `truncation` field and byte-budget
  behavior; `GET /api/workspace/context` gains an optional `budgetBytes` query parameter.

## Impact

- `backend/src/main/scala/com/helio/services/WorkspaceContextService.scala` (calls the new budget
  pass at the end of `assemble`) and a new `WorkspaceContextBudget.scala` (pure trimming logic —
  new file per HEL-631's "prefer a new file over growing the existing 705-line service further").
- `backend/src/main/scala/com/helio/api/protocols/WorkspaceContextProtocol.scala` (new
  `WorkspaceContextTruncation` type + formatter), `WorkspaceRoutes.scala` (query param).
- `helio-mcp/src/context.ts` (mirrored budgeting logic), `helio-mcp/src/context.test.ts`.
- `schemas/workspace-context.schema.json`.
- No database migration; no existing field removed or renamed.
