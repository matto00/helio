## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD: e0cd97d9155bf9db08069ebb4417886f72dfe3d8. Review base (resolved live): 665ceb96f415e875d2e955937b0b2af3f79dfa81.
Commits: 3e542e947 (red evidence + probe only, no code), then e0cd97d91 (test fix + green/mutation evidence). Red came before the fix (C2).

### Phase 1: Spec Review — PASS
Issues: none.

- AC1: root-cause.md and probe-timeline-4x.txt (6 throttled runs) are committed. ci-artifacts.txt records that run 45488894333's artifacts belong to the passing rerun and that run 39830913828 has no artifacts. `grep -c CONNECTOR_MASTER_KEY` is 0 in every committed .txt.
- AC2: red-throttled-4x.txt (5/10 fail, dark, 4x CDP throttling, repeat-each 10, 2 workers) is committed in 3e542e947 before any change to e2e/.
- AC3: the fix is test-side, as D3 requires (reasoning under Phase 2, point 2). The diff adds exactly one line: a wait on a real /chat condition. It adds no timeout, retry, `expect.poll` or quarantine/flake-list entry, and does not touch playwright.config.ts. The assertion `expect(g.tabs.filter((t) => t.current !== null)).toEqual([])` is unchanged (C3).
- AC4: the executor's evidence (green-40-warm.txt 40/40, green-4x.txt 20/20) agrees with my fresh reruns below.
- AC5: mutation-red-4x.txt shows 10/10 failing, and my own mutation run also went red.
- AC6: covered by the premise evidence. AC7 is a delivery-phase check.
- Every task item in tasks.md is ticked and matches the work. There is no scope creep: only `e2e/support/hel1583-glass-nav.ts` and the change dir are touched, and none of HEL-1651's or HEL-1852's files. Spec deltas: none (`skip_specs: true`), which is consistent.
- workflow-state CONSTRAINTS C1-C3 are honored.

### Phase 2: Code Review — PASS
Issues: none blocking.

Gates (my own fresh runs, in WORKTREE_PATH):
- No file under `frontend/**` or `backend/**` changed, so jest, the build and sbt are not triggered.
- I ran these anyway on the changed e2e file: root `npm run lint` passed with zero warnings, `npm run format:check` passed, and `prettier --check` / `eslint` on `e2e/support/hel1583-glass-nav.ts` were clean.

Orchestrator verification points:

1. **Where the overlay's composer sits (source and live DOM).**
   - Source: `<main id="app-main-content">` is opened at `frontend/src/app/App.tsx:270` and closed at :302. `QuickLauncherOverlay` is mounted at App.tsx:366, outside `<main>` and after the shell div. Its `Modal` is a native `<dialog>` (`shared/ui/Modal.tsx:261`) with no portal, so it stays where it is mounted.
   - Live DOM: I ran a scratch Playwright check against dev port 7133 on the lane DB, as a beta user at 375 px (`.concertino/scratch/HEL-1701/eval/eval-landmark.txt`):
     - On /dashboards, `main >> textbox "Message"` count = 0.
     - With the overlay open, the dialog's Message count = 1, main's count = 0, and `main dialog` = false.
     - After Browse all conversations: main's count = 1, the URL is /chat, and no dialog is open.
   - So the wait cannot pass early while the overlay is open, and the landmark is absent on /dashboards.
   - Same commit as ChatPage: the composer is the last child of ActiveConversationPanel's stable tree (`ActiveConversationPanel.tsx:283`), which ChatPage renders (route element at `AppRoutes.tsx:128`). It can only exist once the router has committed the `/chat` location. BottomNav reads that same `useLocation()` in the same render, so its visibility implies the nav has re-rendered for `/chat`. This holds even if the composer appeared later than the route switch.

2. **Root cause.** The probe evidence supports H1. All 6 throttled runs show `pushState path=/chat cur=[Dashboards=page] h1=[Dashboards]`, then a single later mutation batch `cur=[] h1=[Assistant]`. No intermediate state was recorded. A MutationObserver callback runs after React's synchronous commit, so one batch covering the tab change and the heading change shows the commit is atomic. Therefore D3's test-side branch follows: during the window, the user sees the previous page and its tab together.

3. **Red, mutation and green evidence, rerun by me under matching conditions.** I used the identical throttle wrapper and loaded it through a scratch config (`.concertino/scratch/HEL-1701/eval/`). Nothing was written to the worktree, and `git status` is clean. All runs used the lane DB, 2 workers and `nice -n 19`.
   - Fixed test, 4x, dark: 10/10 pass (`eval-green-4x-dark.txt`).
   - Fixed test, 4x, light: 10/10 pass (`eval-green-4x-light.txt`).
   - Fixed test, 6x, dark (extra stress): 10/10 pass (`eval-green-6x-dark.txt`).
   - Mutation, 4x, dark: 7 failed / 3 passed (`eval-mutation-4x-dark.txt`). The mutation is the helper copy with only the added wait line removed; diffed against base, it differs only in import paths and the comment. All 7 failures are the received Dashboards `"current": "page"` failure, which reproduces the CI failure mode.
   - Both full glass-nav spec files, warm: 30/30 pass (`eval-full-glass-nav.txt`).
   - My mutation rate (7/10) is lower than the executor's 10/10. Both are consistent with red at roughly p 0.5 or higher, and both are clearly red.

4. **ACs and hygiene.** The diff adds no timeouts, retries or flake-list entries, and weakens no assertion (grep of the e2e diff for timeout/retry found nothing). The probe and throttle wrapper are committed only as `.txt`, not as specs.

Checklist: DRY, readability, modularity, type safety, no dead code, no over-engineering. All are fine for a one-line test wait with a three-line explanatory comment.

### Phase 3: UI Review — N/A
None of the Phase 3 trigger paths changed (`frontend/**`, `ApiRoutes.scala`, `schemas/**`, `openspec/specs/**`). The only non-change-dir file is `e2e/support/hel1583-glass-nav.ts`. The live checks above were run for verification point 1, not as a UI review.

### Overall: PASS

### Change Requests
none

### Non-blocking Suggestions
- In probe-timeline.spec.ts.txt, the `h1` field reads `main h1`. That is AppShell's visually-hidden per-route heading (App.tsx:276), which is derived from location like the nav, not ChatPage's own content. The `dialog` field queries `[role=dialog]`, which a native `<dialog>` without a role attribute does not match, so it reads false even with the overlay open. Neither changes the conclusion, because the atomic-commit argument and the live check above cover it. root-cause.md could note that "h1=[Assistant]" is the shell heading.
- Report the mutation rate as a range in the PR, since two independent runs gave 10/10 and 7/10 failing.

Servers started for this review were stopped with stop-servers.sh (`STOPPED ports=7133,10040`).
