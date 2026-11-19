## Skeptic Report — final gate (round 3, skeptic-final-3.md)

Reviewed HEAD `b79cf81ae0c0a2a7d4943c40e2519254966455ec`. `resolve-review-base.sh` resolved the base live as `daf40bfbf` (rc 0). Since round 2's CONFIRM on `638732135`, two commits landed: `70ec7b2ce` merges origin/main (HEL-1781, HEL-1784), and `b79cf81ae` regenerates `e2e/shard-weights.tsv` and edits `variance.md`. The change has no UI, so the visual step does not apply.

### What I verified (with evidence)

- **The merge did not touch the split.**
  - `git diff 638732135 70ec7b2ce` over the hel1583/hel1665/hel1733 parts, `e2e/support/hel1*` and `scripts/e2e-shard*` is empty.
  - Main changed only these e2e files between 3bf3590ec and daf40bfbf: `hel1773` (13 lines), plus the new `hel1781` and `hel1784` specs. None of the split originals was edited on main.
- **Source reports are authentic.** I downloaded `playwright-json-shard-*` fresh from GitHub for all 5 source runs into my scratchpad. All 35 `results.json` files are byte-identical (`cmp`) to the executor's copies. Totals: unexpected 0, flaky 0. Run 44589133697 is a `main` `push`, attempt 1, with all 7 e2e legs `success`.
- **The table reproduces.**
  - I made a fresh HEAD list (`npx playwright test --list --reporter=json --project=dev`, rc 0): 126 files, 943 tests. The +11 tests over round 2's 932 come from the merged hel1781/hel1784 specs.
  - `node scripts/e2e-shard.mjs weights --list <my list> 44589133697 44498291938 44488684006 44468195695 44455550476` exited rc 0. Its data rows are **identical** to the committed table, and the `# Runs` header matches.
  - stderr: 760 results of 152 tests re-attributed, 0 dropped.
- **Zero defaulted specs.** Discovered files 126, table rows 126. Defaulted `[]`, stale `[]`.
  - New rows: hel1786 38, hel1781 21, hel1784 17.
  - hel1608 is 86.
  - Split parts: hel1665 172/179/199/173, hel1733 129/94/113, hel1583 102/103.
- **Gates at HEAD:** `check:e2e-shard:selftest` (28 cases), `check:e2e-types`, `check:e2e-user-cleanup` and `check:e2e-evidence-paths` (182 files) all exit 0.
- **The run set is checked against the counting rule. It fails** (see CR1). From `gh run list --branch main --workflow ci.yml` and the per-run jobs API, the main runs after 33dd755d9 that did not succeed are:
  - **44587029243** (febb2013b): `e2e (3)` failure. Not counting. This is correct.
  - **44533329820** (3bf3590ec): `e2e (3)` failure. Not counting. This is correct.
  - **44464180222** (62df9ff48, 2026-11-19T05:17Z). Its only failures are `backend (1)` and `docker-image`. **All 7 `e2e (n)` legs succeeded.** Its 7 `playwright-json-shard-*` reports are present. I downloaded them: every shard has `unexpected 0` and `flaky 0`. The tool's `validateRunReports` accepts the run, and `weights` exits rc 0 with it in the set.

### Verdict: REFUTE

### Change Requests

1. **The regenerated table is not built from the 5 most recent counting 7-leg main runs, which Decision 5 requires.**
   - **The rule.** Two documents define a counting run, and both are binding:
     - Design Decision 5: "every e2e leg succeeded, every leg's `playwright-json-shard-*` present, `unexpected=0` and `flaky=0` (the tool's `validateRunReports`)".
     - The `e2e-ci-sharding` spec: "A run counts toward any measured set only if every e2e leg succeeded and every leg's test report is present".
     - Neither rule looks at the run-level conclusion.
   - **What went wrong.** Run 44464180222 meets the rule. It is newer than 44455550476 (05:17Z vs 04:02Z), so it belongs in the set and 44455550476 does not. The correct set is: 44589133697, 44498291938, 44488684006, 44468195695, 44464180222.
   - **Where the error sits.** `variance.md:14` lists 44464180222 as "(failures) ... do not count", with no reason. The design-gate review copied this from the run-level conclusion. The new note at `variance.md` §"Weights regeneration notes" then states "the 5 most recent counting 7-leg main runs" and "The before set now has 6 counting 7-leg main runs". Under the written rule the before set has 7.
   - **Measured effect.** I regenerated with 44464180222 in place of 44455550476. 52 of 126 rows change, with summed |Δ| of 179 s and a table total of 9965 s against the committed 10094 s. The largest changes are hel1582-sweep-375 (388 → 358), hel1575-dashboard-tabs (760 → 740) and hel1079 (48 → 38). The hel1665 light parts are 172 → 165 and 179 → 174.
   - **Fix:**
     - (a) Regenerate `e2e/shard-weights.tsv` with `--list` from HEAD over 44589133697 44498291938 44488684006 44468195695 44464180222.
     - (b) Correct `variance.md` line 14. 44464180222 counts: its failing jobs were backend (1) and docker-image only. 44533329820 does not count: e2e (3) failed. Correct the regeneration note too: name the run set, and say the before set has 7 counting runs.
     - (c) Include 44464180222 in the AC3 before set (`measure.mjs`/`before.md`) and re-run that before-set measurement.
     - (d) Do this before any PR measurement attempt (C17).
   - **Alternative.** If the orchestrator believes a run with a failed non-e2e job should not count, that changes the spec's counting rule and needs an explicit, recorded decision. It must not be applied silently.

### Non-blocking notes

- After CR1 the plan's per-leg loads will shift slightly. The `variance.md` line "Plan per-leg weighted loads: 1442 / … s" should be re-taken from the regenerated table.
- One defect is in the gate chain itself. Three design-gate and two final-gate skeptic rounds accepted "44464180222 failed" from the run-level conclusion. None of them checked which job failed. The counting rule is defined per e2e leg, so a gate checking it must read the per-job conclusions.
- No evidence in this review depends on mtime ordering. Report equality is shown by `cmp`; table equality by `diff`.
- Round 2's notes still apply. If an attempt's reports are lost, the Delivery log fallback must key on title path, not the printed file. `hel1575-dashboard-tabs` remains the floor on any leg.
