## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed: worktree HEAD 0de17a6304db38e5e138f3bde9424390af9cdc23 (= origin/main after a fresh fetch; the change dir is untracked planning artifacts only). Every claim below was re-derived from the live tree. I did not carry it over from skeptic-design-1.md.

### What I verified (with evidence)

**Round-1 CRs are resolved:**
- CR1 (item 3): D7 is now investigation-only, the `chart-drilldown-inspect` delta is gone (`specs/` holds only `chart-type-selector` and `panel-appearance-settings`), and C3 and tasks 4.2 say no code change. Re-derived on the live path:
  - `hooks/usePanelData.ts:212-217`: `rows = paginationEntry.rows` and `headers = Object.keys(rows[0])`.
  - `useCrossFilteredPanelData.ts:61-101` passes `headers` through unchanged on every branch.
  - In `PanelInspectView.tsx:108-118`, the aggregate branch builds rows from `Object.entries(row)` over `filterRecordsForAggregateSelection(...)`. That function (`chartClickSelection.ts:153`) is a plain `records.filter`, so it returns the same objects with the same key order. The non-aggregate branch maps in `headers` order, which is also record-key order.
  - Conclusion: both branches already agree, and "order by headers" would be a no-op. Dropping the code change is justified.
- CR2 (Purpose): `openspec/specs/chart-type-selector/spec.md:4` still says "The selector appears in the Appearance tab…". D6 plus task 4.1 now edit it directly, with a `grep -c "selector appears"` = 0 check. That is a real signal.
- CR3 (hook signature): the signature is now `usePanelCardInspect(panel, outputId, panelData)`. Reads inside L449-545 are:
  - `outputId` (L457)
  - `panel` (L463, 474, 513, 519, 530, 533, 543-544)
  - `panelData.{paginationRows,rawRows,headers}` (L470, 474, 520-524)
  - `dispatch` (L530, 543), from the hook's own `useAppDispatch()` per D1
  - module imports

  That set is complete. The 10 returned names cover every downstream host use:
  - `chartInspectConfig`: header, L758, L768, L825
  - `crossFilterMode`: L826
  - `crossFiltered*`: L765-767, L814-815, L822
  - `isInspectOpen` and the three inspect handlers: L762-764
  - `handleDataPointSelect`: L749
  - `handleOpenInspectFromMenu`: header

  `output` is not used outside L449-545, so it is correctly not returned.
- CR4 (completeness signal): D4 now requires the grep, plus the in-block above/below pointers, plus a fixed/still-correct entry per hit. I ran the exact grep and got about 37 hits across `frontend/src`. D4 also names `PanelInspectView.tsx:79` by hand. That matters because the regex misses it: the text there is "`PanelCard.`" followed by a line break, and `PanelCard\.[a-zA-Z]` needs a letter after the dot.

**Code facts in D1/D2:**
- The file is 844 lines. Every cited range matches the live file: L52-74, L76-105, L107-124, L126-130, L132-372, L374-844, L449-545, L604-727.
- Free identifiers in the header block L604-727 are exactly D1's 21 props plus imports (`TextField`, `InlineError`, `IconButton`, `ActionsMenu`, `Spinner`, `RotateCw`, `Maximize2`, `GripVertical`, `ICON_SIZE`, `isFullscreenEligible`).
- Hook order: the block moves as one contiguous unit to the same position, between the fullscreen `useCallback`s and `useDataInvalid`. `useAppDispatch` resolves to `useContext`, which takes no state slot. A custom hook adds no component, so render counts are unchanged.
- Projected sizes, all under 400:
  - host: about 345 lines (75 + 58 + 117 retained + `getPanelCardStyle` + hook call + header element + imports)
  - `PanelCardBody`: about 300
  - header: about 185
  - hook: about 130
