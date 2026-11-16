## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD: 0d50e4e4d1c9610920430e2b691700ef77d99dcd. Live base from `resolve-review-base.sh`: d9c6585a8c939c2d8148d0a1af9943006aa01a96.

### What I verified (with evidence)

- **Cwd guard:** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=bug/dashboard-tabs-e2e-flakes/HEL-1644`.
- **Diff scope:** `git diff --stat d9c6585a8...HEAD`. The only code file is `e2e/hel1575-dashboard-tabs.spec.ts` (+35/-1). Everything else is in the change dir. There is no `frontend/` or `backend/` change, so no UI review is needed (step 4 skipped).
- **Owner ruling is real:** `.concertino/runs/HEL-1644/events.jsonl` has `escalation.raised` and `escalation.answered` for id `HEL-1644-1794868395608-9b1f82`. The answer is `force-race-B-and-close-A`, with `answer_source: "human"` and `resolution_channel: "cli"`. design.md Decision 9 matches it.
- **AC 1 (failing first, then 40/40):**
  - Test A's failing-first AC was dropped by the owner ruling. Closure is recorded in repro.md along with the 340-run, 0-failure measurement. This is accepted on the ruling. I did not re-measure test A.
  - Test B was shown failing first through the forced race. The persisted `/home/matt/Development/helio/.concertino/scratch/HEL-1644/forced-red.log` shows `10 failed`, each with `page.evaluate: Execution context was destroyed` at `warmEntryCount` (spec:210), called from the poll generator (spec:680, the unfixed form). This is the same error and the same frame as the CI log quoted in repro.md (run 38987195427, `generator ... :634`).
  - I re-ran these fresh against my own servers (start-servers.sh 7076/9983, then `assert-phase.sh servers` printed `PASS servers`):
    - Forced test (`-g "already-expired session" --repeat-each=20 --workers=2`, nice 19, trace retain-on-failure): **20 passed (1.2m)**, load 3.3.
    - Real test B (`-g "logout clears the browser-stored warm copy" --repeat-each=40`): **40 passed (2.3m)**, load 6.0.
    - Whole spec once: **22 passed (5.4m)**.
- **AC 2 (seam test if app defect):** Not triggered, and I checked the claim against the code. `httpClient.ts:31-43` dispatches `auth/clearAuth` and then calls `navigate("/login")` on any 401 except `/api/auth/me` and `/api/auth/mfa`. `main.tsx:32` hard-navigates only when `pathname !== "/login"`. `warmListeners.ts:204-210` runs `clearWarmState` on `clearAuth`. So the hard navigation is designed behavior, and the warm clear happens on both the logout path and the 401 path. The flake is a test race, not a privacy defect.
- **The fix respects C1:** `warmEntryCountAfterSignOut` catches only errors whose message contains `Execution context was destroyed` and maps them to -1, which is not 0, so the poll keeps going. Every other error is rethrown. There is no sleep, no timeout change, no test retry and no skip. A pass still needs a real 0 to be read. This is a narrow tolerance of a known transient inside the existing poll, not masking. It satisfies the ruling's "wait for navigation to settle": the assertion is made in the settled document.
- **The kept regression test is not vacuous on the 401 path:** in the forced test only `/api/auth/logout` is faked to return 401, so the server session stays valid. In the new document, `rehydrateAuth` gets a 200 from `/api/auth/me` and does not dispatch `clearAuth`. The 0 it reads therefore comes from the old document's `clearAuth`/`awaitWarmClear` path, not from a boot-time re-clear.
- **Gates (all fresh, exit 0):** `eslint --max-warnings=0` on the spec; `prettier --check` on the spec and the change-dir .md files; `npm run check:e2e-types`; `check:e2e-user-cleanup` (clean, 140 files); `check:e2e-evidence-paths` (clean). The worktree is clean apart from the untracked `evaluation-2.md`. Servers were stopped with `stop-servers.sh` (`STOPPED ports=7076,9983`).
- **Evidence integrity:** none of the claims above depend on mtime ordering. The red evidence is the content of the log (error text and line numbers). The green evidence is my own fresh runs.

### Verdict: CONFIRM

### Non-blocking notes

- In the *real* test B, if a hard navigation happens, the new document's `rehydrateAuth` gets a 401 from `/me` (the session really ended) and runs `clearAuth`, which clears the warm copy again. On that path a 0 can come from the boot-time re-clear rather than from logout's own clear. The forced test covers the logout-path property, so this does not block. The evaluator's optional app-mutation probe (drop the clear on the 401 path, expect the forced test to go red) is still the cheapest way to make that guarantee explicit.
- If a destroyed context ever repeats indefinitely (for example a redirect loop), the poll will time out showing "received -1" instead of the navigation error. The failure still surfaces, just with a less specific message.
- The CI trigger (a sibling in-flight request returning 401 before the pushState) is inferred, not observed. repro.md says so honestly. The fix handles any trigger of the same mechanism.
