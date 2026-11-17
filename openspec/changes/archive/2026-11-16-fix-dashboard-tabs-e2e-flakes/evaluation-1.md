## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed commit: 8e69aeb34bbf895848f83e19e0b42bd954a6dd2d. Live base: d9c6585a8 (resolve-review-base.sh).
Diff: `e2e/hel1575-dashboard-tabs.spec.ts` (+35/-1) plus change-dir artifacts. No `frontend/**`, `backend/**`,
`schemas/**` or `openspec/specs/**` change.

### Fresh evidence (evaluator's own runs; servers via start-servers.sh 7076/9983, `assert-phase.sh servers` PASS)

All runs used `DEV_PORT=7076 BACKEND_PORT=9983 nice -n 19 npx playwright test e2e/hel1575-dashboard-tabs.spec.ts ... --workers=2 --trace retain-on-failure`.

| run | tree | result |
|---|---|---|
| forced-401 regression test, `--repeat-each=20` | HEAD | 20 passed (1.2m), load 1.3 |
| the same forced test with its poll reverted to the unfixed `(await warmEntryCount(page)) ?? 0` | throwaway detached worktree at HEAD, removed afterwards | **10 failed of 10**: `page.evaluate: Execution context was destroyed, most likely because of a navigation` at `warmEntryCount (:210)` / `Object.generator`. That is the same error and the same frame shape as CI run 38987195427 |
| real test B "logout clears the browser-stored warm copy", `--repeat-each=40` | HEAD | 40 passed (2.2m), load 3.4 |
| whole spec file once | HEAD | 22 passed (5.4m) |
| eslint `--max-warnings=0` and prettier `--check` on the spec and the change-dir .md files; `npm run check:e2e-types` | HEAD | clean |

The worktree's `git status` was clean after every run, and the throwaway worktree is gone from `git worktree list`.

### Phase 1: Spec Review — FAIL

- Test A closure (C4/Decision 9) is recorded in repro.md with the 340-run record and the owner ruling. PASS.
- Test B forced red, test fix, forced green and 40/40 are all present, and I reproduced each one independently. PASS on substance.
- C1, C2 and C3 are honored. There is no retry, no timeout change and no skip/fixme. Every recorded run uses workers 2, nice and explicit ports.
- **Issue: the forcing setup departs from the owner ruling without saying so, and repro.md overstates how faithful it is.**
  - What the owner described, recorded in tasks.md:38 as 5.1, was: hold an in-flight API response until after the SPA pushes /login. As written, that setup **cannot** produce the navigation. The interceptor callback in `frontend/src/main.tsx:32` calls `window.location.assign("/login")` only when `window.location.pathname !== "/login"`. A 401 processed after the pushState is therefore a no-op.
  - What the executor built is different and correct. Logout's own request answers 401 while the pathname is still `/dashboards/...`. The interceptor calls `assign`, the thunk continues, the AppRail `navigate("/login")` pushState resolves `waitForURL`, and then the hard navigation commits. This is the same mechanism CI hit: the interceptor's hard navigation starts before the SPA's pushState and commits after it. The trigger is different. In CI the logout POST had a valid session, so the 401 almost certainly came from a sibling in-flight request (for example, the change-signal poll or a rows fetch) that reached the server after the session ended and before the pushState. `awaitWarmClear`'s window of up to 1 s sits between those two events.
  - I checked the attribution by grep. On this path, the only programmatic hard navigation in `frontend/src` is `main.tsx:33`. `ErrorBoundary` reload is click-only and the login/register `href` assignments are click-only. The `dev` Playwright project has no service worker (`devOptions.enabled: false`), so the PWA autoUpdate reload is ruled out. The `main.tsx` interceptor and the logout thunk are identical at d777803c1. repro.md records none of this reasoning.
  - The result: tasks.md 5.1 is ticked against a setup that was not used. repro.md:64 claims the kept test "covers the path that produced the CI failure", but it covers a sibling path into the same mechanism. Of the two artifacts the owner reads, one does not match the ruling and the other overstates the evidence. This is the "AC silently reinterpreted" and "planning artifacts reflect final behavior" items.

### Phase 2: Code Review — PASS

