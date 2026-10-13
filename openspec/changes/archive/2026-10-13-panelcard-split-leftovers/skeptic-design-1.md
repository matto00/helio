## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed at HEAD 290ab8a22c7f0adc16b4c0d070748657067081fe (worktree; change dir untracked, no code changes yet).

### What I verified (with evidence)

- **Spawn guard:** `assert-cwd.sh` -> `READY ambient=/home/matt/Development/helio branch=task/panelcard-split-leftovers/HEL-1395`.
- **D2: the chart-appearance path is dead (CONFIRMED).**
  - `<AppearanceEditor` has exactly one render site repo-wide: `PanelDetailModal.tsx:270`, passing `showChartSection={false}` (:281). `AppearanceEditor.tsx:116` renders `ChartAppearanceEditor` only under `showChartSection &&`. No e2e or other render.
  - `usePanelDetailEditState.ts`: `chartAppearance` is set at :38 and :86, returned at :125-126; it is NOT in `appearanceDirty` (:73-77). The `handleEditSubmit` save path (`PanelDetailModal.tsx:130-143`) builds `appearancePayload` from `background`/`color`/`transparency` and `title` only. It never reads `chartAppearance`.
  - `buildInitialChart` (`panelDetailChartState.ts`) is used only by `usePanelDetailEditState.ts` (:15, :32, :86).
  - No live spec, doc, DESIGN.md or MISTAKES.md references these symbols (grep of openspec/specs, docs, e2e: 0 hits; archive hits only).
  - So the wider removal is behaviour-preserving, and the ticket's own instruction forces it: removing the prop orphans the rest. Sound.
- **D3: retiring the two HEL-1378 tests (sound, no escalation needed).** Tests 1-2 of `PanelDetailModal.chartTypeDefault.test.tsx` assert only `props.chartAppearance` captured through a mocked `AppearanceEditor`. That prop and its producer stop existing. Test 3 (title-only save writes no `appearance.chart`/`chartType`) exercises the live save path and stays. The AC is "tests unchanged except moves and imports", and the same ticket orders the deletion of the code those tests cover, while item 3 explicitly asks to "check HEL-1378 for overlap". So removing tests of removed code is the natural reading, not a product call. It does not need to be escalated. The design records it as the one exception.
- **Spec delta (accurate).** `OutputKindFields.tsx:126-136` renders the `Chart type` `Select`, and :176 renders `ChartDisplayFields` with `isBound={fieldOptions.length > 0}`. `ChartDisplayFields` renders a "Display" heading (:106). Its only non-test importer is `OutputKindFields.tsx`. `chart-type-selector/spec.md:4,8` already says the modal shows no selector. `npx openspec validate panelcard-split-leftovers --type change` -> `Change 'panelcard-split-leftovers' is valid`. Deferring requirements 2-3 (dirty/save, mobile) is acceptable: the ticket's item 2 names only ~:8/~:22, and the deferral is recorded as a non-goal and follow-up.
- **Stale pointers (CONFIRMED, locations as the design says).** `PanelCard.crossFilter.test.tsx:162` names `PanelCard.tsx`'s `filteredPaginationRows`; the real home is `OutputPanelContent.tsx:142`. `usePanelSortFilter.ts:79` names `PanelCard`'s `useOutputMeta`; the real owner is `PanelCardBody.tsx:101`. `ChartDisplayFields.tsx:1-8` claims ownership by `BindingEditor` (removed per `theme.css:394`) and an "Appearance section" selector. All are stale.
- **D1 split mapping: test count and file size are both wrong (see Change Requests).**
  - Fresh run: `nice -n 19 npx jest --maxWorkers=3 --verbose src/features/panels/ui/PanelCard.test.tsx` -> `Tests: 36 passed, 36 total`.
  - Static grep: 26 plain `it(` calls plus 3 `it.each` blocks at :458 (4 rows), :700 (4 rows) and :718 (2 rows) = 36 runtime tests.
  - D1's per-block counts add up to 26 and leave out all three `it.each` blocks: "HEL-579 refresh placement (1)" is really 1 + 4, and "HEL-584 fullscreen (4)" is really 4 + 4 + 2.
  - File size: the blocks D1 sends to `PanelCardHeader.test.tsx` are lines 166-269, 335-574 and 662-807, about 490 lines. Add the 114-line shared preamble (D1 keeps every mock a test can reach, and all of them can be reached through `<PanelCard>`) and the file comes to about 600 lines. Task 3.3 requires "no file over 500 lines".

### Verdict: REFUTE

### Change Requests

1. **Fix the test inventory in design D1, tasks C1/3.1/3.3 and proposal "What Changes".** The file has 26 `it` calls plus 3 `it.each` tables, and runs 36 tests (fresh `jest --verbose`: 36 passed). Add the three `it.each` blocks to the D1 mapping:
   - `renders no Refresh control for a %s panel` (4 rows) at :458
   - `renders a Fullscreen control for a %s panel` (4 rows) at :700
   - `renders no Fullscreen control for a %s panel` (2 rows) at :718

   Restate the acceptance signal as: the union of the split files' runtime test names (from `--verbose`/`--json`) equals the base run's 36 names, sorted diff empty, and the static `it(`/`it.each(` titles are unchanged. As written, task 3.1 ("26 names, all passing") contradicts the base run's real output. And a check of the 26 static names would not catch a dropped `it.each` table, which is exactly the "test silently lost in a split" risk the design says it guards against.
2. **Resolve the conflict between D1 and task 3.3 (500-line cap).** The D1 header mapping produces a file of about 600 lines. Either:
   - split the header group into two files following the existing `<Module>.<topic>.test.tsx` convention (for example a delete/drag/duplicate file and a refresh/fullscreen file), or
   - drop or justify the cap.

   Name the resulting files in D1 so the executor does not have to choose between the design and the task.

### Non-blocking notes

- `panel-detail-modal__chart-label` and `panel-detail-modal__color-swatches` are pinned by `PanelDetailModal.css.test.ts`. Under D2's keep-if-pinned rule, those rules survive even if nothing renders them after this change. Note in files-modified.md whether any surviving pinned class is now unrendered, so it can be followed up rather than silently kept.
- In this environment `grep` resolves to `ugrep`, which ignored `--include=*.tsx`. Task 1.3's per-class grep should use `git grep` or `rg` so the evidence it records is trustworthy.
- After tests 1-2 are deleted, test 3's describe title "PanelDetailModal initial chart state (HEL-1378)" no longer describes what it guards. Keep it byte-identical as D3 says; this is noted only so a reviewer does not flag it.
