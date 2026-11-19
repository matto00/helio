## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed HEAD 3bf3590ec2cb2bf4b1478159a8cae832274becf6 (branch task/rebalance-heavy-e2e-specs/HEL-1778; change dir untracked, no code diff yet).

### What I verified (with evidence)

- **Spawn guard:** `assert-cwd.sh` returned `READY ambient=/home/matt/Development/helio branch=task/rebalance-heavy-e2e-specs/HEL-1778`.
- **Tool claims (design Context, Decision 4):** `scripts/e2e-shard.mjs` matches the description: LPT over whole files (`partition`), median default for missing rows (`resolveWeights`), `weights [--legs <n>] <runDir>...` with `validateRunReports` (7 reports, unexpected=0, flaky=0), `filesFromList` reading `--list --reporter=json`. `DEFAULT_E2E_LEGS = 7`. Correct.
- **Playwright config:** `fullyParallel: false`, `retries: 0`, `workers: 2` on CI, single `dev` project when `HELIO_E2E_PROD_BUILD` is unset. Correct.
- **In-file modes:** `hel1665` line 25 `mode: "parallel"`, line 26 file-level `test.setTimeout(180_000)`; `hel1583` line 10 `parallel`; `hel1733` has no file-level configure (setTimeout/use only inside describes at 415-419, 514-515, 708-709, 834-838) and no `beforeAll`. Matches the design's table.
- **Spec delta:** the MODIFIED requirement "e2e shard assignment is weighted from CI evidence" in `openspec/specs/e2e-ci-sharding/spec.md` (line 32) has exactly one scenario ("Assignment is deterministic"); the delta keeps it verbatim and adds three. Header matches. Sound.
- **Cited main runs (Decision 1/5):** via the GitHub API, 44446279352, 44455550476, 44468195695, 44488684006, 44498291938 are all `main push`, attempt 1, 7 e2e legs, 7/7 success; slowest leg 1178 / 1077 / 984 / 1161 / 993 s. They are the only counting 7-leg main runs since 33dd755d9 (44464180222 and 44533329820 failed).
- **Planning-probe numbers:** recomputed with the repo's own `fileSumsForRun` over `.concertino/scratch/HEL-1778/runs/{44488684006,44498291938}`. The table's hel1665 (756/723), hel1733 (334/336), hel1583 (203/209) sums are correct.
- **The same data, read for the whole suite rather than the three named files** (top per-file sums, 44488684006 / 44498291938):
  - hel1575-dashboard-tabs 824 / 735 (table 749, `mode: "parallel"`, the heaviest file in the suite)
  - hel1665 756 / 723
  - hel1582-sweep-375 512 / 388 (32 % swing)
  - hel1684-draft-structural 338 / 331
  - hel1582-mobile-pipeline 336 / 344
  - hel1733 334 / 336
  - state-surface-contrast-guard 276 / 268
  - hel1573-motion-primitives 236 / 175 (35 % swing)

  Per-leg summed test time in 44488684006 was 1710 / 1589 / 1461 / 1276 / **1910** / 1374 / 1368 s. Job walls from the API were 1074 / 1014 / 988 / 822 / **1161** / 860 / 851 s. The slowest leg of that run, leg 5, held hel1582-sweep-375 (+124 s over the other run) and hel1573 (+61 s). Neither of these files is among the three the plan analyses or splits. In the same run the three named specs were steady: hel1665's leg was 1014 s and the hel1583+hel1733 leg was 988 s.
- **Gate-chain checks the split must keep passing:** `check-e2e-user-cleanup.mjs` and `check-e2e-evidence-paths.mjs` scan every `e2e/` source, `e2e/support/*` included. Helpers moved verbatim keep their `recordRegisteredUser`/`evidencePath` usage. No new risk, but the executor must run both (see note).
- **Prior method:** archived HEL-1772 design Decision 3 handled the "e2e shard balance is measured in CI" requirement clause by clause: a 25-run before set, the missing count-based control and the 15 s line, each stated as not met or not applicable.

### Verdict: REFUTE

### Change Requests

