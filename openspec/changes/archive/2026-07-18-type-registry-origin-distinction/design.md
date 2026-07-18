# Design — type-registry-origin-distinction (HEL-270)

## Context

The Type Registry sidebar (`frontend/src/shared/chrome/SidebarBody.tsx:119-150`) renders
pipeline-output DataTypes only (`selectPipelineOutputDataTypes`, `sourceId === null`) through the
shared `SidebarItemList`. Rows show name + optional badge (`renderBadge`, used for the
"Content" unstructured badge). The phone section-item sheet (`frontend/src/app/App.tsx`
`mobileSheetItems`, `MobileNavSheet`) renders the same filtered list as `{id, name, isActive}`.
`PipelineSummary` (`frontend/src/features/pipelines/types/pipelineStep.ts:277-289`) already carries
`outputDataTypeId?: string` (required `String` on the backend wire — `PipelineProtocol.scala:16`;
optional in the TS type), so DT → producing-pipeline is derivable client-side from
`state.pipelines.items`.

## Goals / Non-Goals

**Goals:** at-a-glance "Pipeline: <name>" provenance on both registry list surfaces, frontend-only,
DESIGN.md-conformant. **Non-goals:** see proposal (no backend change, no AC1/AC2 work, no subtitle
link, no detail-panel changes).

## Decisions

1. **Derive provenance via a memoized selector, not inline maps.** Add
   `selectPipelineNameByOutputTypeId` (Map<dataTypeId, pipelineName>) in `pipelinesSlice` (or a
   small shared selector file if circular imports threaten — planner leaves the exact home to the
   executor, staying within existing slice/selector conventions). Both `SidebarBody` and `App.tsx`
   read it — one source of truth, mirrors the existing `selectPipelineOutputDataTypes` pattern.
   Alternative (build the map in each component) rejected: duplicates logic across surfaces.
2. **Fetch pipelines when the registry section is active.** Extend the `SidebarBody` `useEffect`
   with `section === "registry" && pipelines.status === "idle"` → `fetchPipelines()`, exactly
   mirroring the sources-section comment/pattern at `SidebarBody.tsx:57-61`. `App.tsx` (mobile)
   already fetches pipelines app-wide? — verify; if not, apply the same status-gated fetch where
   the sheet items are built (executor confirms; keep it status-gated to avoid refetch loops).
3. **Subtitle via data, not render-prop.** Add optional `subtitle?: string` to `SidebarItem` and
   `MobileNavSheetItem`; render under the name inside the existing row button/link. Chosen over a
   `renderSubtitle` prop: the subtitle is plain text on both surfaces, and the data shape keeps
   `App.tsx`'s sheet-item mapping trivial. `renderBadge` stays as-is (badge ≠ subtitle).
4. **Missing-pipeline fallback: render no subtitle.** If a DT's id has no entry in the map (e.g.
   pipelines not yet loaded, or a genuinely orphaned DT), omit the subtitle rather than showing
   "Pipeline: unknown" — the list is briefly name-only until pipelines load, which matches the
   pre-change render and avoids flicker of wrong text.
5. **Styling per DESIGN.md:** subtitle uses `--text-xs` (12px) with the secondary text color token
   and existing spacing tokens in `DashboardList.css` / `MobileNavSheet` CSS; no literal px
   font-sizes; reuse the block-layout of the name group (name and subtitle stacked). Truncate with
   the list's existing ellipsis behavior so long pipeline names don't wrap rows.
6. **Filter stays name-only.** `SidebarItemList`'s filter matches `item.name` today; subtitle text
   is NOT added to the filter predicate — filtering by pipeline name is out of scope (would change
   behavior of other sections sharing the component if done naively).

## Risks / Trade-offs

- [Pipelines list empty on cold registry visit] → status-gated fetch added; subtitle degrades to
  absent (Decision 4), no error states introduced.
- [`outputDataTypeId` optional in TS] → map-building skips pipelines without it; no non-null
  assertions.
- [Shared component touch (`SidebarItemList`, `MobileNavSheet`) could affect other sections] →
  `subtitle` is optional and only registry items set it; add a test asserting other sections'
  rows render unchanged (no subtitle element when unset).
- [Row height grows with subtitle] → desktop is mouse-driven; on the phone sheet verify tap
  targets remain ≥44px at 390×844 (they grow, not shrink — verify, don't assume).

## Migration Plan

Pure frontend additive change; no data migration, no rollout steps. Rollback = revert commit.

## Open Questions

(none — escalation resolved scope; remaining micro-decisions delegated to executor above)

## Planner Notes (self-approved)

- New capability spec `type-registry-provenance` rather than modifying an existing spec — no
  existing spec covers the registry list UX (checked `openspec/specs/`: `type-registry-content-fields`
  is field typing; `datatype-crud-api` is the API).
- Phone-sheet parity included per mobile-pwa handoff principle ("every section is a picker, do not
  fork the state"); verification therefore includes the 390×844 + ≥44px standard for the sheet.
- Ticket's AC1/AC2 explicitly not implemented (obsolete/satisfied) — recorded in proposal per
  human direction at escalation resolution.
