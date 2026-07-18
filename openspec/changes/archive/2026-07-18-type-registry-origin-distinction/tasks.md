# Tasks — type-registry-origin-distinction (HEL-270)

## 1. Frontend — provenance derivation

- [x] 1.1 Add memoized `selectPipelineNameByOutputTypeId` (Map<dataTypeId, pipelineName>) per design Decision 1; skip pipelines with absent `outputDataTypeId`
- [x] 1.2 Extend `SidebarBody` registry branch: status-gated `fetchPipelines()` when registry section active (mirror sources pattern at SidebarBody.tsx:57-61)
- [x] 1.3 Verify whether `App.tsx` already fetches pipelines for the mobile shell; if not, add the same status-gated fetch for the registry sheet (design Decision 2)

## 2. Frontend — subtitle rendering

- [x] 2.1 Add optional `subtitle?: string` to `SidebarItem`; render it under the name inside both the button and NavLink row variants in `SidebarItemList`; leave filter predicate name-only (design Decision 6)
- [x] 2.2 Style the desktop subtitle in `DashboardList.css` per DESIGN.md (--text-xs, secondary text token, existing spacing tokens, ellipsis truncation)
- [x] 2.3 Add optional `subtitle?: string` to `MobileNavSheetItem`; render in `MobileNavSheet` with matching token-based styling; keep item tap target ≥44px
- [x] 2.4 Wire subtitles: `SidebarBody` registry items and `App.tsx` registry sheet items map DT id → `Pipeline: <name>` via the selector; omit subtitle when unmapped (design Decision 4)

## 3. Tests

- [x] 3.1 Selector test: map built from pipelines with/without `outputDataTypeId`; empty pipelines → empty map
- [x] 3.2 `SidebarItemList` test: subtitle renders when set; absent element when unset (other-sections regression guard); filter does not match subtitle text
- [x] 3.3 Registry sidebar integration test (SidebarBody or existing registry test home): entry shows `Pipeline: <name>` when pipelines loaded; no subtitle when idle/unmatched; `fetchPipelines` dispatched once on cold registry visit
- [x] 3.4 `MobileNavSheet` test: subtitle renders when set, absent otherwise
- [x] 3.5 Run full gates: `npm run lint`, `npm test`, `npm run format:check`, `npm run build` (frontend); no backend changes expected — confirm `git status` touches frontend only
