## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD: `036fa3ff405726c002713463cc5e9ba13b3d9482` (base `bcde936d5e09f22fc0150fba603f70c3065866f6`, resolved live via `resolve-review-base.sh`).
Commits: `321528c5` pure move, `4ac632b7` comment touch-ups, `036fa3ff` D5 test nits.
Evaluator evidence: `/home/matt/Development/helio/.concertino/runs/HEL-1399/evidence/eval-1/` (outside the worktree, so it survives cleanup).

### Phase 1: Spec Review — PASS
- AC1 (<400 lines): PASS. OutputPanelContent 293, PanelContent 254, PanelDetailModal 336, usePanelDetailEditState 143, usePanelDetailData 95, OutputPanelSection 85, renderSubtypeEditor 76, panelDetailChartState 25.
- AC2 (byte-identical, hook order, DOM): PASS. I re-ran this independently; details are in Phase 2.
- AC3 (tests change only in import paths, D5 the one exception): PASS. `git diff --name-only bcde936d...HEAD` lists exactly one test file, `PanelDetailModal.chartTypeDefault.test.tsx`. No other test needed an import change because nothing that moved was exported before. Every `jest.mock` that targets a resolved path still applies, and the full suite is green.
- AC4 (running app, light and dark): PASS. The executor's before/after pixel comparison covers it, and so does my own spot-check (Phase 3).
- AC5 (overlap with HEL-1378/HEL-1395 noted, HEL-1395 not absorbed): PASS. It is noted in design.md (Risks, C7). The diff has zero `^[-+]` hits for `showChartSection|ChartAppearanceEditor`.
- Folded-in HEL-1378 nits: PASS. Both mocks were added (`listOutputPanels`, `getDistinctValues`), and `AppearanceEditor` now renders as `<actual.AppearanceEditor {...props} />`. That is exactly the scope the ticket names. My own run of the suite shows 3/3 green, with 2 `AggregateError` console errors and 2 pre-existing `act()` warnings from `OutputPanelContent`'s `useOutputMeta`. The executor's D5-before had 4 AggregateErrors, so the two named mocks removed 2. The other 2 are network calls that the ticket's folded-in scope does not name. I agree with treating them as a follow-up and not a defect: design.md's "expect 0" was a prediction, not an AC. The executor attributes the residual to an unmocked `getFilterCapabilities`. That is plausible, since `OutputControlsEditor.tsx:56` calls it in edit mode, but I did not independently confirm the attribution, because jsdom's XHR error carries no URL. The executor's mutation evidence (`D5-mutation-red.txt`: `chartType` "line" goes red, then reverts to green) shows the test still catches the regression.
- Constraints C1–C7: all honoured. C1/C2: see Phase 2. C3: see above. C4: there are three commits, and I checked commit 2 mechanically as comment-only (Phase 2). C5: not observable in the diff. C6: evidence is in the runs dir, and the worktree status shows only the untracked change dir. C7: see above.
- Task items 1.1–5.3 are all marked done and match the diff.

### Phase 2: Code Review — PASS
Gates, run fresh by me in WORKTREE_PATH:
- `npm run lint`: exit 0, with `--max-warnings=0`
- `npm run format:check`: exit 0
- `npm run typecheck`: exit 0
- `npx tsc --noEmit --noUnusedLocals`, filtered to the 8 touched/new modules: zero hits
- root `jest` (nice 19, `--maxWorkers=3`): 43 suites / 418 tests passed
- `npm --prefix frontend test` (nice 19, `--maxWorkers=3`): 497 suites / 5196 tests passed. The known `PipelineDetailPage.draftCreate.test.tsx:301` flake did not occur this run.
- `npm --prefix frontend run build`: exit 0

My own byte-identity check (`eval-1/bytecheck.js`) is separate from the executor's `d3.py`. It reads files from git objects at a given rev, not from the working tree. It also checks that every non-blank base line is covered by a block, apart from imports, the old `renderSubtypeEditor` wrapper lines L379/L421, and the L559 call.
- At `321528c5` with comments INCLUDED, all 8 blocks are IDENTICAL and DEFECTS is 0. Transcript: `eval-1/bytecheck-commit1-comments-included.txt`.
- At HEAD with comments INCLUDED, 2 blocks differ: `usePanelDetailData` L166-217 and `usePanelDetailEditState` L220-314. Those are exactly the commit-2 comment edits inside moved blocks.
- At HEAD with comments STRIPPED (comment ranges taken from the TS AST, not regex), all 8 blocks are IDENTICAL and DEFECTS is 0. Transcript: `eval-1/bytecheck-HEAD-comments-stripped.txt`.
- I printed the whole residual (non-import permitted-new code) and read it. It contains only the two hook signatures, their `return { … }`, the two destructuring call sites, the `renderSubtypeEditor` signature/close brace, and the `renderSubtypeEditor({ … })` argument list. It is exactly D3's permitted set.
- Commit 2 is comment-only. I printed every changed file at `321528c5` and `4ac632b7` with `ts.createPrinter({ removeComments: true })`, and all 7 files are AST-EQUAL (`eval-1/astcmp.js`). A word-diff confirms that each hunk changes only text inside `//` or `/** */`.
- Hook sequence: I derived it independently with a grep that also handles generic call sites like `useRef<…>(`, inlining the two hooks at their call sites. Base L162-314 and HEAD both give 30 calls, and the sequences are equal: `useAppDispatch useTheme useViewerControls useMemo useMemo useCallback useOutputMeta useCrossFilterServerOps usePanelData useAppSelector useNavigate useState useMemo useState×5 useRef×6 useState useState useCallback useState useCallback useEffect`. `OutputPanelContent` is `useOutputMeta useOutputMeta useAppSelector` on both sides. `OutputPanelSection` is `useOutputMeta useState useState useEffect` on both sides. `renderSubtypeEditor` and `panelDetailChartState` call no hooks. `OutputPanelSection` stays mounted at the same JSX position, and `renderSubtypeEditor` is a plain function call, so no tree layer was added (C2).

