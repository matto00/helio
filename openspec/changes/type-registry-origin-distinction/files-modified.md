# Files modified — type-registry-origin-distinction (HEL-270)

## Source

- `frontend/src/features/pipelines/state/pipelinesSlice.ts` — added memoized `selectPipelineNameByOutputTypeId` selector (Map<dataTypeId, pipelineName>), skipping pipelines with absent `outputDataTypeId`.
- `frontend/src/shared/chrome/SidebarItemList.tsx` — added optional `subtitle?` to `SidebarItem`; extracted a shared `renderItemText` helper that stacks the name-group over the subtitle in both button and NavLink variants; filter predicate left name-only; added `dashboard-list__button--stacked` modifier when a subtitle is present.
- `frontend/src/features/dashboards/ui/DashboardList.css` — added `.dashboard-list__text` (vertical stack), `.dashboard-list__button--stacked` (min-height growth), and `.dashboard-list__subtitle` (`--text-xs`, `--app-text-muted`, ellipsis) styles.
- `frontend/src/shared/chrome/MobileNavSheet.tsx` — added optional `subtitle?` to `MobileNavSheetItem`; render it under the name inside a `mobile-nav-sheet__item-text` wrapper.
- `frontend/src/shared/chrome/MobileNavSheet.css` — added `.mobile-nav-sheet__item-text` wrapper and `.mobile-nav-sheet__item-subtitle` styles; row min-height (≥44px) preserved so the subtitle grows the tap target.
- `frontend/src/shared/chrome/SidebarBody.tsx` — registry section now status-gated-fetches pipelines when active, and maps each DataType id → `Pipeline: <name>` via the selector (omitting the subtitle when unmapped).
- `frontend/src/app/App.tsx` — mobile registry sheet items carry the same `Pipeline: <name>` subtitle; added a status-gated `fetchPipelines` effect for the registry section so the phone sheet resolves provenance independently of the (CSS-hidden) desktop sidebar.

## Tests

- `frontend/src/features/pipelines/state/pipelinesSlice.test.ts` — selector tests (with/without `outputDataTypeId`, empty → empty map).
- `frontend/src/shared/chrome/SidebarItemList.test.tsx` — subtitle renders when set; absent element when unset; filter matches name only (subtitle-only query → no-matches).
- `frontend/src/shared/chrome/SidebarBody.test.tsx` — registry provenance integration: subtitle shown for a loaded producing pipeline; no subtitle when unmatched; `fetchPipelines` dispatched once on cold registry visit; not refetched when already loaded. Test harness gained a mocked `pipelineService.getPipelines` and pipelines preloaded-state support.
- `frontend/src/shared/chrome/MobileNavSheet.test.tsx` — subtitle renders when set, absent otherwise.

## Notes

- No backend, schema, or API changes (frontend-only per escalation scope).
- Ticket AC1 (source-vs-pipeline distinction) and AC2 (delete affordance) intentionally not implemented — obsolete/satisfied per proposal.
