## Context

See proposal.md - Why. `frontend/src/features/panels/ui/PanelCard.tsx` (844 lines at origin/main 0de17a630) holds:
`getPanelCardStyle` (L52-74), `PanelCardBodyProps` + `controlResultCountText` + `EMPTY_CONTROLS` + `PanelCardBody`
(L76-372), and the desktop host `PanelCardProps` + `PanelCard` (L374-844), whose body contains the Output/inspect/
cross-filtered-rows wiring (L449-545) and a 124-line header JSX block (L604-727). Precedent: HEL-1180 (ChartPanel split).
Importers: `grid/DesktopPanelGrid.tsx` (`PanelCard`), `grid/MobilePanelStack.tsx` (`getPanelCardStyle`,
`PanelCardBody`), `test/rawElementGuardHel440.test.tsx`, and 14 `PanelCard*.test.tsx`/`PanelCardBody*.test.tsx` suites.
`scripts/check-tokens.mjs` ALLOWLIST names `PanelCard.tsx` as the runtime setter of `--panel-surface-override`/
`--panel-text-override` (documentation value, not checked, but it must stay true).

## Goals / Non-Goals

**Goals:** every resulting module < 400 lines; moved code byte-identical modulo leading indentation; hook call order
inside `PanelCard` and `PanelCardBody` unchanged; DOM output unchanged; specs match code.

**Non-Goals:** fixing anything found (follow-ups only — HEL-1380's redundant `setIsLoading(true)` render is queued
after this ticket and MUST NOT be touched); splitting `PanelCard.test.tsx`; removing the dead `ChartAppearanceEditor`
chart-type section; trimming verbose comments inside moved code.

## Decisions

**D1 — Module layout** (all in `frontend/src/features/panels/ui/` unless noted):
- `PanelCard.tsx` — keeps `getPanelCardStyle` (kept here so the check-tokens ALLOWLIST entry and MobilePanelStack's
  import stay true without edits), `PanelCardProps`, and `PanelCard` (the drag/inspect/fullscreen host).
- `PanelCardBody.tsx` — L76-105 comment + `PanelCardBodyProps`, L126-130 `EMPTY_CONTROLS`, L132-372 `PanelCardBody`,
  verbatim. Still `React.memo`, still a named export `PanelCardBody`.
- `controlResultCountText.ts` — L107-124 verbatim (exported). This is HEL-1201's announcement seam, limited to its pure
  part. Rejected: extracting the stateful announcement assembly (`refreshAnnouncement` state, `handleFanoutRefresh`,
  `useCrossFilterAnnouncement`, `resultAnnouncementText`) into a hook — `handleLoadMore`'s `useCallback` and the
  `activeCrossFilter` selector sit between those calls, so a hook would reorder `PanelCardBody`'s hook sequence and
  the move would no longer be provably mechanical.
- `../hooks/usePanelCardInspect.ts` — L449-545 verbatim as the body of
  `usePanelCardInspect(panel, outputId, panelData)` (`outputId` is read at L457; the host already computes it at L430),
  returning `{ chartInspectConfig, crossFilterMode, crossFilteredRawRows,
  crossFilteredHeaders, crossFilteredRecords, isInspectOpen, handleDataPointSelect, handleCloseInspect,
  handleClearInspect, handleOpenInspectFromMenu }` (the HEL-1183/HEL-1201 inspect + cross-filter-derivation seam).
  `PanelCard` calls it at exactly the position those lines occupied (after the fullscreen state, before
  `useDataInvalid`), so the hook sequence is unchanged. The hook obtains `dispatch` via its own `useAppDispatch()`
  (a context read only — no state, no effect, cannot change render counts). `output` is not returned unless the host
  still needs it (it does not today).
- `PanelCardHeader.tsx` — L604-727 (the `panel-grid-card__top` div) verbatim as the return of a plain (non-memo)
  function component `PanelCardHeader`. Non-memo on purpose: the block re-rendered on every `PanelCard` render
  before, and must not start skipping renders now. Its props are named EXACTLY as the identifiers the JSX already uses
  (`panel`, `isEditingTitle`, `editingTitle`, `editingTitleError`, `isConfirmingDelete`, `outputId`, `refresh`,
  `isRefreshing`, `isPending`, `chartInspectConfig`, `onCancelDelete`, `handleConfirmDelete`,
  `handleOpenFullscreen`, `handleRename`, `handleDetail`, `handleDuplicate`, `handleOpenInspectFromMenu`,
  `handleRequestDelete`, `handleTitleInputChange`, `handleTitleKeyDown`, `handleTitleBlur`) so the JSX is moved with
  zero token changes. Every `useCallback` stays in `PanelCard`, in its current order. Rejected: renaming to `on*`
  props — it breaks byte-identity for no behavioural gain.

