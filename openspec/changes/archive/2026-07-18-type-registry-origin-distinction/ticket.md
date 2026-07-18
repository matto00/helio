# HEL-270 — Type Registry sidebar: visual distinction between source-DTs and pipeline-output DTs

- **Priority:** Low (UI polish)
- **URL:** https://linear.app/helioapp/issue/HEL-270/type-registry-sidebar-visual-distinction-between-source-dts-and
- **Surfaced during:** HEL-256 cycle 1b investigation

## The issue

The Type Registry sidebar (`frontend/src/shared/chrome/SidebarBody.tsx`, ticket cites ~lines 119-124 — VERIFY current line numbers, the file has since been touched by several tickets) renders every DataType with a Delete action and no visual distinction between:

- **Source-auto-inferred DTs** — created by `DataSourceService.createCsv` / `createStatic` / `createSql`; tied to a `data_source` row via `sourceId`. Deleting these is destructive in a non-obvious way (the source loses its schema until refreshed; the source still appears in the Sources page but with empty schema).
- **Pipeline-output DTs** — created by `PipelineRepository.create` with `sourceId = None`; safe to delete independently.

HEL-256 (cycle 1b) landed `DataTypeService.delete` returning **409** when the DT has a live `sourceId` (preventing the destructive delete entirely), but the UX would be cleaner if the sidebar surfaced the distinction up front.

## Proposed UX (from ticket — final design decided in planning per DESIGN.md)

- Show source-DTs grouped under their parent DataSource (or with a "Source: <name>" subtitle), pipeline-DTs grouped under their parent Pipeline (or with "Pipeline: <name>")
- Delete action either disabled for source-DTs (with tooltip "Delete the source instead") OR opens a confirmation that explains the source-binding implication
- Optional: link source-DT entries to the Sources page detail view, pipeline-DT entries to the pipeline detail page

## Acceptance criteria

- A user looking at the Type Registry sidebar can tell at a glance whether a DT came from a source vs a pipeline
- The Delete affordance reflects the back-end constraint (no surprise 409s from HEL-256 Fix B′)
- **No new backend changes required**

## Session directives (from the user)

- DETERMINE how origin is known: check whether the DataType model/API already carries an origin/provenance field (e.g. `sourceId`) or whether it must be derived. If the distinction requires a backend/schema change to expose provenance, that's an ESCALATION. Prefer a frontend-derivable signal.
- Honor DESIGN.md (tokens, spacing/type scales, shared components).
- If the sidebar is reachable in the <768px mobile shell, apply the 390×844 + ≥44px verification standard; if it's desktop-only (sidebar is display:none ≤768px per prior findings), state that and scope verification to desktop.
- Playwright screenshots to session scratchpad or gitignored tmp — NEVER the repo root. NEVER bulk-delete by glob.
- HEL-306 cleanup may briefly run in parallel — stay inside this worktree and ports (DEV_PORT=5443, BACKEND_PORT=8350).

## Related

- HEL-256 — backend already prevents the destructive delete via Fix B′ (409 on delete of DT with live `sourceId`)
- HEL-251 / HEL-252 — adjacent Type Registry UX work
