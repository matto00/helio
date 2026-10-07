## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD `6144e5eee5a6bba989bc6dbcfb874e77f0dc585f`. Base resolved live with `resolve-review-base.sh` and
exit-checked: `a606a9833`. `git diff a606a9833 origin/main -- e2e` is empty, so `origin/main` (now at 5f3990f8e) has
not touched `e2e/` since the base, and no new local copy appeared upstream.

### What I verified (with evidence)

- **Spawn-cwd guard:** `READY ambient=/home/matt/Development/helio branch=task/guard-spec-live-isolation/HEL-1330`.
- **AC1, isolate -> seed -> `goto("/")` -> `evaluate`** (`e2e/focus-presence-guard.spec.ts:149-239`). The order is
  register (`registerUser`), cookie handoff, `goto("/")`, "Add dashboard" wait, `isolateLivePage`, then the API seed
  (dashboard, source, pipeline; payloads unchanged in the diff). After that comes `goto("/")`, the seeded-dashboard
  marker wait, theme `page.evaluate` on an app origin, `goto(route)`, and the `data-theme` assertion. C3 holds: no
  `evaluate`, `reload` or localStorage step runs between the isolate and the next app-origin `goto`.
- **`state-surface-contrast-guard.spec.ts` `newCell`:** `isolateLivePage` runs first. Between it and the first
  `goto("/")`, the only steps are seeding and `addInitScript`, with no `evaluate`. Grepped lines 545-620 for
  goto/evaluate/addInitScript/localStorage/reload. The ticket's own premise notes say this file never seeded while
  live, so keeping `addInitScript` instead of a literal `evaluate` is a justified, documented deviation
  (design.md D2, README).
- **AC2, population unchanged.** I ran both guards myself, once, with `--repeat-each 2 --workers 2` under `nice -n 19`,
  headless, against this worktree's own servers. I confirmed both servers belong to this worktree: the listener PIDs'
  `/proc/<pid>/cwd` is this worktree's `frontend/` and `backend/`. Result: **56 passed (4.7m), EXIT 0**.
  - I compared the `[HEL-520 focus-presence guard] view …` and `[HEL-866 guard] view|elements probed|cell …` lines
    with the lane's `main-baseline.log`. The sets are identical (73 distinct lines each), and so are the counts
    (main count × 2 == my count, per line).
  - The baseline really is main's spec code. It has 0 `throwaway user` lines, while the branch runs have 1 per cell.
    The shared helper adds that line and main's guards never logged one. This content difference is the
    authentication; it does not rely on mtime ordering.
- **AC3, `--repeat-each 10`.** I did not re-run 10 repeats. The lane's `branch-repeat10.log` was run on 27b860d16.
  Since then, 6144e5eee only moved `uiLogin` into `isolateLivePage.ts`, and the guards do not call it. I take that log
  as corroborated by my own 2-repeat run (0 failures).
  - **Green CI under the 4-leg sharding cannot exist before the PR is pushed. That part of AC3 is still outstanding**
    and must be checked at merge (the auditor's merge-readiness step).
- **AC4, consolidation.**
  - No local `registerAndLogin`/`registerUser` function is left in `e2e/`. Grep shows only hel503's thin
    `registerAndLoginWithDashboard` wrapper, which calls the shared helper, and in-scope-excluded inline
    `uniqueEmail` users that never defined `registerAndLogin`.
  - I checked every file against its base copy with a script. Domain, prefix, displayName, `isolate`,
    `waitForShell`, logging and return values all match. The 15 removed `isolateLivePage(` calls map one-to-one to the
    15 files that pass `isolate: true`.
  - hel1260, hel1275, hel1023 and hel1028 keep their own extras at the call site.
  - hel910 still registers on `page.request`, because `const request = page.request` is in place, so the shared cookie
    jar is preserved.
  - The only added non-mechanical lines are the guard reorder, the re-emitted per-file log lines, and the hel1275
    `/api/auth/me` check, which moved to the call site. I found no change to an assertion, threshold, timeout, skip or
    retry.
- **README:** `e2e/README.md` has the new "Auth and live-page isolation helpers" section. It covers the race, the
  `isolateLivePage` hazard, `loginThenIsolate`, `registerUser`/`registerAndLogin` options, and guard ordering.
- **Migrated specs actually exercised:** I ran all 27 default-collected migrated files once at `--workers 2` under
  `nice -n 19`. Result: **132 passed (5.2m), EXIT 0**, with no skipped or failed tests. hel909/hel968 are quarantined
  and the two `*.regression.spec.ts` harnesses are excluded by `testIgnore`. Those four are covered only by the
  type-check and my per-file mapping check, as disclosed.
- **Static gates (re-run myself):** `npm run lint` passed with zero warnings, `npm run format:check` reported "All
  matched files use Prettier code style!", and `npm run check:e2e-types` exited clean.
- **Scope:** the diff touches only `e2e/**` and the change dir. There is no product, `playwright.config.ts` or
  workflow edit.
- **UI/design judgment:** not applicable, since nothing under `frontend/` changed.

### Verdict: CONFIRM

### Non-blocking notes

- The 4-leg sharded CI run is the one AC item that is still unmeasured. The merge gate must observe it green; this
  CONFIRM does not cover it.
- `evaluation-2.md` is untracked in the worktree. Commit it with the delivery artifacts if the change dir is meant to
  be complete.
- My guard runs registered 56 more throwaway `hel520-`/`hel866-` users and the migrated run registered more. They are
  in my scratchpad logs (`guards.log`, `migrated.log`). I deleted nothing.
