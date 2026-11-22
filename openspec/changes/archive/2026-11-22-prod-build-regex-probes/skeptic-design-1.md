## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed tree: HEAD c405b68179c46b59e3f7f06940e3acc5d2031999 (change artifacts untracked: ticket.md, proposal.md, design.md, tasks.md).

### What I verified (with evidence)

- **Spawn guard:** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=task/prod-build-regex-probes/hel-1816`.
- **Premise: the HEL-1691 lane already is "a separate project with its own web server".** Confirmed.
  - `playwright.config.ts:40-44,174-188`: `HELIO_E2E_PROD_BUILD` must be unset or `1`. With `1` the projects are `prod-build-guard` and `prod-build` (`grep: /@prod-build/`, service workers blocked). Unset gives only `dev` (`grepInvert: /@prod-build/`).
  - `.github/workflows/ci.yml:781-856`: the `e2e-prod-build` job runs `npm --prefix frontend run build`, then `npx vite preview --port 5173`, then `HELIO_E2E_PROD_BUILD=1 npx playwright test --project=prod-build`. `timeout-minutes: 8`, with the 196 s measurement cited in a comment. `ci.yml:913`: `ci-complete` needs `e2e-prod-build`, so the job is required.
  - `scripts/e2e-shard.mjs:267`: `SHARD_PROJECT_ARG = "--project=dev"`. Tagged tests leave the shard legs. Stale weight rows are reported and ignored (`:73,306`).
  - `package.json:64-71`: `check:e2e-prod-build-projects` (+`:selftest`) and `e2e:prod-build` exist. The checker counts tests by project generically and has no hard-coded list of tagged titles, so adding three tagged tests needs no checker edit (consistent with "no tooling change").
  - Existing users: `hel1631-draft-mode.spec.ts:183`, `hel1632-live-output.spec.ts:262`, both `{ tag: "@prod-build" }`. That is the form D1 adopts.
  - This premise is a real finding. D1's reuse is permitted by the ticket's "e.g." and stays inside "without moving the rest of the e2e suite".
- **Spec file contents match design.md's description.** `e2e/hel1683-regex-main-thread.spec.ts` has exactly three tests (lines 235, 342, 396), each with a `<= LONG_TASK_BOUND_MS (100)` assertion. Test 1 has control, probe and overrun windows plus LoAF `attribution(...)`. `HEL1808_CPU_THROTTLE` exists (`:218-225`, applied at `:252`), so D4's throttled run is executable.
- **D3 (no dev-build copy).** The claim is sound. A tagged test is excluded from `dev` by construction (`grepInvert`), and the checker enforces this, so keeping a copy would mean duplicating the test body. Every assertion (timing, draft-preview presence or absence, server outcome, out cells) still runs once, in a required job. The only thing lost is React dev-runtime render cost in the input handler, which users never pay. I agree this is not an owner-level coverage trade-off, and escalation is not needed.
- **D5 mutations are build-independent.**
  - M1: `openspec/changes/archive/2026-11-21-regex-probe-control-headroom/mutation-decline-disabled.diff` exists (two hunks: `javaRegex.ts` `isBacktrackBounded` removed, `stringOps.ts` `regexInputCost` gate returns `undefined`). Its recorded run (`mutation-decline-disabled.txt`) failed on the bound: the probe at 491.0 ms and the long cell at 1132.0 ms. Both values are V8 backtracking cost, which is identical in a minified build, so the failure should reproduce on the production build. D5's "re-derived if it no longer applies" covers drift since HEL-1807 touched `stringOps`/`javaRegex`.
  - M2: `.../2026-11-21-anchored-regex-cost-refinement/mutations.txt` "M1 eligibility forced false" exists. Its e2e red (`red-run-e2e.txt`) failed on the "no draft-preview request" assertion, which is build-independent.
- **D6 shard reshuffle.** `e2e/shard-weights.tsv:100` has `hel1683-regex-main-thread.spec.ts	14`. Removing the file both deletes a 14 s item and shifts the median used for defaulted files (`e2e-shard.mjs` "unknown = median of table rows for DISCOVERED files"). Either change could move LPT assignments. D6's before/after plan, with an escalation if the max leg rises, is the right guard.
- **AC coverage.** AC1 (prod build in CI + measured margin): D1/D4/4.1. AC2 (each probe red under mutation): D5/3.2-3.3. AC3 (rest of the suite unchanged): Non-Goals, D7 list inversion and the 2.2 shard plan. No AC is left uncovered. I found no scope drift.
- **Contracts/specs.** No API or schema change. `skip_specs: true` is justified for test placement only.
- **Placeholders.** None. No TODO/TBD, and every task has a verification step.

### Verdict: CONFIRM

### Non-blocking notes

1. **M2 proves only the anchored test's routing assertion, not its timing bound.** "Eligibility forced false" makes the anchored test fail on `requests ... toEqual([])` (spec `:432-435`) before the timing assertion is reached. That matches HEL-1807's recorded precedent and satisfies AC2 ("still fails"). However, nothing demonstrates that the anchored test's `<= 100 ms` assertion can go red on the production build. The executor should state in the evidence which assertion M2 failed on and acknowledge that limit, rather than present M2 as a timing red. An optional extra would be a timing-only mutation (for example, forcing the anchored pattern onto the client without its one-attempt charge so V8 runs it unanchored), but it is not required.
2. **Task 1.3 is not consistent with D6.** Task 1.3 omits `DEV_PORT=<lane port>` on `node scripts/e2e-shard.mjs plan`, while D6 includes it. Use the lane `DEV_PORT` (7248) for both the before and after plans so they are comparable.
3. **D4's measurement of test 1 has three windows** (control, probe, overrun). The margin should be computed against the worst window across all runs, including the control window under `HEL1808_CPU_THROTTLE=4`. That control window is the one HEL-1808 found closest to the bound.
4. **Lane commands.** In the D7/1.1 `npx playwright test --list` calls, prefix `DEV_PORT=7248 BACKEND_PORT=10155` explicitly so the listing resolves the lane's config rather than an ambient default (CON-165 spirit). Run every measurement through the HEL-1699 sequence only, never with a bare `vite preview`.
