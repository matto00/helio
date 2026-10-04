## Evaluation Report — Cycle 1 (evaluation-1.md)
Reviewed commit: 3326762cb6990f2274375103991406c23ac57482

### Phase 1: Spec Review — PASS
Issues: none. AC1 (single `layoutHistoryThunks.ts`, CommandBar and shortcuts both call it, no duplicate left), AC2 (deferred flush specified in `useLayoutSave.ts` header, spec deltas, tests; `applied` layout replaces bare revision), AC3 (fulfilled reducer keeps newer local layout by reference, pending recomputed), AC4 (placement extension), AC5 (CLAUDE.md fixed; canonical specs corrected via spec edits plus MODIFIED/REMOVED deltas for the remaining 250 ms sites, applied at archive) all addressed. All tasks checked (0 unchecked). HEL-1023/1028/1071 not regressed (live check below; 1071 400 still enforced by server). Scope: diff touches no backend/, sources or connectors files, no migration. The only non-frontend extras are e2e spec, openspec, CLAUDE.md.

### Phase 2: Code Review — PASS
Gates run fresh in WORKTREE_PATH (nice -n 19, jest maxWorkers=2): `npm run lint` 0; `format:check` 0; `npm --prefix frontend run build` 0; `npm test` root 35 suites/350 pass, frontend 413 suites/4304 pass. Backend untouched so no sbt.
Red/green recheck: restored useLayoutSave.ts + dashboardsSlice.ts to merge base with new tests kept; `DesktopPanelGrid.inflightResponse` -> 3 failed / 2 passed (Expected: true, as claimed); restored HEAD versions; `git status` clean afterward.
Code: DRY (one traversal thunk), well-commented contract header for HEL-1233, no dead code, no escape hatches. No issues.

### Phase 3: UI Review — PASS
Servers via start-servers.sh on 6662/9569; serving cwd verified = this worktree (frontend pid 977249, backend 976804 via /proc/<pid>/cwd). Seeded user/dashboard by API, checked location.href before each reading.
- Dark theme: drag a panel (y 72->352), "Unsaved changes"/Save now shown; undo via toolbar button reverted; redo via Ctrl+Shift+Z reapplied; undo via Ctrl+Z reverted; redo via toolbar button reapplied. Drag -> Add panel (Output picker, then a Text panel) -> pending stayed "Unsaved changes", no PATCH on create; Save now sent one PATCH carrying the dragged item (e966 y=10) and indicator cleared.
- Light theme: same: drag, undo button, redo key (indicator returns to "Unsaved changes"; undo back to baseline cleared it), drag -> create -> Save now PATCH carried dragged panel (b62719ab y 6->9) and indicator cleared. Screenshot taken in light; both themes render correctly.
- 768px: no horizontal overflow. Console errors: one 400 from my own deliberately invalid fixture PATCH (out-of-bounds xs, HEL-1071 rejection working) and one dev-proxy 502 on /run-events SSE (unrelated).
Observation (pre-existing, not this change): the content (Text) panel create does not add an item to the server layout, so PATCH bodies omit it (render-time placement per HEL-1023).

### Overall: PASS

### Non-blocking Suggestions
- none required.

### Residue
Dev DB: user hel1230-eval-1791148468856@example.test (no delete-user API). Dashboard effbdb87..., pipeline c5324fa4..., data source 8b7b1921..., plus panels created via the dashboard, deleted by exact id (204 each). Servers killed by exact pid. No scratch files in repo; .playwright-mcp screenshots are pre-existing untracked dir outside git status. Tree clean.
