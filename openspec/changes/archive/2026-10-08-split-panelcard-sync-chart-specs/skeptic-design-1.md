## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed: worktree HEAD 0de17a6304db38e5e138f3bde9424390af9cdc23 (= origin/main; change dir is untracked planning artifacts only).

### What I verified (with evidence)

**Split seams (items 1, D1-D3): sound. Every code-fact claim checked out.**
- `frontend/src/features/panels/ui/PanelCard.tsx` is 844 lines (`wc -l`). Every cited range matches the live file:
  `getPanelCardStyle` L52-74, body comment + `PanelCardBodyProps` L76-105, `controlResultCountText` L107-124,
  `EMPTY_CONTROLS` L126-130, `PanelCardBody` L132-372, `PanelCardProps`/`PanelCard` L374-844, inspect/cross-filter
  block L449-545 (from the `useOutputMeta` comment to `handleOpenInspectFromMenu`), header `panel-grid-card__top`
  div L604-727.
- Projected sizes stay under 400. PanelCardBody: 30+5+241 = 276 moved lines plus about 25 import lines, so about 300.
  Host: 75+76+58+117 = 326 retained lines, plus the hook call and header element (about 37), minus the imports that
  move out, so about 350. Header: 124 + props + signature, about 185. Hook: 97 + imports/return, about 130.
- Free identifiers in L604-727: I enumerated them by reading the block. They are exactly D1's 21 props plus the
  imports (`TextField`, `InlineError`, `IconButton`, `ActionsMenu`, `Spinner`, icons, `ICON_SIZE`,
  `isFullscreenEligible`), so zero-token-change JSX is feasible.
- The hook block's external reads are `panel`, `panelData.{paginationRows,rawRows,headers}`, `dispatch`, and `outputId`
  (via `useOutputMeta(outputId)` at L457). **Note:** `outputId` is not in D1's stated signature
  `usePanelCardInspect(panel, panelData)`. See CR3.
- `output` is used only inside L449-545 (L458-475, L513, L522), so not returning it is correct. `crossFilterMode` is
  used by the host at L826 and is returned.
- Hook order: `useAppDispatch()` inside the hook is `useContext`, which does not occupy a hook slot. The state/effect
  hook sequence of `PanelCard` is therefore unchanged, as D1 claims.
- Importers: `grid/DesktopPanelGrid.tsx` (`PanelCard`), `grid/MobilePanelStack.tsx:27` (`getPanelCardStyle,
  PanelCardBody`), `src/test/rawElementGuardHel440.test.tsx`, and exactly 14 `PanelCard*`/`PanelCardBody*` suites,
  6 of which import `PanelCardBody` from `./PanelCard`. This matches D2. The only `jest.mock` naming the module is
  `grid/DesktopPanelGrid.test.tsx:45`, and it stubs only `PanelCard`, so it is unaffected.
- `scripts/check-tokens.mjs:92-93` ALLOWLIST names `features/panels/ui/PanelCard.tsx` for both override vars.
  `getPanelCardStyle` stays there, so the entry stays true.
- Source-reading tests: only `PanelFullscreenOverlay.test.tsx:218` reads a source file, and it reads its own file.
  The split cannot affect it.

**Spec sync (item 2): code facts verified.**
- `resolvePanelChartType.ts` order: stored panel `chart.chartType` (truthy), else `readChartConfig(cfg).chartType` if
  in {bar,line,pie,scatter}, else `line`. Callers are `ChartOutputPanel.tsx:68` and `PanelCard.tsx:463`. The
  panel-appearance-settings delta matches. It keeps all 5 base scenarios and adds 2.
- `PanelDetailModal.tsx:540` `showChartSection={false}`. It is the only `<AppearanceEditor>` mount (grep across
  `frontend/src`, non-test), and `AppearanceEditor.tsx:116` is the only `<ChartAppearanceEditor>` mount. The
  chart-type-selector ADDED/REMOVED deltas are accurate to code.

**Inspect column order (item 3, D7): premise is false on the live code path.** This is the REFUTE.
- `hooks/usePanelData.ts:212-217`: `rows = paginationEntry.rows` and `headers = Object.keys(rows[0])`. `headers` is the
  first record's key order, not an Output-declared column order.
- `usePanelData.ts:262`: `paginationRows = rows`. `PanelCard.tsx:519-525` passes `panelData.headers` and
  `panelData.paginationRows` into `useCrossFilteredPanelData`, which passes `headers` through unchanged on every
  branch (`useCrossFilteredPanelData.ts:62-101`) and returns `records` as the same row objects (or a filtered subset).
- Both `PanelInspectView` mounts get these values: `PanelCard.tsx:766-767`, and `PanelFullscreenOverlay.tsx:257-258`
  via `inspectHeaders`/`inspectRecords`, which are the same values.