Gates: the changed files match neither `frontend/**` nor `backend/**`, so none of the listed gate sets trigger. I ran the applicable ones myself on the changed spec (eslint, prettier, e2e tsc) and all are clean.

**Does `warmEntryCountAfterSignOut` remove the race or mask a failure? It removes the test race without masking anything (C1 holds):**
- It remaps only `Execution context was destroyed`. Every other error still throws (`e2e/hel1575-dashboard-tabs.spec.ts:240-247`).
- The asserted state is the `helio-warm` IndexedDB, which is scoped to the origin and survives the navigation. A re-read in the settled `/login` document checks the same storage the old document would have read. It is not a weaker or different check.
- -1 is never 0, so a context that kept being destroyed, or a store that kept entries, still times out red at the default poll timeout. There is no timeout change and no test retry. `expect.poll` does not retry a throwing generator (CI and my 10/10 red both prove this), so without the helper the poll fails on the first transient. With it, the poll polls, which is its intended job.
- Decision 9 said "wait for navigation to settle before page.evaluate". An unconditional `waitForEvent`/`waitForLoadState` cannot do that in the real test: the hard navigation happens only when a 401 lands in the window, so it is non-deterministic, and waiting for one that never comes would hang. Tolerating the transient and re-reading is the correct equivalent.

**Does the kept regression test pull its weight? Yes.** It is deterministic: 10/10 red without the helper and 20/20 green with it. It costs about 2.3 s, and it is the only thing that keeps the helper failable, because the real test B passes 40/40 to 340/340 with or without the helper. It also covers a real user path: a sign-out after the session expired still clears the warm copy, through the interceptor's `clearAuth` and the thunk's `awaitWarmClear`. Its weakness is that no app-side mutation shows it would catch a warm-clear regression on that path (see suggestions).

No dead code, no `any`, and the JSDoc on the helper states the mechanism.

### Phase 3: UI Review — N/A

No trigger path changed (`e2e/**` and `openspec/changes/**` only). I ran the e2e runs above as gate evidence, not as a Phase 3 UI review. Servers were stopped with `stop-servers.sh` (STOPPED ports=7076,9983).

### Overall: FAIL

Only documentation needs to change. The code change is sound and needs no edit.

### Change Requests

1. `openspec/changes/fix-dashboard-tabs-e2e-flakes/repro.md`, section "Test B: forced race": add a short paragraph, "Why this setup and not the ruling's literal one", covering three points:
   - (a) The interceptor navigates only while `pathname !== "/login"` (`frontend/src/main.tsx:32`), so a response held until after the SPA pushes /login never hard-navigates. The 401 has to land before the pushState.
   - (b) The forced test reaches that ordering through logout's own 401. CI's trigger was most likely a sibling in-flight request that hit 401 after the session ended and before the pushState (during `awaitWarmClear`'s window of up to 1 s). The trigger differs and the mechanism is the same.
   - (c) The attribution evidence: `main.tsx:33` is the only programmatic hard navigation in `frontend/src`, the `dev` project registers no service worker, and the interceptor and logout thunk are identical at d777803c1.
2. `repro.md:64`: change "covers the path that produced the CI failure" to say that the test forces the same hard-navigation-after-pushState mechanism through the logout request's own 401, and that CI's trigger request was a different in-flight call.
3. `openspec/changes/fix-dashboard-tabs-e2e-flakes/tasks.md:38` (5.1): replace the parenthetical "(hold an API response until after the SPA pushes /login)" with the setup actually used: "(fulfil `/api/auth/logout` with 401, so the interceptor's `window.location.assign` starts before the SPA's pushState; see repro.md for why the literal hold-after-push setup cannot navigate)".

### Non-blocking Suggestions

- The executor's forced RED 20/20 has no persisted log in `.concertino/scratch/HEL-1644/` (only `spec-with-probe.ts`). My run above (10/10 red) now covers that. Persisting the red log next to the green logs would make the record self-standing.
- Optional strengthening, not required: show the regression test going red under an app mutation on the 401 sign-out path. For example, drop `awaitWarmClear()` from the thunk and the warm clear from the `clearAuth` listener. That would show the test guards the privacy property as well as the helper.
