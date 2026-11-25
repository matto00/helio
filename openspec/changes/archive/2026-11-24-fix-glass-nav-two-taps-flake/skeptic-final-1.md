## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD: e0cd97d9155bf9db08069ebb4417886f72dfe3d8. Base resolved live with resolve-review-base.sh: 665ceb96f415e875d2e955937b0b2af3f79dfa81.
The only non-change-dir file in the diff is `e2e/support/hel1583-glass-nav.ts` (+4 lines: one `expect(...).toBeVisible()` wait and a 3-line comment).

### What I verified (with evidence)

**Root cause (H1, React Router transition trailing the URL). I checked it in the source as well as the probe.**
- `frontend/src/main.tsx:114` uses `BrowserRouter`. In the installed react-router 7.18.6 (`node_modules/react-router/dist/development/chunk-YDNE64FV.mjs` ~10571-10581), `BrowserRouter` subscribes to `history.listen` and applies each location with `React.startTransition(() => setStateImpl(newState))` unless `useTransitions === false`. The app does not pass that prop. So `history.pushState` (the URL) is synchronous, while the location render is a transition that can be interrupted. Under CPU load the URL leads the committed tree. That is the mechanism.
- The tab state comes only from the router location. `BottomNav.tsx:21` calls `useLocation()`, and `isDestinationActive(tab, pathname)` is called on every tab. It reads no store or memo, which rules out H2. `ChatPage` is a static import (`AppRoutes.tsx:4`, route at :128) and is not lazy, so no chunk Suspense is involved. BottomNav and the `<Outlet>` share one router state, so they commit in the same React commit. The design's D3 test-side branch is therefore correct: during the window the user sees the previous page together with its own current tab, which is not a wrong state.
- probe-timeline-4x.txt is consistent with this. Six runs each show `pushState path=/chat cur=[Dashboards=page]`, followed about 150 ms later by a single mutation batch with `cur=[]`. There is no intermediate frame. One caveat, which the evaluator also noted: the probe's `h1` is the AppShell sr-heading, not ChatPage content, and `dialog` queries `[role=dialog]`, which never matches a native `<dialog>`. So the probe alone does not prove that ChatPage content and the tab commit together. The source-level argument above does prove it.

**The wait condition cannot be satisfied early.**
- `<main id="app-main-content">` spans `App.tsx:270-302`. `QuickLauncherOverlay` is mounted at `App.tsx:366`, outside `<main>`. It uses a native `<dialog>` with no portal. So the overlay's `MessageComposer` (aria-label "Message", `MessageComposer.tsx:160`, reached through `ActiveConversationPanel.tsx:283`) is never inside `main`.
- The only other path to a "Message" textbox in `main` is `ChatPage.tsx:104`, which renders `ActiveConversationPanel`. That exists only after the `/chat` location has committed. In that same commit BottomNav has re-rendered with `pathname=/chat`.
- The evaluator's live landmark check (`.concertino/scratch/HEL-1701/eval/eval-landmark.txt`) agrees: the count is 0 on /dashboards, 0 in main with the overlay open, and 1 in main after navigation.

**Residual race in the remaining assertions.** None found.
- After the wait, `navGeometry` is a single evaluate of a tree that is already committed.
- The current state of each tab is a pure function of the pathname. Every path matching `/chat`, including a possible later `/chat/:id`, belongs to no tab.
- The test makes no other assertion after the wait.

**Evidence credibility.** I re-ran it myself on the lane DB `helio_hel1701` (dev port 7133, backend 10040, `ANTHROPIC_API_KEY` empty, 2 workers, `nice -n 19`), using the committed throttle wrapper from a scratch config. Nothing was written to the worktree, and `git status` shows only the untracked evaluation-1.md.
- Mutation (helper copy with only the added wait line removed, confirmed by `diff`), 4x CPU, dark: **5 failed / 5 passed**. Every failure is the CI failure mode: the received Dashboards tab has `"current": "page"`. Output: `/home/matt/Development/helio/.concertino/scratch/HEL-1701/skeptic/sk-mut-4x-dark.txt`.
- Fixed test, 4x CPU, dark: **10/10 pass** (`.../skeptic/sk-fixed-4x-dark.txt`).
- Fixed test, 4x CPU, light: **10/10 pass** (`.../skeptic/sk-fixed-4x-light.txt`).
- Three independent mutation runs gave 5/10 (mine), 7/10 (evaluator) and 10/10 (executor). Together with the executor's unmodified red of 5/10, this is consistent with p ≈ 0.5-0.7 at 4x. At p = 0.5, 20 green runs on the fixed test happening by chance has probability about 1e-6, and the combined fixed-test runs (executor 20, evaluator 30 at 4x/6x, mine 20) are all green. I accept the executor's and evaluator's warm 40/40 and full-file 30/30 as pasted output, which is consistent and unambiguous.

**Acceptance criteria**
1. Met. The probe output is committed. ci-artifacts.txt states that the failed attempt's artifacts are absent: run 45488894333's artifacts are from the passing rerun, and 39830913828 has none.
2. Met. red-throttled-4x.txt (5/10 at 4x) is committed in 3e542e947, before the fix commit e0cd97d91.
3. Met. The fix is in the test, per D3. It adds no timeout, retry, `expect.poll` or flake-list entry, and the assertion is unchanged.
4. Met. The executor recorded 40/40 warm and 20/20 at 4x, and I reproduced 20/20 at 4x.
5. Met. The mutation runs are red (committed 10/10, and my 5/10).
6. Met (same test, established at Setup).
7. Delivery-phase check. It cannot be verified at this gate.

UI review: no `frontend/**` change, so this step does not apply.

### Verdict: CONFIRM

### Non-blocking notes
- root-cause.md could note that the probe's `h1` field is the AppShell heading and that `dialog=` is always false for a native `<dialog>`. It could also cite `BrowserRouter`'s `startTransition` wrapping as the source-level proof of the atomic commit.
- The PR should report the mutation red rate as a range (5/10 to 10/10 across three independent runs), not 10/10.
