## Skeptic Report — final gate (round 1)

### What I verified (with evidence)

1. **Diff scope** — `git diff main...HEAD --stat`: exactly `DesktopPanelGrid.tsx` (+5),
   `MobilePanelStack.tsx` (+9/-1), the new `PanelDetailModal.panelSwitch.test.tsx`
   (+147), and openspec artifacts. No `PanelDetailModal.css` churn (HEL-309 respected),
   no unrelated files.

2. **The fix mechanism** — read `PanelDetailModal.tsx` (all `useState(initial*)`
   seeds derived from `panel` prop, only run on mount) and
   `usePanelDetailModalLifecycle.ts` (`showModal()` fires in a `useEffect([])`,
   so it re-fires on every fresh mount). `key={detailPanelId}` /
   `key={detailPanel.id}` at both call sites forces React to unmount/remount the
   whole subtree on any panel-identity change — a deterministic guarantee of
   React reconciliation, not a probabilistic fix.

3. **Regression test genuinely catches the bug** — read
   `PanelDetailModal.panelSwitch.test.tsx`. Then **independently reproduced**:
   removed `key={detailPanel.id}` from `MobilePanelStack.tsx` and reran
   `npx jest --testPathPatterns=PanelDetailModal.panelSwitch`: both tests fail
   red — `Expected: "Panel B" / Received: "Panel A"` (display) and
   `Expected: "#222222" / Received: "#111111"` (save-corruption path,
   `pendingPanelUpdates["b"].appearance.background` carrying A's value).
   Restored the file (`git diff` clean afterward) and reran — both pass. This
   independently confirms AC1, AC2, and AC3 are all traced to real,
   bug-catching evidence, not asserted.

4. **Corruption path closed** — `accumulatePanelUpdate` reducer
   (`panelsSlice.ts:55-69`) keys `pendingPanelUpdates` by the `panelId` in the
   dispatched payload; `handleEditSubmit` in `PanelDetailModal.tsx` dispatches
   `panel.id` from the (now-correct, post-remount) component instance's own
   props/state — there is no path left where a stale instance's state can be
   dispatched under a different panel's id, since the instance carrying A's
   state no longer exists after the key change.

5. **Gates re-run fresh in the worktree:**
   - `npx jest` → 104 suites / 1117 tests pass.
   - `npm run lint` → clean (`eslint src --max-warnings=0`).
   - `npm run format:check` → clean.
   - `npm run build` → succeeds (only the pre-existing >500kB chunk-size
     advisory, unrelated).

6. **Live UI check** (servers via `scripts/concertino/start-servers.sh` on
   5480/8387, `assert-phase.sh servers` → `PASS`): opened `PanelDetailModal` at
   1440px desktop width on a real dashboard, entered edit mode, staged a title
   change. Confirmed the evaluator's non-blocking observation independently: a
   real Playwright click on a sibling panel card while the dialog is open times
   out — `<dialog> ... subtree intercepts pointer events` — and even a
   programmatically dispatched `MouseEvent` on the sibling card is silently
   swallowed (the native-dialog top-layer `inert` semantics block synthetic
   dispatch too, not just physical clicks). This confirms the realistic trigger
   really is the narrow mount-effect race window the evaluator described, and
   that the fix's correctness doesn't depend on reproducing that race live —
   `key`-based remount is unconditional on any `detailPanelId` change,
   regardless of how that change happens. Cancel/discard flow also verified
   clean (title reverted, no console errors, `browser_console_messages(error)`
   → 0 throughout the session).

7. **Reports cross-checked against ground truth** — `files-modified.md`'s
   documented probe (unfixed: title `"Panel A"`, background `"#111111"` bleed
   onto B) matches my own independent reproduction byte-for-byte. `tasks.md`
   all 8 items checked and match the diff. `evaluation-1.md`'s one change
   request (wrong ticket number in commit subject, `HEL-26` → `HEL-307`) is
   resolved in the current commit (`5cabbfae HEL-307 Re-seed PanelDetailModal
   form state on direct panel switch`), confirmed via `git log`.

8. **No stray artifacts** — `git status --short` shows only untracked
   `node_modules` symlinks (expected, worktree convention) and this session's
   own evaluation/skeptic report files; no screenshots at the repo root
   (Playwright screenshots written to `.playwright-mcp/`, which is gitignored).

### Verdict: CONFIRM

### Non-blocking notes
- The pre-existing `selectPipelineOutputDataTypes` selector-memoization warning
  (`MarkdownEditor.tsx:33`) surfaces during the new test's render but is
  confirmed unrelated/pre-existing per the evaluator and my own test run —
  worth a follow-up ticket, not a blocker here.
