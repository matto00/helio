## Standing Constraints

- [C1] Behaviour-preserving: every moved test keeps its exact `describe`/`it` name and body; the split files' union holds exactly the base run's 36 test names (26 `it` + three `it.each` tables of 4/4/2 rows), sorted diff empty.
- [C2] Test runs: foreground only, `nice -n 19`, jest `--maxWorkers=3`, Bash timeout 600000; whole-suite runs split into foreground shards; report exactly what ran.

## 1. Frontend - dead chart-appearance path

- [x] 1.1 Delete `editors/ChartAppearanceEditor.tsx`; drop `showChartSection`/`chartAppearance`/`setChartAppearance` from `AppearanceEditor.tsx` and its call site in `PanelDetailModal.tsx`; verify typecheck passes
- [x] 1.2 Drop `chartAppearance` state, reset line and return fields from `usePanelDetailEditState.ts`; delete `panelDetailChartState.ts`; verify `grep -rn "buildInitialChart\|showChartSection\|ChartAppearanceEditor\|setChartAppearance" frontend/src` is empty
- [x] 1.3 Remove each CSS rule only the deleted editor used (`git grep` each class repo-wide first, not `grep --include` which is ugrep here; keep CSS-lock-pinned or still-used classes); record the per-class grep in files-modified.md, including CSS-lock-pinned classes kept with no remaining renderer (e.g. `chart-label`, `color-swatches`)
- [x] 1.4 In `PanelDetailModal.chartTypeDefault.test.tsx` delete tests 1-2 and the capture wrapper (design D3); keep test 3 byte-identical; verify the file runs with 1 passing test

## 2. Frontend - stale pointers

- [x] 2.1 `PanelCard.crossFilter.test.tsx:162` comment -> `OutputPanelContent.tsx`'s `filteredPaginationRows`
- [x] 2.2 `usePanelSortFilter.ts:79` comment -> `PanelCardBody`'s `useOutputMeta(outputId)`
- [x] 2.3 `ChartDisplayFields.tsx` header comment -> the Output editor's chart type selector; drop false `BindingEditor`/Appearance-section claims
- [x] 2.4 Sweep `frontend/src` for other comments naming `PanelCard`/`PanelCard.tsx` as the home of code now in `PanelCardBody`/`PanelCardHeader`/`usePanelCardInspect`/`OutputPanelContent`; fix same-class hits, list the grep and its result in files-modified.md

## 3. Frontend - split PanelCard.test.tsx

- [x] 3.1 Before editing, record on the base commit `PanelCard.test.tsx`'s verbose jest output (36 passing tests, including the three `it.each` tables' expanded names) as evidence
- [x] 3.2 Split into `PanelCardHeader.test.tsx` / `PanelCardHeader.refreshFullscreen.test.tsx` / `PanelCardBody.test.tsx` (design D1 mapping, executor-confirmed); preamble copied per file, a mock dropped only when unreachable from that file
- [x] 3.3 Verify each new file passes and the union of verbose test names equals 3.1's 36 names exactly (sorted diff empty); no file over 500 lines

## 4. Spec

- [x] 4.1 `specs/chart-type-config-editor/spec.md` delta applied at archive; verify `openspec validate panelcard-split-leftovers --type change` exits 0

## 5. Tests and gates

- [x] 5.1 Grep proof for items 2 and 4: `grep -n "Appearance section's chart type selector" openspec/specs/chart-type-config-editor/spec.md` empty after archive (in-change delta checked now), `grep -n "PanelCard.tsx\`'s \`filteredPaginationRows\|PanelCard\`'s own pre-existing" frontend/src -r` empty
- [x] 5.2 `npm run lint`, `npm run typecheck`, `npm run format:check` green
- [x] 5.3 Jest for `frontend/src/features/panels` and `frontend/src/theme` in foreground shards (3 workers, nice 19), all green; report each shard's command and counts