Checklist:
- Canonical code quality / CONTRIBUTING.md: every file is under the 400-line split line. There are no inline FQNs and no new comments beyond the pointer repoints.
- DESIGN.md [mechanical]: N/A. No CSS or markup changed.
- DRY / modularity: acceptable. Large destructures were accepted by design (Risks).
- Type safety: no `any`. The hook return types are inferred.
- Tests: meaningful. D5 has mutation evidence.
- No dead code: `--noUnusedLocals` is clean.
- Behaviour-preserving: verified above.

Issues: none blocking. See the non-blocking notes below.

### Phase 3: UI Review — PASS
Servers came up through `start-servers.sh`, which reused the healthy servers on 6831/9738, and `assert-phase.sh servers` printed PASS. Because MISTAKES.md warns about reused servers, I checked that the reused frontend serves THIS worktree. `/src/features/panels/ui/detailModal/usePanelDetailData.ts` returned 200, and that file exists only on the branch.

I used my own throwaway user `hel1399-eval-1791574127966@example.test` (not matt@helio.dev). Ids and cleanup are recorded in `/home/matt/Development/helio/.concertino/runs/HEL-1399/evidence/eval-1-dev-db-ids.txt`.
- Happy path, dark at 1440: the narrow (w=2) chart card shows the HEL-1398 short footnote ("200 of 500 rows.") and the annotation. Screenshot: `eval-1/dashboard-dark-1440.png`.
- Detail modal view mode shows the full footnote "Based on the first 200 of 500 rows." (`eval-1/modal-view-dark.png`). It matches the layout of the executor's `before/03-chart-modal-view-dark.png`.
- Edit mode (`eval-1/modal-edit-dark.png`): Appearance, the OutputPanelSection (Output link, provenance, Swap output, and "Used on 1 dashboard", which comes from `listOutputPanels`), and Controls all render.
- Dirty title edit, then Escape: the "Unsaved changes" banner appears, which exercises the keydown effect moved into `usePanelDetailEditState`. Discard returns to view mode with the title reset.
- Save switched to view mode, and the grid card showed the new title. That is staged locally until auto-save, per the CLAUDE.md layout notes.
- Light theme at 1280: the dashboard footnote is the long form on the wider card (`eval-1/dashboard-light-1440.png`), view and edit modal are correct (`eval-1/modal-view-light.png`, `eval-1/modal-edit-light.png`), and the text panel edit renders the TextContentEditor via `renderSubtypeEditor`. Editing content and pressing Cancel shows the discard banner, which exercises the `subtypeDirty` path (`eval-1/text-modal-discard-light.png`).
- Breakpoints: at 768 the modal renders correctly (`eval-1/modal-view-light-768.png`). At 375 the mobile stack shows the footnoted chart (`eval-1/dashboard-light-375.png`). I did not separately check 1100. The executor's pixel comparison at 1900 also covers the layout.
- Console: 0 errors across the whole session. There are ECharts "Can't get DOM width or height" warnings when the modal opens, which come from the chart mounting during the open animation. I believe these are unrelated to this pure move but did not baseline them against base.
- Executor pixel evidence: after vs before is pixel-identical for 20 of 22 pairs. The remaining diffs are tiny (5–37 px) and move between pairs across the `after` and `after2` runs (caret or hover-state noise). This rests on the PNG content diffs in `screenshot-comparison*.txt`, not on mtimes.

### Overall: PASS

### Change Requests
None.

### Non-blocking Suggestions
- Follow-up: in `PanelDetailModal.chartTypeDefault.test.tsx`, 2 residual `AggregateError` console errors remain. The executor attributes them to an unmocked `getFilterCapabilities` (`OutputControlsEditor.tsx:56`, edit mode); I did not independently confirm that. Two pre-existing `act()` warnings from `OutputPanelContent`'s `useOutputMeta` also remain. Both are outside the ticket's named folded-in scope.
- Pre-existing stale comment pointers, not introduced here; list them as follow-ups:
  - `renderers/ChartRenderer.tsx:14` cites "`PanelContent.tsx`'s static import of it", but base PanelContent already imported `ChartOutputPanel`, not ChartRenderer.
  - `PanelContent.css:213` cites a Spinner in "PanelContent.tsx", which neither file now uses.
  - The test-file hits D4 already lists (`PanelCard.filterEmptyState.test.tsx:5`, `TableRenderer.test.tsx:1028`) are still there, as intended.
- The executor's `d3.py` replaces only the first `exportfunction`, and it truncates residuals at 700 chars in its transcript. My run prints every residual in full and found nothing beyond the permitted set, so this is only a note on how strong the evidence is.
- Spot-check user row `768dd6b0-55ce-4def-90d1-047915cd9806` remains, because there is no user-delete API. Its dashboard, output, pipeline and source were deleted by exact id.