- Importers: `DesktopPanelGrid.tsx`, `MobilePanelStack.tsx:27`, `rawElementGuardHel440.test.tsx`, and 14 `PanelCard*`/`PanelCardBody*` suites. Exactly 6 of the suites import `PanelCardBody` from `./PanelCard`. The only `jest.mock` of the module is `DesktopPanelGrid.test.tsx:45`, which stubs `PanelCard` (still exported from `PanelCard.tsx`). No `requireActual` or `spyOn` targets it.
- `PanelCardBodyProps`, `controlResultCountText` and `EMPTY_CONTROLS` are not referenced outside `PanelCard.tsx`. The same-named `EMPTY_CONTROLS` in `PanelFullscreenOverlay` and `PanelDetailModal` are separate local consts.
- `scripts/check-tokens.mjs:91-92`: the ALLOWLIST names `PanelCard.tsx` as the setter of the override vars. `getPanelCardStyle` stays there, so the entry stays true.
- There is no circular import. `PanelCardBody` does not use `getPanelCardStyle`, and nothing that moves imports back into `PanelCard`.

**Spec deltas and Purpose against the code:**
- `resolvePanelChartType.ts` order: stored `chart.chartType` (truthy), else the Output's `readChartConfig(cfg).chartType` if it is in {bar, line, pie, scatter}, else `line`. Non-test callers are `ChartOutputPanel.tsx:68` and `PanelCard.tsx:463`. `ChartRenderer`'s only dashboard importer is `ChartOutputPanel`.
- The `panel-appearance-settings` MODIFIED requirement keeps all 5 base scenarios verbatim, adds 2 matching scenarios, and its header matches the base exactly (base spec L110).
- `PanelDetailModal.tsx:540` `showChartSection={false}` is the only `<AppearanceEditor>` mount in non-test code. `AppearanceEditor.tsx:116` gates the chart section. The five REMOVED requirement names match base headers L6, 17, 24, 32 and 39 exactly. The ADDED requirement's "stored panel chartType still takes precedence" matches the resolver.
- `openspec validate split-panelcard-sync-chart-specs --strict` printed "Change 'split-panelcard-sync-chart-specs' is valid".

**D5:** `PanelCard.test.tsx:594-602` holds the false "genuinely SETTLED baseline" text. The HEL-1215 comment at L607-614 already states the correct mechanism. The plan is comment-only and the flush code stays, which is sound.

**Placeholders:** none in proposal, design or tasks.

### Verdict: CONFIRM

### Non-blocking notes (orchestrator: pass 1-3 to the executor; they prevent avoidable gate friction)
1. **Task 1.2 vs C6, the `export` token.** `controlResultCountText` is a non-exported `function` at base L111. Writing `export function …` inside the moved range makes the whitespace-stripped comparison non-empty (`exportfunction…` vs `function…`), which C6 calls a defect. Use either:
   - a separate `export { controlResultCountText };` line, which keeps the range byte-identical and fits D3's "export lines are new code"; or
   - an exemption, recorded in the transcript, for the single `export` keyword on L111.
2. **D3's new-code list omits the hook's `const dispatch = useAppDispatch();`.** D1 declares it, though. Put it before the moved L449-545 range so the contiguous-range comparison stays well defined, and list it in the D3 transcript as permitted new code.
3. **D4 hits in test files vs C2.** `PanelCard.crossFilter.test.tsx:162` ("`PanelCard.tsx`'s `filteredPaginationRows`") was already stale before this change: that identifier lives in `PanelContent.tsx:246`. C2 only allows import edits (plus D5) in PanelCard suites. Record it as "pre-existing, out of scope (C2)" rather than editing it, or flag it for a follow-up. The same applies to `MobilePanelStack.staleFetchSequencing.test.tsx:8`, which should be marked historical. `PanelCard.test.tsx:597` ("that hook's `PanelCard.tsx` doc comment") falls inside the D5 range, so Commit 3 should fix its pointer to `PanelCardBody.tsx`.
4. **The "both themes visually unchanged" AC has no task.** Add a brief task 5.3: before/after screenshots of a desktop card in light and dark, header in normal, title-edit and delete-confirm states. Otherwise this rests entirely on the final gate. The DOM is identical by construction, so the risk is low.
5. **`openspec/specs/raw-element-guard/spec.md:11` names `PanelCard.tsx` as rendering the "Panel title" TextField.** It is outside D4's `frontend/src` grep. It stays transitively true, because `PanelCard` renders `PanelCardHeader`, and `rawElementGuardHel440.test.tsx` renders `PanelCard`, so it keeps passing unchanged. Record it in the D4 list as still-correct (or a follow-up). Do not edit it silently.
6. `chart-type-config-editor/spec.md` "chart type selector" mentions remain, correctly listed as a follow-up in Planner Notes.
