## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed commit: ae7af7ee7576181d3c3ad36f99764536c5fd9874 (base 519f06d5fca8783c2c5d7637386038e7a2b8c292, resolved live via resolve-review-base.sh).

### Phase 1: Spec Review — FAIL

Verified:
- AC1: `PanelCard.crossFilter.test.tsx` mocks `outputHistoryService.fetchOutputHistory` (requireActual spread), a `jest.mock` block added only near the imports (lines 12-19); nothing else in the file changed. The inventory and my red-first run both show its only request is `GET /api/outputs/output-1/history`.
- AC2: 31 test files edited, all `jest.mock` + `requireActual` spreads at the service-module seam, each with a why-comment. This matches the 40-file inventory minus 9 allowlisted files.
- AC3: guard added. I reproduced red-first and mutation A myself (see Phase 2). The allowlist expires through the `afterAll` zero-request check.
- AC4: full suite green (see Phase 2).
- AC5: no console silencing anywhere in the diff. The only `jest.spyOn(console, "error")` is in `networkGuard.test.ts:9`. It has no mockImplementation and asserts `not.toHaveBeenCalled`.
- Allowlist owners are accurate. I checked each one with `git diff --name-only $(git merge-base main <b>) <b>`. HEL-1575 edits App, AppShell.rail, CommandPalette and PanelList. HEL-1578 edits App and AppShell.rail. HEL-1579 edits App, PipelineDetailPage.test, .creatingStep, .draftCreate, .reorderGuard and .stepsError.
- The diff edits no file that HEL-1575/1578/1579/1572/1583/1606 edit. HEL-1599's branch is still at main, so there is no overlap.
- Standing constraints C1/C2 are honored. Every multi-file console evidence run uses `env -u CLAUDECODE -u AI_AGENT ... --reporters=default`, and `inventory.md` is the guard-run inventory of record.

Issues:
1. **Edit to a file on a concurrent lane's branch.** The commit edits `frontend/src/features/panels/ui/grid/DesktopPanelGrid.processedWidth.test.tsx` (lines 11-21 added). That file is also edited by `feature/dashboard-meta-row-gutters/HEL-1576` (live worktree, branch head 261702836; its diff changes line 66, `onWidthChange(1212, [18, 18] -> [12, 12], ...)`). This breaks two things:
   - proposal.md Non-goals: "No edits to files owned by parked or concurrent lanes beyond the ticket's own file".
   - the run's brief, which lists HEL-1576 among the branches whose files must not be edited.

   The two hunks do not overlap textually, so a merge would likely resolve. But the plan's own non-goal forbids the edit, and the executor's parked-lane check only covered HEL-1575/1578/1579 (measurements.md line 6). The claim "no edits to files on parked branches HEL-1575/1578/1579 (or HEL-1572/1576/1583/1606)" is **false** for HEL-1576.

### Phase 2: Code Review — FAIL

I ran every gate myself in WORKTREE_PATH. The tree was clean (`git status --short` empty).
- `npm run lint`: exit 0. `npm run format:check`: exit 0. `npm run typecheck`: exit 0.
- Root jest (`nice -n 19 npx jest --maxWorkers=3`): 51 suites / 469 tests passed.
- Frontend full suite, `env -u CLAUDECODE -u AI_AGENT nice -n 19 npx jest --maxWorkers=3 --reporters=default` from this worktree's `frontend/`: exit 0, **612 suites / 7268 tests passed**. That is the baseline's 7265 plus the 3 new self-tests. Stack paths are under `/home/matt/Development/helio/.claude/worktrees/task/mock-unmocked-test-network-calls/HEL-1600/frontend/`.
  - The run logged 245 `AggregateError` blocks, every one attributed to an allowlisted file. By file: PipelineDetailPage.test 130, CommandPalette 57, App 23, .stepsError 14, .draftCreate 12, .creatingStep 4, .reorderGuard 2, PanelList 2, AppShell.rail 1. Every other file logged **0**.
