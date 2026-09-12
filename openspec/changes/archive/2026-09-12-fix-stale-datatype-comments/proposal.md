## Why

HEL-1118's headline defect (StaticSource scaladoc describing a retired DataType read path) is
already fixed on main by HEL-1073/HEL-1074, which landed after the ticket was filed. What's left
is the sweep the ticket also asked for: a triage of stale DataType/type-registry/snapshot-row
comments across `backend/src/main`, plus one confirmed-stale wire-format literal in
`helio-mcp/src/helioApi.ts`.

## What Changes

- Confirm (not re-fix) that the `StaticSource`/`DatasetSource` scaladoc is already correct.
- Grep `backend/src/main` for DataType/type-registry/snapshot-row references, classify every hit
  (accurate-historical / unrelated-identifier / genuinely-stale / uncertain), and fix only the
  genuinely-stale ones.
- Change `helio-mcp/src/helioApi.ts:456` from `type: "static"` to `type: "dataset"`.
- Write the triage classification into the change dir and the PR body.

## Capabilities

No capability/spec-level behavior changes — this is a comment/doc correction plus one internal
wire-literal fix with no externally-observable behavior change (`"static"` is still accepted
server-side as a wire alias). `skip_specs: true` set in `.openspec.yaml`.

### New Capabilities
(none)

### Modified Capabilities
(none)

## Non-goals

- Not re-implementing anything HEL-1073/HEL-1074 already did.
- Not mass-editing comments that accurately describe a past removal.
- Not touching `helioApi.ts:93`'s `CSV_LIKE_TYPES` (deliberate read-side alias).

## Impact

`backend/src/main/**/*.scala` (comments only, wherever genuinely stale), `helio-mcp/src/helioApi.ts`
(one literal). No schema, migration, or API contract changes.
