## Why

While a pipeline draft is open, the "Rows after step N" grid orders its columns by the keys of the frame's rows (`frameSchema`, first-seen key order), not by the step's output schema, so the columns look scrambled. Row key order is not a schema order on this path: the client root frame comes from `GET /api/data-sources/:id/sample`, whose rows arrive in hash key order (probe: `total,amount,id,note,status,region,owner,created` for a source declared `id,region,status,amount,total,created,owner,note`); a server-resolved step's rows and its NDJSON `step`-line `schema` are Scala `Map` iteration order (hash order beyond four keys); and the client `rename` op moves a renamed key to the end. HEL-1705 fixed the same problem for saved Output rows but not for draft step frames. Separately, `mapServerResolved` drops the last good frame's `truncated` flag when it falls back to that frame.

Owner ruling (2026-11-18, escalation on evaluation-1.md): **redesign-no-request**. The standing `pipeline-draft-mode-ui` requirement "Client-evaluable edits recompute locally with no request" stays exactly as written; the fix must send no request of any kind on a client-evaluable edit.

## What Changes

- The draft frame's column order is made trustworthy at the places it is lost, in the browser, with data the page already holds:
  - every sample that becomes an input frame (a root, or a join/union/lookup source secondary) is keyed in its source's declared schema order (saved analyze `sourceSchemas` by exact root id, else the sources list's `inferredSchema`, else code-unit), memoized so an unchanged order keeps the same frame (design D1);
  - client step handlers that move or create columns put them where the server's analyze projection puts them (for example `rename` renames in place);
  - a server-resolved step's rows (hash order) are ordered by the step's saved analyzed schema when nothing it depends on (its steps, root binding, lanes and source secondaries) changed in the draft (design D3b), otherwise by its nearest client-evaluated ancestor's frame order, with new columns after in code-unit order.
- The "Rows after step N" draft grid orders its columns by that frame order (no `analyze-proposal`, no new request).
- `mapServerResolved` keeps `truncated` from the last good frame when it falls back to that frame's rows.
- The round-1 cycle's request-sending pieces (the grid projection hook and the page-scoped projection cache wired into the Output editor sheet) are removed; the Output editor sheet's behavior is exactly as on main.
- No backend change, no wire/schema change, no migration.

## Capabilities

### New Capabilities

### Modified Capabilities
- `pipeline-draft-mode-ui`: adds requirements for draft step preview column order (with no request) and for keeping the truncation flag on the last-good-frame fallback. The existing "Client-evaluable edits recompute locally with no request" requirement is unchanged.

## Impact

- Frontend only: the sample decode / root frame path, the client step handlers whose column position differs from the server analyze (at least `rename`; audited per op), `state/draftStepView.ts`, `ui/spine/StepPreviewTable.tsx`, and tests.
- Frontend deploys alone.
