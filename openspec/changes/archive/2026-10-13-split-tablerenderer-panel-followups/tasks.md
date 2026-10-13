## Standing Constraints

- [C1] TableRenderer split is behaviour-preserving: moved code byte-identical modulo whitespace and the permitted additions (design D2); any bug found becomes a follow-up, never fixed in the move.
- [C2] Hook call order unchanged (D2 transcript); no new component layer in TableRenderer's render tree.
- [C3] Existing test files change only in import paths, except D3 comment text and D4's one mock; new tests only for D5.
- [C4] Commits separated: 1 pure move (D1), 2 comment/reference-table text (D3), 3 test mock (D4), 4 scroll hint (D5).
- [C5] Resource caps: jest --maxWorkers=3 and Playwright --workers=2 under nice -n 19; Bash timeout 600000; never background or nohup a test run; whole-suite runs split into foreground shards with exactly what ran reported; no pkill/pgrep/killall; stop servers ONLY via scripts/concertino/stop-servers.sh <WORKTREE_PATH> <DEV_PORT> <BACKEND_PORT>, never kill a parent/grandparent (ps -o ppid=); `git -C`, never cd; never run git in the main checkout.
- [C6] Evidence goes in /home/matt/Development/helio/.concertino/runs/HEL-1449/evidence/, never the worktree root. UI checks use own throwaway @example.test users (registration via the separate `request` fixture), never matt@helio.dev; delete them by exact (id, email) with e2e/support/userCleanupCore.cjs buildUserDeleteSql. Never print or source backend/.env.
- [C7] Do not touch files changed by open PRs #986 #996 #991 #990 #999 #998 #994 #1000 #1001; no migration; nothing touches prod data.
- [C8] files-modified.md lists complete repo-relative paths. No claude.ai session link or Claude-Session trailer in commits.
- [C9] Item 4 owner ruling `scroll-hint` (2026-10-13): vertical axis on useScrollEdges, top/bottom fade on the edit form, elevationTokenGuard pinned.

### Frontend

## 1. Baseline (before any edit)

- [x] 1.1 Start servers; create a throwaway user and seed an output table panel, an output chart panel with 0 and with ≥3 controls, and a text panel; record ids
- [x] 1.2 BEFORE screenshots, light and dark, 1440×900 and 1280×720: output-panel edit form (top and scrolled), text-panel edit form, a table panel on the dashboard
- [x] 1.3 Record the D4 AggregateError count of PanelDetailModal.chartTypeDefault.test.tsx before any change

## 2. TableRenderer pure move (Commit 1)

- [x] 2.1 Create tableRendererProps.ts, tableRendererModel.ts, tableRendererPersistence.ts (D1 a-c)
- [x] 2.2 Create useTableRows.ts (D1d) and call it in its original slot
- [x] 2.3 Create useTablePersistedState.ts (D1e: L470-694, refs, pin state, flush effect and the four handlers) and call it right after
- [x] 2.4 `wc -l` every touched/new file (incl. PanelDetailModal.tsx, EditFormScrollArea.tsx at 4.x); apply D1f only if the host is ≥ 400; stop and report if still ≥ 400
- [x] 2.5 Persist D2 transcripts (run against commit 1, before commit 2's comment edits): partition check over 1..903 (mechanical), byte-identity (all IDENTICAL), hook sequence (equal), --noUnusedLocals (zero hits)

## 3. Stale pointers (Commit 2)

- [x] 3.1 Run the D3 grep, classify every hit, fix comment text only
- [x] 3.2 Re-point the 7 dead write-path-audit Source Locations rows; persist the zero-hit grep and the path-existence loop

## 4. Scroll hint (Commit 4)

- [x] 4.1 Add top/bottom/overflowingY to useScrollEdges (D5), additive only
- [x] 4.2 Create detailModal/EditFormScrollArea.tsx (owns the hook; wrapper + aria-hidden overlay with modifier classes) and render the edit form through it; add the overlay inset fades
- [x] 4.3 Verify live: desktop view→Edit, E key, mobile-width 390×844 open→Edit, add a control, Controls finishing loading after open, resize; fade visible over a Controls row (pixel delta) and clickable through; fix staleness inside the hook if found (red test first)
- [x] 4.4 Pin the new declarations in elevationTokenGuard.css.test.ts; update DESIGN.md's scroll-fade sentence

### Tests

## 5. Test mock (Commit 3)

- [x] 5.1 Add the getFilterCapabilities mock (D4, `{ columns: [] }`); AggregateError count 2 → 0, no new act() warning; mutation red then reverted

## 6. Scroll-hint tests

- [x] 6.1 useScrollEdges.test.tsx: vertical cases red before 4.1, green after
- [x] 6.2 PanelDetailModal test starting in view mode, toggling to edit: bottom modifier class follows a stubbed overflow; red under the host-level-hook mutation; DataGrid/SortableTable suites untouched and green

## 7. Gates, live comparison, cleanup

- [x] 7.1 lint, typecheck, format:check; panels + shared/ui + theme suites (capped); full frontend npm test in foreground shards
- [x] 7.2 AFTER screenshots matching 1.2; table panel identical; edit form shows the fades as specified in both themes
- [x] 7.3 D6: delete the 5 HEL-1399 residue users plus this run's throwaway users by exact (id, email); record before/after SELECTs
