## Why

helio's `CLAUDE.md` "Key endpoints" list is read by every agent and human as the quick API map. It claims
`GET/DELETE /api/data-sources/:id`, but `DataSourceRoutes.scala` mounts only `PATCH` and `DELETE` on that path, so a GET
is method-rejected (405). HEL-1264's lane hit this. A wrong doc line in a file agents trust is a silent-failure hazard,
and the same drift likely exists in sibling bullets.

## What Changes

- Re-derive the data-sources bullets of the "Key endpoints" list from `DataSourceRoutes.scala`,
  `DataSourcePreviewRoutes.scala` and `ApiRoutes.scala`: correct `:id` to `PATCH/DELETE`, and add one compact bullet listing
  every data-sources (path, method) pair the executor finds in those routers (the set is derived in tasks.md 1.4, not
  here).
- Check every other bullet in the same list (method + path, plus any existence/negative claim such as "no authenticated
  GET", "now 404", "no runtime firing yet") against the route tree / code, and correct any false line.
- Decision: no `GET /api/data-sources/:id` is added — no caller needs it (see design.md).

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

(none — documentation-only; `skip_specs: true`)

## Impact

- `CLAUDE.md` (repo root of helio) "Key endpoints" section only. No code, schema, or API change.

## Non-goals

- Adding a GET-by-id route.
- Editing the env-var table, Architecture prose, or any section outside "Key endpoints".
- Exhaustively documenting every route (the list stays a "key endpoints" summary).
- Verifying detailed behavioral prose (status-code matrices, limits) beyond method/path/existence claims.
