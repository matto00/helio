## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed tree: 3fa325155ea67b61f7bab6b31efd9db416192d41 (worktree HEAD; the change dir is untracked planning artifacts).
The owner ruling (8th leg, no timeout raise, no paid/larger runner) is taken as settled and not re-litigated.

### What I verified (with evidence)

- **Spawn cwd**: `assert-cwd.sh` -> `READY ambient=/home/matt/Development/helio branch=task/e2e-eighth-leg/HEL-1793`.
- **ci.yml e2e job state matches design Context**: `.github/workflows/ci.yml:612` `runs-on: ubuntu-24.04`, `:620`
  `timeout-minutes: 25`, `:631` `max-parallel: 7`, `:633` `shard: [1, 2, 3, 4, 5, 6, 7]`; backend matrix is
  `shard: [0, 1, 2, 3]` (`:218`), so "backend 4 + e2e 8 = 12" is arithmetically right. `ci-complete` `needs:` includes
  `e2e` (`:912`). No `paths`/`paths-ignore` on the triggers (`:3-7`), so the planned empty measurement commits do run
  the e2e matrix; `cancel-in-progress` is true for `pull_request` (`:17-18`), confirming D4's one-at-a-time rule.
- **e2e-shard.mjs / selftest**: `DEFAULT_E2E_LEGS = 7` (`scripts/e2e-shard.mjs:234`), `EXPECTED_SHARD_REPORTS =
  DEFAULT_E2E_LEGS` (`:235`), `plan` default (`:416`); selftest asserts matrix length AND `max-parallel` equal the
  constant (`scripts/e2e-shard.selftest.mjs:208-224`). Both mutation directions in D2/1.2 would go red.
  `check:e2e-shard:selftest` and `check:ci-complete-needs:selftest` exist in `package.json:61,35`.
- **D3 run list (gh API)**: all 8 are `CI` / `push` / `main`, attempt 1, newest-first, matching first-parent main
  history 87cf01a5f..3fa325155; 44854332613 is `in_progress` (design correctly says wait). HEL-1735 (31094b154) is an
  ancestor of every listed head; its own run 44731177734 failed and is correctly absent.
- **Artifacts present per leg**: run 44845120888 has `playwright-json-shard-1..7` and `e2e-runner-shard-1..7`; job
  names are `e2e (1)`..`e2e (7)` plus an `e2e-prod-build` job (the measurement filter must exclude it; HEL-1789's
  `measure.mjs:10` regex `^e2e \(\d\)$` does, and still matches `e2e (8)`). Slowest leg on that run: `e2e (3)`
  00:38:07 -> 00:59:59 = 1312 s, so a red "before" exists as claimed.
- **HEL-1789 measurement scripts**: exist only in the main checkout `.concertino/runs/HEL-1789/evidence/measurement/`;
  7 is hard-coded at `measure.mjs:11,27` and `lib.mjs:55` (D4 says adapt these). `lib.mjs:54-56` `counting` checks only
  report count and unexpected/flaky = 0, not runner-record presence, which D4's counting rule adds (executor must add it).
- **Slow-host estimate**: HEL-1789 `after.md` rows show slowest test step 1116-1126 s, its setup 168-170 s; D's
  170 + 1120 x 7/8 = 1150 s is arithmetically correct.
- **Spec delta**: MODIFIED header matches `openspec/specs/e2e-ci-sharding/spec.md:87` exactly; both existing scenarios
  are retained (the "slower than 20 minutes" one extended) and one is added. No data loss on archive.
- **Leg-count references in the tree** (`git grep`, excluding archive/this change): ci.yml:619,622,633, e2e/README.md:140,146,
  playwright.config.ts:192, scripts/e2e-shard.mjs:231,234 — all named by the plan — plus two the plan does NOT name
  (below).

### Verdict: REFUTE

The plan is close and the measurement method is honest, but its own stated goal ("every artifact keyed to the leg
count agreeing") is not met by its file list, and the task that is supposed to verify it would pass falsely.

### Change Requests

1. **Leg-count sites missing from the plan.** Add to proposal Impact, design D1 and task 2.3:
   - `MISTAKES.md:211` — "HEL-1772 to 7 by owner ruling, so backend 4 + e2e 7 = 11 parallel jobs". This is the
     repo's binding trap list and states the count and the job total; after this change it is wrong.
   - `.github/workflows/ci.yml:857` — "expects exactly one report per e2e shard leg (6 by default)" (already stale at
     7; this change is the natural point to fix it, and D1 claims every ci.yml comment that states the count).
2. **Task 2.3's verify signal cannot catch them.** The grep patterns "7 legs", "7 since", "default 7" match neither
   `e2e 7 = 11`, `HEL-1772 to 7`, nor `(6 by default)`. Replace with an explicit enumerated list of every site (file:line
   as above plus the already-named ones) that the executor checks one by one, or a broader pattern set (e.g.
   `e2e 7`, `= 11`, `by default)`, `to 7`), and state the expected zero-hit result.
3. **Run cap vs counting floor is undefined.** D4/5.1 cap the after-measurement at 6 runs ("AC + 1") but say nothing
   about what happens if 2+ of those 6 are non-counting (flake rerun on a mixed attempt, a cancelled run, a missing
   runner record). State the rule: e.g. stop at the cap and report the counting shortfall as a gap / raise an
   escalation, or allow more runs up to N. As written, a competent executor could either exceed the cap or ship with
   fewer than 5 counting runs.
4. **The retained "Headroom measured on main" scenario has no owner.** The spec keeps a SHALL that needs 5 consecutive
   all-green MAIN runs after the leg-count change, which cannot be observed before merge. Say in design (Risks or D4)
   that this is a post-merge watch, who performs it (driver/orchestrator after merge), and where the result is
   recorded, as HEL-1698's "post-merge watch" did — otherwise the delivered change silently leaves a SHALL unmeasured.

### Non-blocking notes

- D2 says the second mutation is "constant 8 with max-parallel 7"; task 1.2 says "mutate only max-parallel" (i.e.
  max-parallel 8, constant 7). Both go red; pick one wording.
- Task 1.1/D4 should give the absolute source path of HEL-1789's scripts (main checkout
  `/home/matt/Development/helio/.concertino/runs/HEL-1789/evidence/measurement/`); they are not in the worktree.
- D4 should note the HEL-1789 `counting()` does not check runner-record presence and must be extended to match the
  stated rule; and the "before" list wording ("after HEL-1789") should say whether HEL-1789's own merge run
  44786301818 is eligible (it is in the D3 list).
- D3 "(C: coordinate by merging ...)" has a stray "C:". "Regenerate the same way" after a HEL-1649 merge needs a
  counting main run that contains HEL-1649's specs; say so, or accept them defaulted and name them.
