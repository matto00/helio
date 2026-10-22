## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD: e0ea28f77efbf5df2f8022831f9ff85347240e56 (fix 5ea40978e + planning-artifacts commit).
Base, resolved live: edfd329c82f448874972cc3ea29bce8363905ad9.
Code diff: `e2e/hel516-palette-quick-create.spec.ts` only. Everything else is under `openspec/changes/palette-order-test-boot-budget/`.

### Phase 1: Spec Review — PASS
Issues: none blocking.

- AC "shown failing first, then passes 40/40 under throttle" is met. At 6x, the unchanged test went red 40/40 (`red6.log`: `40 failed`, exit=1). Every failure was the 30 s test timeout: 34 at the `openPalette` call (:250) and 5 inside `registerAndLogin` (:249). So the orchestrator's summary "first error at openPalette" is accurate for 34 of 40 runs. All 40 are the same budget overrun the ticket's premise validation found in the CI trace. The fixed test passed 40/40 at 6x, 4x and 2.5x (`green6/green4/green25.log`, maximum durations 25.4/15.9/14.8 s, as claimed).
- Is the red/green pair genuine? Yes, as a test of the budget. CDP throttle slows only the renderer, so 6x stands in for a slow runner rather than reproducing CI. It is used the same way for red and green (same `run.sh`/`throttle.cjs`, C2). At 2.5x the old test's maximum was 21.2 s against 14.8 s after the fix. At 4x it was 23.7 s against 15.9 s. That is the per-boot cost reduction the design predicts.
- The ticket's triage step 2 hypotheses (a readiness race, a missed keybinding) are refuted by the premise validation, and the fix is correctly a budget fix. Nothing was reinterpreted.
- AC "CI is green on main" can only be checked after merge. It is not checkable here.
- All tasks are marked [x] and match the evidence on disk. No scope creep.
- CONSTRAINTS C1 and C2 are honored (see Phase 2).

### Phase 2: Code Review — PASS
Gates, fresh, run in the worktree on the changed files:
- `eslint --max-warnings=0 e2e/hel516-palette-quick-create.spec.ts`: clean.
- `prettier --check` on the spec and the change dir: clean.
- `tsc --noEmit -p e2e/tsconfig.json`: clean.

No `frontend/**` or `backend/**` changes, so the jest, build and sbt gates are not triggered.

Fresh e2e evidence: I re-ran the fixed test with `--repeat-each=40 --workers=2` at 6x, under the e2e lock, at nice 19, with trace retain-on-failure. Result: **40 passed** (exit 0). There were 200 `[throttle] applied rate=6` lines (5 contexts x 40). Durations were p50 22.3 s and max 23.8 s. Log: `/home/matt/Development/helio/.concertino/scratch/HEL-1689/eval-green6.log` (sha256 a126e73a0a370461bc0faf4614d7f249d078d762123ac80193f37542f2bb5b79).

The orchestrator's specific checks:
1. **5 independent real-browser boots, each asserting the declared order.** The loop runs 5 iterations (spec.ts:251). Each one does `browser.newContext({ storageState: { cookies, origins: [] } })` with a fresh API-registered user's cookie, so localStorage is empty and the session is new each time. Each iteration opens `/dashboards`, waits for the shell, then runs the unchanged `openPalette`. The declared-order assertion is unchanged (`toEqual(["Navigation","General","Create"])` per order, spec.ts:277-279). The mutation log is genuine: `mutation.log` shows `1 failed` at spec.ts:278:21, with received `["General","Navigation","Create"]`. `git status` is clean, so no app change was left behind. The throttle counts confirm the per-iteration contexts were actually created. The old test shows 1 page per test (40 applied lines). The new one shows 5 per test (200).
2. **No retries and no timeout increases (C1).** The diff touches no timeout, `setTimeout`, `slow` or poll value. `openPalette`'s 10 s poll is unchanged. `playwright.config.ts:139` has `retries: 0`. The throttle harness lives only in scratch and is not committed (C2).
3. **Context closed and user recorded.** Each context is closed in `finally` (spec.ts:264-266). `registerUser` calls `recordRegisteredUser(res)` (`e2e/support/auth.ts`). The logs show `deleted 200 recorded throwaway user(s)` per 40-run batch.
4. **`files-modified.md`** lists 3 paths explicitly, with no globs. See the non-blocking note below.

Quality: the change is minimal and uses the existing `registerUser` helper. The comment states the reason for the budget fix. Nothing is dead or over-engineered.

### Phase 3: UI Review — N/A
This is a test-only change. No trigger paths match (`frontend/**`, ApiRoutes, `schemas/**`, `openspec/specs/**`). The real-browser e2e runs above are the behavioral evidence.

### Overall: PASS

### Change Requests
None.

### Non-blocking Suggestions
- `files-modified.md` omits the planning artifacts committed in e0ea28f77: `.openspec.yaml`, `design.md`, `proposal.md`, `skeptic-design-1.md` and `ticket.md`. Those were authored by the orchestrator, not the executor. If CON-260 is meant to cover every path in the branch diff, add them before delivery.
- At 6x the fixed test still runs at p50 about 22 s. It has real headroom at realistic slowdowns, but it is not unbounded. If CI times climb again, the next lever is fewer boots or a cheaper shell wait, not a larger timeout.
- The throttle harness applies `setCPUThrottlingRate` asynchronously after the page is created, so the first navigation can begin before throttling takes effect. This affects red and green equally and does not undermine the comparison.