**D2 — Importers.** Update import paths only: tests importing `PanelCardBody` from `./PanelCard` switch to
`./PanelCardBody`; `MobilePanelStack` imports `PanelCardBody` from `../PanelCardBody` and keeps `getPanelCardStyle`
from `../PanelCard`. No re-export from `PanelCard.tsx` (rejected: a pass-through barrel hides the new boundary).
`jest.mock` paths in existing suites need no change (mocks resolve by module, and every moved file imports the same
modules). No test assertion, fixture, or setup changes.

**D3 — Byte-identity proof.** Commit 1 is the pure move. The executor records, as persisted evidence, a whitespace-
insensitive comparison for each moved block: the base range from `git show <base>:…/PanelCard.tsx | sed -n 'a,bp'` vs
the corresponding range in the new file, both with ALL whitespace removed (`tr -d '[:space:]'`, so a Prettier re-wrap
from the indent change cannot show a spurious diff) — each comparison MUST be identical. Only import/export
lines, the new function/hook signatures, the hook's `return {…}`, and the host's call sites are new code.

**D4 — Comment-reference touch-ups (Commit 2, comments only).** Completeness comes from a grep, not examples: run
`grep -rnE "PanelCard\.tsx|PanelCard\.[a-zA-Z]|PanelCard\`'s|PanelCard's" frontend/src` (plus a read of every
"above"/"below" pointer inside the moved blocks, e.g. base L456/L479/L487/L650-656/L728-734) and record each hit in the
executor report as `fixed` or `still-correct`. Known sites include `PanelDetailModal.tsx` ~L515, `TableRenderer.tsx`
~L832, `utils/chartClickSelection.ts` ~L191, `PanelInspectView.tsx` ~L79-80, `hooks/usePanelSortFilter.ts` ~L28,
`utils/crossFilterRows.ts` ~L4, and `useOutputMeta`'s doc comment. Historical provenance notes ("fixed in
`PanelCard.tsx` by HEL-N") stay as written and are marked `still-correct (historical)`. The diff MUST touch comment text
only.

**D5 — HEL-1215 test comment (Commit 3, comment only).** Rewrite `PanelCard.test.tsx` ~L597-606 so it no longer claims
the two-tick flush yields a "genuinely SETTLED baseline": it only guarantees the `setIsLoading(true)` microtask has run;
the identical-props `rerender` in act (HEL-1215) is what absorbs the deferred render. The flush code itself stays.

**D6 — Spec sync** (deltas in this change): see specs/. Deltas cannot rewrite a Purpose, so the executor also edits
`openspec/specs/chart-type-selector/spec.md`'s `## Purpose` paragraph directly to say chart type is chosen on the Output
and the panel detail modal shows no selector (verify: no "selector appears" text remains). Code facts relied on: `resolvePanelChartType.ts` (panel →
Output `config.chartType` if allowed → `line`); `PanelDetailModal.tsx` ~L540 mounts `AppearanceEditor` with
`showChartSection={false}`, the only `ChartAppearanceEditor` mount.

**D7 — Inspect column order: investigation only, no code change.** Design gate (skeptic-design-1 CR1) showed
`usePanelData.ts` ~L214-217 builds `headers = Object.keys(rows[0])` and the aggregate `records` are those same rows
(through `useCrossFilteredPanelData` to both Inspect mounts), so ordering by `headers` changes nothing live, and the
non-aggregate branch already uses that same order. The "(region, amount)" order in HEL-1351's skeptic note can only be
the Output's declared `schema` order, which no Inspect branch reads. Following `schema` order on both branches is a
wider behaviour change than this ticket's cosmetic item and needs an owner ruling — surfaced as an owner question in
the run report, not decided here. The executor records the evidence (cited lines plus a live-path check: in the
running app, an aggregated chart's Inspect column order vs a non-aggregated (scatter) Inspect of the same Output) in
its report. No `PanelInspectView.tsx` change and no `chart-drilldown-inspect` delta.

## Risks / Trade-offs

- [Render-count suites break from an added component layer] → `PanelCardHeader` is a sibling of the memoised body, so
  `PanelCardBody`'s memo comparison is unchanged; render-count assertions must pass untouched.
- [Concurrent HEL-1181 touches chart test files] → this change moves no chart files; on rebase conflict in a chart test,
  stop and report via the orchestrator.
- [Hidden circular import] → `PanelCard` → `PanelCardBody`/`PanelCardHeader`/hook; nothing imports back into
  `PanelCard` except `MobilePanelStack` for `getPanelCardStyle`, which is not imported by any moved module.

## Planner Notes

- Self-approved: module names/locations above; keeping `getPanelCardStyle` in place; leaving `PanelCard.test.tsx` (801
  lines) whole — not in this ticket's AC, listed as a follow-up candidate.
- Item 3 is not implemented (D7): shipping "order by headers" would be a no-op with a synthetic red test.
- `chart-type-config-editor/spec.md` ~L8/L22 also mention a chart type selector — outside the two named specs; follow-up.