- So on the live aggregate path, `headers` order equals record-key order by construction. D7 ("build each grid row in
  `headers` order") is a no-op in production. The non-aggregate branch (`PanelInspectView.tsx:118`) also orders by
  `headers`, which is also record-key order. Today both branches already agree.
- The origin of item 3 is `archive/2026-10-07-dashboard-chart-overlay-coverage/skeptic-final-1.md:70`: "orders its
  columns by record key (amount, region), not by the Output's header order (region, amount)". The live (amount, region)
  order is consistent with jsonb key normalisation (equal length, bytewise `a` < `r`). The "(region, amount)" order
  can only be the Output's declared `schema` (`Output.schema: OutputSchemaField[]`, `pipelines/types/output.ts:46`),
  which no Inspect branch reads.
- D7's red-first test would pass a `headers` prop ordered differently from the records. Production cannot produce that
  input, so the test would be red-then-green evidence of a behaviour that never occurs live.
- Task 4.1's escalation trigger ("non-null headers") would not fire, because headers are non-null whenever rows load.
  It checks the wrong property.
- The chart-drilldown-inspect delta scenario ("Output's headers are ordered differently from the keys of its loaded
  row records … columns appear in the Output's header order, the same order the non-aggregated inspect grid uses")
  asserts behaviour the planned code would not deliver.

**Other checks**
- `PanelCard.test.tsx:597-606` (the false "genuinely SETTLED baseline" text) is present as D5 describes. The HEL-1215
  comment right after it already states the correct mechanism. D5 is sound.
- I found no TODO/TBD placeholders in proposal, design, or tasks.

### Verdict: REFUTE

### Change Requests

1. **D7 / task 4.1 / chart-drilldown-inspect delta: replace the premise check, and do not ship a no-op fix with a
   synthetic red test.** `headers` is `Object.keys(rows[0])` (`usePanelData.ts:214-217`) and the aggregate `records`
   are those same rows. "Order by `headers`" therefore cannot change anything live. Revise the plan so that, before
   any code, the change does one of the following:
   - (a) records evidence that the described inconsistency does not exist on the live path (both Inspect branches
     already use record-key order). Drop item 3's code change, drop the `chart-drilldown-inspect` delta, and report the
     not-reproducible-as-described finding with the cited lines; or
   - (b) if the intended behaviour is "Inspect columns follow the Output's declared `schema` order", raise an
     `ESCALATION`. That is a different and wider change: it touches both Inspect branches, needs `output.schema`
     threaded to `PanelInspectView`, and is no longer "aggregate-only cosmetic". It needs an owner ruling, not
     executor discretion.
   Whichever is chosen, task 4.1 must test the right property: whether live `headers` differ from record-key order.
   Non-null is the wrong check. Any red test must use inputs that production can produce.
2. **chart-type-selector Purpose is left stale.** `openspec/specs/chart-type-selector/spec.md:4` still says "The
   selector appears in the Appearance tab of the panel detail modal and persists the selected type…". Deltas do not
   rewrite Purpose, so after archive the spec's own summary would contradict its only remaining requirement. That
   fails AC "specs describe the code as it is". Add a task to update the Purpose line at sync/archive, with a check
   that the archived spec contains no "selector appears" text.
3. **D1 hook signature is incomplete for byte-identity.** L457 reads `outputId`, which is not in
   `usePanelCardInspect(panel, panelData)`. Either add `outputId` as a parameter (preferred; the host already computes
   it at L430) or state that the hook re-derives it. Re-deriving would add a new line inside the moved block, so D3
   must list it as permitted new code. Make the signature exact so D3's "moved verbatim" proof is well defined.
4. **Task 2.1 (D4) has no completeness signal.** D4 lists only "e.g." sites. The live grep of out-of-file references
   that will point at the wrong module after the move also includes:
   - `utils/chartClickSelection.ts:191` ("see `PanelCard.tsx`", the inspect filtering, which moves to the hook)
   - `PanelInspectView.tsx:79-80` (`PanelCard.handleDataPointSelect`, which moves to the hook)
   - `hooks/usePanelSortFilter.ts:28` (`PanelCard.tsx`'s load-more, which is in `PanelCardBody`)
   - `utils/crossFilterRows.ts:4`
   - in-block "above"/"below" pointers (e.g. L456, L479, L487)
   Make 2.1's acceptance signal an enumerated list derived from `grep -rn "PanelCard\.tsx\|PanelCard\.\|PanelCard\`'s"`
   over `frontend/src`, each site marked fixed or still-correct. Historical "fixed in `PanelCard.tsx`" provenance notes
   may stay as they are, but say so explicitly.

### Non-blocking notes
- D3 byte-identity: the header block moves from 6-space to 4-space indent. Pre-commit Prettier could re-wrap a line,
  in which case a leading-whitespace-only strip would show a spurious diff. Compare with all whitespace removed
  (e.g. `tr -d '[:space:]'`), or accept a Prettier-only re-wrap as long as the token sequence is identical.
- `openspec/specs/chart-type-config-editor/spec.md:8,22` also references "the chart type selector" in the Appearance
  section. That spec is outside this ticket's named two, so it is a follow-up candidate, not scope here.
- Even under option (a), D7's "append keys absent from headers" logic only matters for heterogeneous rows, and
  `DataGrid.deriveColumns` (`shared/ui/DataGrid.tsx:399`, union of keys over the first 50 rows) already handles that.
  Integer-like column names are always ordered first by JS object semantics on both branches. That is relevant only
  if option (b) is taken, and then explicit `columns` would be the robust mechanism rather than key insertion order.