- `npm --prefix frontend run build`: exit 0.
- Independent red-first, run in a throwaway detached worktree at ae7af7ee7 that has since been removed. I restored the base versions of crossFilter and PanelGrid:
  - Result: FAIL, 21 failed / 7 passed / 28 total.
  - Guard messages: `GET /api/outputs/output-1` x21, `GET /api/outputs/output-1/assertion-status` x15, `GET /api/outputs/output-1/history` x2.
  - 0 AggregateError, so no socket was opened.
- Independent mutation A, on the same red-first tree: I replaced `networkGuard.ts:82` `throw new Error(message);` with a no-op. Result: 28 passed, exit 0. So line 82 is the enforcement.
- I did not re-run mutations B and C. The transcript (`transcripts/mutations.txt`) shows both red and green states, and the code paths match (`networkGuard.ts:850-857`).

Code quality: the guard is small and clearly documented. The `prefer-rest-params` disable at `networkGuard.ts:806` has its reason in the code (it forwards `open`'s variable arity). No `any`. The allowlist matches by path suffix, and the self-test covers basename collisions. The mocks follow the HEL-1353 precedent.

Issues:
2. **15 MB of raw jest transcripts committed into the change dir.** Files in `openspec/changes/guard-unmocked-test-network-calls/transcripts/` (sizes in bytes):

   | file | bytes |
   |---|---|
   | inventory-full-run.txt | 3,337,367 |
   | final-full-run.txt | 3,122,264 |
   | after-fixes-full-run-1.txt | 3,055,235 |
   | allowlist-run-1.txt | 1,972,565 |
   | allowlist-run-2.txt | 1,966,236 |
   | allowlist-run-3.txt | 1,969,392 |

   That is about 230k lines. The largest file in the whole `openspec/changes/archive` tree today is 344 KB, so this is about 40x the largest precedent. A squash-merge keeps it in history permanently. The evidence that carries the claims is a few lines per run: the Tests/Suites summary, the PASS/FAIL list, the guard-message lines, and the AggregateError-by-file counts.

### Phase 3: UI Review — N/A

The diff touches only test files, test setup and docs. No production `frontend/**` source changed, and no ApiRoutes, schemas or openspec/specs changed.

### Overall: FAIL

### Change Requests
1. Choose one resolution for `frontend/src/features/panels/ui/grid/DesktopPanelGrid.processedWidth.test.tsx`:
   - **Allowlist it** (the resolution that matches the plan):
     - Revert the HEL-1600 edit (restore the file to 519f06d5f).
     - Add `"src/features/panels/ui/grid/DesktopPanelGrid.processedWidth.test.tsx": "HEL-1576"` to `NETWORK_ALLOWLIST` in `frontend/src/test/networkGuard.ts`.
     - Run the file 3x under the guard to confirm it sends a nonzero number of requests (the expiry rule). The inventory shows 8 sends.
     - Update the counts in measurements.md, inventory.md and files-modified.md to 30 fixed / 10 allowlisted, and add HEL-1576 to the parked-lane list in proposal.md/design.md.
   - **Or have the orchestrator rule that HEL-1576 is not a protected lane.** In that case amend the proposal.md non-goal to name exactly which lanes are protected, so the artifact matches the shipped diff.
2. Replace the six multi-MB transcripts (`inventory-full-run.txt`, `final-full-run.txt`, `after-fixes-full-run-1.txt`, `allowlist-run-{1,2,3}.txt`) with excerpts. Each excerpt should keep:
   - the exact command and cwd
   - the `Test Suites:`/`Tests:` lines
   - the PASS/FAIL file list
   - the guard-message lines
   - an AggregateError-by-file count, as already done in `baseline-aggregate-by-file.txt`

   If the full logs are wanted, keep them through `scripts/concertino/persist-evidence.sh` rather than in git. Keep `measurements.md`'s citations pointing at the excerpts.

### Non-blocking Suggestions
- The why-comments say the stub "rejects as the real network error did". The stubs reject with a plain `Error`, while the real failure was an `AxiosError` (`ERR_NETWORK`). Test outcomes are unchanged (the full suite is green, and the test count is baseline + 3), but "rejects (plain Error) in place of the network error" would be more accurate.
- `networkGuard.ts`: a request fired after test N's `afterEach` is blamed on test N+1. This is documented. Including the test file path in `describeViolations` would make the `afterAll` case easier to trace.
