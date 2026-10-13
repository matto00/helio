## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD `b09de52f8cec9a9eb723a08f0f8feb76720b9390` against the live-resolved base `290ab8a22c7f0adc16b4c0d070748657067081fe` (`resolve-review-base.sh`, exit 0). Spawn-cwd guard: `READY ambient=/home/matt/Development/helio branch=task/panelcard-split-leftovers/HEL-1395`.

### What I verified (with evidence)

**AC1, behaviour-preserving split (item 1, C1)**
- I wrote a script that walks the base `PanelCard.test.tsx` (from `git show 290ab8a22:`). It extracts every top-level `describe(` ... `});` block and checks that each block appears as an exact substring in one of the three new files. Result: all 9 blocks matched, each in exactly one file.
  - Body: base lines 115-164, 270-329 and 575-652.
  - Header: 166-242, 248-266 and 335-422.
  - Header.refreshFullscreen: 428-469, 474-566 and 662-807.
- Test names and bodies are therefore byte-identical by construction. The base has 26 `it(` and 3 `it.each` tables, at :458, :700 and :718.
- The non-block base lines are the inter-block comments and `DIALOG_FOCUSABLE_SELECTOR`. I checked that they moved alongside their blocks.
- I diffed each new file's preamble against base lines 1-114. The only removals are:
  - unused imports;
  - unused `jest.mocked(...)` bindings, plus one comment above a binding that was removed;
  - in Header, the `actualUsePanelData` helper, which only the prop-stability block (now in Body) used.
- Every `jest.mock(...)` factory is kept verbatim in all three files. No mock was dropped.
- `npx jest --verbose` on the three files: `Test Suites: 3 passed`, `Tests: 36 passed, 36 total`. File sizes are 296, 284 and 399 lines, all under 500.

**AC2, dead-code removal (item 3)**
- At base, `showChartSection`, `chartAppearance`, `ChartAppearanceEditor` and `buildInitialChart` had exactly one render path: `PanelDetailModal.tsx:281`, `showChartSection={false}`.
- In `detailModal/`, `chartAppearance` was read only at `usePanelDetailEditState.ts` :32, :38, :86 and :125, and passed through the modal. It never reached submit or dirty logic, so the removed JSX was `{false && ...}`.
- At HEAD, `git grep` for those four symbols in `frontend` returns no hits.
- CSS: each removed class (`section-heading`, `chart-section`, `chart-subsection`, `chart-type-*`) had no user at base outside `ChartAppearanceEditor.tsx` and the CSS file itself. The one `section-heading` hit is a different BEM block, `preferences-editor__`.
- Every class left in `PanelDetailModal.appearance.css` still has a TS/TSX referent. For `chart-label` and `color-swatches`, that referent is only the CSS-lock test (see the notes below).
- HEL-1378 file: the diff removes only tests 1-2, the capture wrapper, two imports, the `mockCaptured` reset and the header comment. Test 3 is unchanged. A run gives `Tests: 1 passed, 1 total`.

**AC2, grep proofs (items 2 and 4)**
- `git grep "PanelCard.tsx\`'s \`filteredPaginationRows\|PanelCard\`'s own pre-existing\|PanelCard.test.tsx"` at HEAD in `frontend`: no hits.
- A repo-wide check for `PanelCard.test.tsx`, `ChartAppearanceEditor` and `panelDetailChartState`, excluding the archive and this change, also finds no hits.
- I checked each repointed target against the code:
  - `filteredPaginationRows` is at `OutputPanelContent.tsx:142`.
  - `PanelCardBody.tsx:101` calls `useOutputMeta(outputId)` and passes `output` to `usePanelSortFilter` at :136.
  - `useCrossFilteredPanelData` has one caller, `usePanelCardInspect.ts:103`.
  - `ChartDisplayFields` is rendered by `OutputKindFields.tsx:176`, under its `Chart type` Select (:128-132). `annotationState` is owned by `useOutputKindState.ts:119`.
  - The "user-event is not a dependency" convention is at `PanelCardHeader.refreshFullscreen.test.tsx:209`.
- Spec: the MODIFIED delta's requirement header matches the base `openspec/specs/chart-type-config-editor/spec.md` requirement 1. It replaces the "Appearance section's chart type selector" text at :8 and :22. `npx openspec validate panelcard-split-leftovers --type change` exits 0.

**Gates (re-run fresh by me, foreground, `nice -n 19`, `--maxWorkers=3`)**
- `npm run lint`: exit 0. `npm run typecheck`: exit 0. `npm run format:check`: exit 0.
- Jest shard: detailModal, editors, panels/hooks, theme, pipelines/ui/outputEditor and settings. 90 suites, 993 tests passed.
- Jest shard: `src/features/panels`, all of it. 194 suites, 2579 tests passed.
- Jest on the three split files (verbose): 36 passed.
- I did not run the whole frontend suite. The evaluator's pasted 4-shard run reports 590 suites and 7060 tests. Changed areas are covered by my shards above.

**UI (step 4)**
- I did not start servers for this. The only runtime JSX removed was a branch guarded by the constant `false`, so the rendered DOM is unchanged.
- Every CSS rule removed targets a class that has no renderer in base or HEAD (grep above). No visible surface changed, so there is no new design to judge in light or dark.
- The evaluator's cycle-1 live pass of the modal at 768 and 390 px stands as corroboration, not as the basis of this verdict.
- No mtime-ordering evidence was used or accepted.

### Verdict: CONFIRM

### Non-blocking notes
- `.panel-detail-modal__chart-label` and `.panel-detail-modal__color-swatches` (appearance.css and mobile.css) are now dead CSS. They are kept alive only by their CSS-lock tests in `PanelDetailModal.css.test.ts:178-186`. A follow-up should delete the rules and those lock tests together.
- `PanelDetailModal.mobile.css:213-220`: the original sentence "They are reachable in every chart panel's edit flow" is still there, now contradicted by the appended HEL-1395 note. It should be dropped with the follow-up above.
- `chart-type-config-editor` has more stale text: the Purpose line and requirements 2-3 still describe the panel edit pane. This was already flagged by design as a follow-up candidate.
- The stale `BindingEditor` mentions in `ChartAggregationFields.tsx`, `MetricValueEditor.tsx` and `useBoundOrLiteralState.ts` were reported, not fixed. That is correctly out of scope.
