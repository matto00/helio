## Standing Constraints

- [C1] Behaviour-preserving split only: moved code byte-identical modulo whitespace and the permitted `export` prefix (D3); any bug found becomes a follow-up in the report, never fixed here.
- [C2] Hook call order unchanged, proven by the D3b transcript; no new component layer in the render tree.
- [C3] Existing tests change only in import paths; the single exception is D5's two HEL-1378 nits in PanelDetailModal.chartTypeDefault.test.tsx.
- [C4] Commits separated: 1 pure move, 2 non-test comment touch-ups, 3 D5 test nits.
- [C5] Memory caps: jest `--maxWorkers=3`, Playwright `--workers=2`, under `nice -n 19`; check `free -g` before every commit (wait if available < ~15 GB); never pkill/pgrep/killall; no --no-verify/HUSKY=0 without disclosure; `git -C`, never cd.
- [C6] Evidence (screenshots, transcripts) goes in /home/matt/Development/helio/.concertino/runs/HEL-1399/evidence/, never the worktree root; UI checks use an own throwaway user (never matt@helio.dev) and record every created dev-DB id.
- [C7] HEL-1395 is not absorbed: no removal of showChartSection / ChartAppearanceEditor chart-type code.

### Frontend

## 1. Baseline (before any edit)

- [x] 1.1 Start servers, create a throwaway user, and seed: a chart Output with >200 rows (HEL-1398 footnote), a table and a metric panel, a text panel; record ids
- [x] 1.2 Capture BEFORE screenshots in light and dark: dashboard with a narrow footnoted chart panel, detail modal view mode (chart), edit mode (output panel and text panel), the discard banner

## 2. Pure move (Commit 1)

- [x] 2.1 Create ui/OutputPanelContent.tsx from L139-398 (D1); trim PanelContent.tsx imports
- [x] 2.2 Create detailModal/panelDetailChartState.ts (D2a) and detailModal/OutputPanelSection.tsx (D2b)
- [x] 2.3 Create detailModal/usePanelDetailData.ts (D2c) and call it in its original slot
- [x] 2.4 Create detailModal/usePanelDetailEditState.ts (D2d: L220-314, including the keydown effect) and call it in its original slot
- [x] 2.5 Create detailModal/renderSubtypeEditor.tsx (D2e) and update the L559 call
- [x] 2.6 Verify `wc -l` < 400 for every touched or new file; if the host is still ≥ 400, stop and report
- [x] 2.7 Persist the D3 byte-identity and D3b hook-sequence transcripts; every block IDENTICAL

## 3. Comment touch-ups (Commit 2)

- [x] 3.1 Run the D4 grep, classify every hit, fix only non-test source comments; the diff touches comment text only

### Tests

## 4. HEL-1378 test nits (Commit 3)

- [x] 4.1 Apply the D5 edits; record the console-error count before and after, and the mutation red-then-revert

## 5. Gates and live comparison

- [x] 5.1 lint, typecheck, format:check, and the panels + grid suites (capped); zero new warnings
- [x] 5.2 Full frontend `npm test` (capped); on a PipelineDetailPage.draftCreate.test.tsx:301 failure, re-run once and note it
- [x] 5.3 AFTER screenshots matching 1.2, in light and dark; record identical or differing per pair
