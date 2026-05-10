## Context

The Cast Type operation already has partial scaffolding from HEL-233:
- `PipelineAnalyzeService.inferCast` uses config shape `{"casts": {"fieldName": "targetType"}}` (multi-field map)
- `InProcessPipelineEngine.applyCast` uses config shape `{"column": "fieldName", "dataType": "targetType"}` (single-field)
- `allowedOps` already includes `"cast"` in `PipelineStepRoutes.scala`
- Frontend `OP_TYPES` already has `{ id: "cast", label: "Cast type", icon: "⇄" }` but no `CastFieldsConfig` component
- The default config for cast in PipelineDetailPage is `"{}"` instead of the correct `'{"casts":{}}'`

This is the same config-shape divergence caught in HEL-188 for rename. The `inferCast` multi-field map
shape is authoritative because it supports casting multiple fields in one step. `applyCast` must be
updated to match.

## Goals / Non-Goals

**Goals:**
- Fix `applyCast` to use `{"casts": Map[String,String]}` matching `inferCast`
- Implement correct per-field cast with runtime error surfacing (null on failed cast)
- Implement `CastFieldsConfig` React component using analyze `inputSchema`
- Fix default seed config from `"{}"` to `'{"casts":{}}'`
- Wire config hydration from persisted step on reload
- Backend tests covering: empty casts (no-op), missing field (passthrough), valid casts, failed casts (null)

**Non-Goals:**
- Changing `inferCast` (it is correct as-is)
- New REST endpoints or DB migrations
- Chained/custom coercions

## Decisions

### D1: Canonical config shape — `{"casts": {"field": "type"}}`
`inferCast` already defines this shape and was written last (HEL-233). The old `applyCast` (single
column/dataType) is wrong. Fix `applyCast` to iterate `casts` map, cast each named field, pass
through all others unchanged.

Alternatives considered: keep single-column shape, change `inferCast` — rejected because
multi-field is strictly more capable and avoids requiring multiple steps for multi-column casts.

### D2: Runtime cast failure → null (not error)
`castValue` already returns `null` on parse failure. The preview/run output will show `null` for
cells that couldn't be cast, which surfaces the error without aborting the entire run. This matches
the HEL-189 requirement to "surface cast errors in the preview."

### D3: Supported target types
`castValue` already supports: `string`, `integer`, `long`, `double`, `boolean`. The `inferCast`
outputSchema uses the declared type unconditionally. The frontend dropdown should offer the same set.

### D4: `CastFieldsConfig` UI pattern — table of field rows with type dropdowns
Follows the same pattern as `RenameFieldsConfig` (table of rows derived from analyze `inputSchema`).
Each row: field name (read-only) + target-type `<select>` dropdown. Selecting "— keep as is —"
removes the field from the `casts` map.

### D5: Config hydration
Same as rename: parse the persisted config JSON on mount, populate `casts` state map.

## Risks / Trade-offs

- **Risk**: `castValue` silently returns null for unknown type strings.
  → Mitigation: constrain the frontend dropdown to the known supported types only.
- **Risk**: `date` is not in `castValue` supported types despite being mentioned in the ticket.
  → Resolution: executor should check `castValue` and add `date` handling if feasible, or document
    that `date` is deferred.

## Planner Notes

- Config shape divergence was self-detected by reading both `inferCast` and `applyCast` before writing
  specs. This is the critical alignment fix for this ticket.
- `allowedOps` already includes `"cast"` — no route changes needed.
- Default seed config must change from `"{}"` to `'{"casts":{}}'` in the `OP_TYPES` initializer in
  `PipelineDetailPage.tsx`.
