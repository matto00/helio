# Proposal — type-registry-origin-distinction (HEL-270)

## Why

HEL-270 asked for a visual distinction between source-inferred and pipeline-output DataTypes in
the Type Registry sidebar. Since the ticket was filed, `ad939146` (pipeline-only bindings) made the
registry list *only* pipeline-output DataTypes (`sourceId === null`) via
`selectPipelineOutputDataTypes`, and HEL-256 Fix B′ made the backend 409 destructive deletes —
so the filed AC1 (source-vs-pipeline distinction) and AC2 (delete affordance) are already
structurally resolved: source-DTs never appear, and the remaining panel-bound-delete 409 already
surfaces as a clear error toast. Per human direction (escalation resolved 2026-07-18), we ship the
surviving valuable piece: at-a-glance provenance — *which pipeline produces this DataType*.

## What Changes

- Type Registry sidebar entries (`SidebarBody` registry section via `SidebarItemList`) gain a
  "Pipeline: <name>" provenance subtitle, derived frontend-only from
  `PipelineSummary.outputDataTypeId` in the already-loaded pipelines slice.
- The registry section fetches pipelines when active (mirroring the sources section's existing
  cross-slice fetch pattern in `SidebarBody`).
- The phone section-item sheet (`MobileNavSheet`) registry items gain the same subtitle for
  desktop/mobile parity ("do not fork the state" — the sheet is fed by the same selectors).
- `SidebarItem` / `MobileNavSheetItem` gain an optional `subtitle` field rendered per DESIGN.md
  (token-based type scale, secondary text color).

## Non-goals

- No backend/schema changes (ticket AC; re-escalate if one turns out to be required).
- No source-vs-pipeline visual distinction (AC1 obsolete — source-DTs are excluded from the list).
- No delete-affordance changes (AC2 satisfied by HEL-256 409 + existing error toast; proactive
  warning rejected at escalation as redundant).
- No linking of the subtitle to the pipeline detail page (nested-interactive-element a11y hazard
  inside the existing row button; rejected as "complicates" per escalation guidance).
- No changes to `TypeRegistryBrowser` / `TypeDetailPanel` (detail surface, not the list).

## Capabilities

### New Capabilities

- `type-registry-provenance`: Type Registry list surfaces (desktop sidebar + phone section sheet)
  show each DataType's producing pipeline as a provenance subtitle, derived client-side.

### Modified Capabilities

(none — no existing spec covers the registry list UX; `type-registry-content-fields` covers field
typing, `datatype-crud-api` covers the API, neither changes)

## Impact

- `frontend/src/shared/chrome/SidebarBody.tsx` — registry section: fetch pipelines, build
  DT→pipeline-name map, pass subtitles.
- `frontend/src/shared/chrome/SidebarItemList.tsx` (+ `DashboardList.css`) — optional subtitle.
- `frontend/src/shared/chrome/MobileNavSheet.tsx` (+ its CSS) — optional subtitle.
- `frontend/src/app/App.tsx` — registry sheet items carry subtitles.
- Tests for the above. No backend, schema, or API changes.