1. **Fix the internal contradiction between Goals and Non-Goals.** design.md Goals: "No spec file in the suite heavier than about 250 s summed (median) after the change". Non-Goals: "Splitting specs other than the three named heavy ones". Ground truth breaks the goal by a wide margin with files the plan leaves alone: hel1575-dashboard-tabs (735-824 s, table 749, heavier than hel1665), hel1582-sweep-375 (388-512), hel1684-draft-structural (331-338), hel1582-mobile-pipeline (336-344) and state-surface-contrast-guard (268-276). As written, the goal cannot be met, and an evaluator checking it would have to fail the change or ignore it. Restate the goal to cover only the three split specs (e.g. "no part of hel1665/hel1733/hel1583 above about 250 s"), or widen the scope with an explicit justification. A wider scope is a scope change against the ticket, which names three specs, so it needs an escalation rather than a unilateral widening.

2. **Widen the variance analysis (Decision 1, tasks 1.2/1.3) from four named specs to every spec and every run's slowest leg.** The plan's own probe data shows the slowest leg of 44488684006 (leg 5, 1161 s, 39 s under the bar) was driven by hel1582-sweep-375 (+124 s) and hel1573-motion-primitives (+61 s), not by any spec the plan touches. The ticket's outcome is "the slowest e2e leg stays at or under 1200 s on normal runs", and AC3 measures exactly that. A plan that splits three files without checking what actually drives the slowest leg may deliver all its tasks and still miss the outcome. Required:
   - (a) `specvar.mjs` computes per-run sum, share of run total and swing for **all** discovered specs.
   - (b) For each counting run in the set (main and PR #1172 attempts), `variance.md` names the slowest leg and the specs that account for its excess over the mean leg.
   - (c) The design states the decision rule for a material driver outside the three named specs. Recommended: name it in `variance.md` and file a follow-up ticket, since splitting it here is scope drift unless the owner rules otherwise.
   - (d) The design says whether the three-spec remedy is expected to be sufficient for AC3, given (b).

3. **Address the "e2e shard balance is measured in CI" requirement clause by clause (Decision 6).** Splitting files and regenerating the table both change shard assignment, so the requirement applies (HEL-1772 Decision 3 treated a weight regeneration the same way). The requirement asks for:
   - a before set of the 25 most recent counting runs;
   - an after imbalance of at most 15 s, lower than that before imbalance;
   - a same-window count-based control.

   Decision 6 currently names a 5-run before set and "imbalance as the spec defines" without saying how any of these clauses is met. Only 5 counting 7-leg main runs exist since 33dd755d9, and a mixed 6/7-leg before set would make the imbalance comparison meaningless. State, for each clause, the before set actually used, which clauses are not met or not applicable (the control set does not exist; the 15 s line was accepted as unmet at HEL-1361), and how the PR reports them. Add this to task 5.1 and to the `measure.mjs` output in task 4.3.

### Non-blocking notes

- The spec delta uses "title path" without defining it. The rules only work if it is the describe chain plus the test title, without the file-level root suite, which in Playwright JSON is titled with the file name. Defining it in the requirement text costs one clause. The "moved by split" selftest case would catch a wrong implementation anyway.
- Name the actual e2e type gate in task 2.5: `npm run check:e2e-types` (`tsc --noEmit -p e2e/tsconfig.json`). Also add `npm run check:e2e-user-cleanup` and `npm run check:e2e-evidence-paths`, since moved helpers are re-scanned by both.
- Decision 3(a) list command: pass `--project=dev` (the shard's `SHARD_PROJECT_ARG`) for parity with what the legs run. With the env unset, the result is the same either way.
- When `--list` is used, the `weights` output header's `# Regenerate:` line should show the `--list` form, so the documented command reproduces the table.
- Fallback rule 2 can misattribute a test that was deleted, not moved, if an unrelated current file happens to share its title path. This is low risk because the top-level describes carry ticket ids, but the risk list could say so.
- Context: on the 5 counting main runs since HEL-1772, the slowest leg was already at or under 1200 s (max 1178 s). The ticket's 1236/1441/1399 s figures are PR #1172 attempts. Decision 1's run-wide-versus-spec-specific split should keep main and PR-attempt populations apart, because that gap may itself be the "run-wide" cause.
