## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed at HEAD 290ab8a22c7f0adc16b4c0d070748657067081fe. The worktree has no code changes; the only untracked path is the change dir.

### What I verified (with evidence)

- **Spawn guard:** `assert-cwd.sh` returned `READY ambient=/home/matt/Development/helio branch=task/panelcard-split-leftovers/HEL-1395`.

- **Round-1 CR1 (test inventory) is resolved.**
  - I grepped `PanelCard.test.tsx` myself. It is 807 lines with 9 `describe` blocks, 26 plain `it(` calls, and three `it.each` tables:
    - :458, 4 rows (markdown, image, divider, form)
    - :700, 4 rows (output, text, markdown, image)
    - :718, 2 rows (divider, form)
  - That makes 36 runtime tests. Design D1, proposal, tasks C1/3.1/3.3 and the workflow-state constraint C1 all state 36 now.
  - The D1 per-file counts match the per-block counts:
    - Header file, 10: F-128 has 6, F-099 has 1, HEL-706 has 3.
    - refreshFullscreen file, 18: refresh placement has 1+4, refresh activation has 3, fullscreen has 4+4+2.
    - Body file, 8: badge has 4, retry has 2, stability has 2.
  - Task 3.3's acceptance signal is "the union of runtime verbose names equals the base run's 36, sorted diff empty". That signal would catch a dropped `it.each` table.

- **Round-1 CR2 (500-line cap) is resolved.**
  - The header group is now split into `PanelCardHeader.test.tsx` and `PanelCardHeader.refreshFullscreen.test.tsx`.
  - Size estimates from the source ranges plus the 114-line preamble: about 311, about 414 and about 310 lines. All are under 500.
  - None of the target filenames exist yet. Existing siblings follow the `<Module>.<topic>.test.tsx` convention.

- **Split safety (my own check of mock state between describe blocks).**
  - There are no `jest.mock` calls below the preamble, so no hoisted mock is tied to one block.
  - The persistent `mockUsePanelData` mutations are:
    - :436/:486 `mockReturnValue`
    - :586/:788 `mockImplementation(actualUsePanelData)`
    - :593/:805 `mockReset`
  - Every block that later relies on a return value sets its own in `beforeEach`. Fullscreen sets one at :674, after the stability block's `afterAll` reset.
  - The body file keeps badge → retry → stability in source order.
  - So no block in the planned split inherits state that differs from the original in a way that matters. The design's verbose-name diff plus all-pass check is adequate.

- **D2 (the dead chart-appearance path) is re-confirmed.**
  - `git grep` finds `showChartSection`, `ChartAppearanceEditor`, `panelDetailChartState` and `setChartAppearance` only in the 4 files D2 names, plus `PanelDetailModal.tsx:281`, which passes `false`. No e2e, docs or other references exist outside the archive.
  - `handleEditSubmit` (`PanelDetailModal.tsx:124-143`) builds the appearance payload from `background`/`color`/`transparency` and `title` only. It never reads `chartAppearance`.
  - The `ChartAppearance` type and `defaultChartAppearance` stay in use elsewhere (renderers, the Output editor). The plan does not touch them. Correct.

- **D3 (the HEL-1378 tests) is sound.**
  - Tests 1-2 assert only `props.chartAppearance`, captured through the `AppearanceEditor` mock wrapper.
  - Test 3 drives the real save path and does not depend on that wrapper. Keeping it byte-identical and removing the wrapper plus the unused `defaultChartAppearance`/`ChartAppearance` imports is coherent.

- **Pointer targets are confirmed.**
  - `filteredPaginationRows` is at `OutputPanelContent.tsx:142`. The ticket said `PanelContent.tsx`; the design corrects it.
  - `useOutputMeta(outputId)` is at `PanelCardBody.tsx:101`.
  - `usePanelSortFilter.ts:79` and `PanelCard.crossFilter.test.tsx:162` are stale as claimed.
  - `ChartDisplayFields.tsx:1-8` claims `BindingEditor` ownership and an Appearance-section selector. Both claims are stale.

- **The grep probes fail on the current tree, so they will prove something once the work is done.** Run today:
  - Task 1.2's pattern: 31 hits.
  - Task 5.1's code pattern: 2 hits.
  - Task 5.1's spec pattern: 1 hit, at :8.
  - All three are expected to be empty after the work. `grep` here is a ugrep wrapper (`-G`), and `\|` alternation works as BRE.

- **The spec delta is valid.** The MODIFIED requirement header exactly matches the live requirement name. `npx openspec validate panelcard-split-leftovers --type change` returns `Change 'panelcard-split-leftovers' is valid`.

- **Scope and coverage.** Each ticket item maps to tasks:
  - Item 1: tasks 3.x.
  - Item 2: tasks 4.1 and 5.1.
  - Item 3: tasks 1.x, plus the HEL-1378 check in D3.
  - Item 4: tasks 2.x and 5.1.

  Deferring spec requirements 2-3 is an explicit non-goal with a follow-up. No placeholders or TBDs.

### Verdict: CONFIRM

### Non-blocking notes

- D1's line ranges are approximate. `DIALOG_FOCUSABLE_SELECTOR` and its comment (:655-660) fall in the "575-661" range assigned to the body file, but only the fullscreen block (:663+) uses them. They belong in `PanelCardHeader.refreshFullscreen.test.tsx`. Lint and typecheck would catch a misplacement anyway.
- After the move, the stability block's `afterAll` comment ("this describe is the last in the file today") and the preamble comments saying "the last describe block below" / "at the bottom of this file" stay accurate only if the stability block ends the body file. Comments are moved byte-identical by rule, so keep that block last.
- `PanelDetailModal.mobile.css:213` mentions `.panel-detail-modal__chart-label` rows in a comment. Note it under task 1.3 alongside the CSS-lock-pinned classes that are kept.
- The spec delta's Scatter bullet still says "when a DataType is bound". That is pre-existing wording; the code's `isBound` is `fieldOptions.length > 0`. It falls within the deferred re-audit follow-up.
