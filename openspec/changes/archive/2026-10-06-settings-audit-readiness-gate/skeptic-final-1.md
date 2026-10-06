## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD `1f03a375cb24e8d6044d771a249e1dc187a74ded`. Base was resolved live with `resolve-review-base.sh` (origin/main) to `b16bfa1b3`. Spawn-cwd guard: `READY`.

### What I verified (with evidence)

- **Diff scope.** `git diff b16bfa1b3...HEAD` touches only `e2e/support/settingsReady.ts` (new, 22 lines), `e2e/hel813-mobile-touch-target-floor.spec.ts` (+1 import and +1 helper call after each of the two `page.goto("/settings")`, at l.147 and l.176), and the change dir. None of the forbidden files are touched: the two guard specs, ci.yml, playwright.config.ts, .gitignore and package-lock. No assertion, selector, viewport or timeout changed.
- **AC1, inventory.** I ran my own grep: case-insensitive `settings` across `e2e/**/*.ts`, excluding panel-settings dialogs. The only `/settings` route users are the two out-of-scope guard specs, `hel813-mobile-touch-target-floor.spec.ts` (2 sites, now gated) and `hel813-...regression.spec.ts:194`. The regression spec is excluded under design D3 because it mutates tracked CSS, which makes a 2-worker repeat run invalid. That exclusion is justified and recorded. No spec reaches `/settings` through a UI click. This matches design.md's table.
- **AC2, helper.** It is correct against the real markup:
  - `SettingsPage.tsx` wraps "Audit history" in its own `<section>` with an `<h2>`.
  - `AuditHistorySection.tsx` renders loading `<p>`, then error, empty or `AuditEventTable`.
  - The table uses `SortableTable`/`SortableTh`, whose button class is `sortable-th__btn` (`SortableTh.tsx:34`).
  - There is no timeout literal and no hard-coded column count.
  - Failing closed on the empty and error branches (D2) is sound, because every e2e user has an `auth.register` event.
- **The helper is needed (independent re-run).** I ran the executor's probe source, diff-identical to the persisted copy, against 6768 with 2 workers under nice 19:
  - **Delayed (1500 ms < 5 s, C2), assert at heading:** 4/4 failed. At the heading there were `sort=0, interactive=14`; once settled there were `sort=5, interactive=28`. Log: `scratchpad/hel1336-sk-probe-red.log`.
  - **Natural race:** I relied on the persisted logs and did not re-run it. `hel1336-probe-natural-red.log` shows 2/20 iterations with `sort=0/14` at the heading vs 5/28 settled. The natural-green log independently shows another 2/10 with `sort=0` at the heading, with the helper bringing both to 5/28. That makes the natural race real, though rare (about 10%).
- **The helper fixes it.** Delayed, asserting after the helper: 4/4 passed, with 5/28 after the helper, equal to the settled count. Log: `scratchpad/hel1336-sk-probe-green.log`.
- **Mutation goes red.** Helper body emptied (the persisted mutant), delayed: 4/4 failed, with `sort=0` after the helper. Log: `scratchpad/hel1336-sk-probe-mut.log`.
- **AC4, repeat run.** Executor log `hel1336-repeat-hel813.log`: `Running 140 tests using 2 workers`, `140 passed`, `exit=0`, and 140 throwaway-user lines. My own fresh run, `--repeat-each 2 --workers 2` under nice 19 with DEV_PORT=6768, gave `28 passed`, exit 0 (`scratchpad/hel1336-sk-spec-repeat.log`).
- **AC3, unchanged assertions and timeouts.** Confirmed from the diff, which only inserts the call lines.
- **Static gates (fresh run).** `npm run check:e2e-types` exit 0. `prettier --check` and `eslint --max-warnings 0` on both files exit 0.
- **Executor residue (verified against the live DB):**
  - All 200 recorded user ids, the 40 dashboard ids and every data_sources row owned by those ids are now 0.
  - The 200 emails taken from the repeat and probe logs match the recorded csv exactly; no logged user was missed.
  - `email like 'hel1336-%'` returns 0.
  - The evaluator's 14 recorded users and their data_sources are also 0.
  - `matt@helio.dev` is still present.
- **My own residue:**
  - I created 40 users (12 from the probe, 28 from the spec run). I resolved them by exact email to ids (`scratchpad/hel1336-sk-user-ids.csv`), plus 8 dashboards (`hel1336-sk-dashboard-ids.txt`) and 4 data_sources (`hel1336-sk-ds-ids.txt`).
  - Before deleting, I checked every NO ACTION FK onto users, which showed 0 dependents beyond dashboards and data_sources.
  - I deleted them by those ids in a single transaction, and all now read 0.
  - A sweep of every public uuid column finds only `audit_events.actor_user_id` (96 rows). These cannot be deleted because of the HEL-471 append-only trigger, the same category the executor disclosed.

### Verdict: CONFIRM

### Non-blocking notes
- D3 says plainly that the two hel813 call sites are defensive. Neither measured element (the swatch row above the audit section, and the fixed-position toast close) is known to be displaced by the late table today. This matches the ticket's "may not" framing; I am not treating it as a defect.
- `.npm-cache/` is untracked in the worktree (not committed, not ignored). Keep it out of any `git add -A`.
- No UI changed (e2e tooling only), so the design-standard and screenshot review does not apply.
- None of my evidence depends on mtime ordering. Every claim rests on log content: RESULT JSON lines, pass/fail counts, exit codes and DB counts.
