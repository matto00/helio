## Evaluation Report — re-run at corrected run set (evaluation-5.md)

This re-run reviewed HEAD `bad4f30372de05bd25e99d8bf883e0fbc8412157`. Its parent is `b79cf81ae`, which evaluation-4 covered, and the base is `daf40bfbf`. The new commit changes only `e2e/shard-weights.tsv` and `variance.md`; no spec, script or support file changed.

**Correction to evaluation-4.** evaluation-4 accepted that 44464180222 does not count because its *run* conclusion is `failure`. That was the wrong test. The counting rule is per e2e leg and per report, not the run conclusion. This report applies the rule at job level and report level to every candidate main run.

### Phase 1: Spec Review — PASS

**Job-level check of every main CI run since HEL-1772** (GitHub jobs API; "e2e" means the seven `e2e (n)` jobs):

| run | e2e jobs | other failed jobs | counts? |
| --- | --- | --- | --- |
| 44589133697 | 7 success | — | yes |
| 44587029243 | 6 success, 1 failure | — | no |
| 44533329820 | 6 success, 1 failure | — | no |
| 44498291938 | 7 success | — | yes |
| 44488684006 | 7 success | — | yes |
| 44468195695 | 7 success | — | yes |
| **44464180222** | **7 success** | `docker-image`, `backend (1)`, `ci-complete` | **yes** |
| 44455550476 | 7 success | — | yes (older) |

**Report-level check of 44464180222.** I re-downloaded `playwright-json-shard-*` myself:
- all 7 reports are present;
- every shard has `unexpected=0` and `flaky=0`;
- the run is `main` / `push`, attempt 1, head `62df9ff48`;
- the sha256 sums are identical to the lane's scratch copy.

So the 5 newest counting 7-leg main runs are 44589133697, 44498291938, 44488684006, 44468195695 and 44464180222. That is exactly the table header.

**The table reproduces byte for byte.** `node scripts/e2e-shard.mjs weights --list <my head list> <those 5 runs>` gives output identical to the committed `e2e/shard-weights.tsv`:
- 760 results of 152 tests re-attributed, 0 dropped;
- `plan` reports **zero defaulted specs**;
- the per-leg loads are 1426 / 1421 / 1421 / 1425 / 1424 / 1424 / 1424.

The head test list is still valid because no spec file changed since evaluation-4's 943 = 943 list check.

**The variance.md numbers match the specvar output.** I checked them against `specvar.out.txt`, which `specvar.mjs` regenerated at 11:09 over the 7-run main population:
- The per-spec sums match: hel1665 685/785/704/699/756/723/693, hel1733 332/330/467/325/334/336/392, hel1583 200/204/311/203/203/209/253. So do the swings (14 % / 43 % / 54 %), the shares, and the per-test p10-p90 for the two new slow runs.
- The slowest-leg rows match:
  - 44464180222: leg 3, wall 1395, mean 964, excess 431/662; drivers hel1733 +133, hel1583 +107, hel1579 +95.
  - 44589133697: leg 3, wall 1219, mean 946, excess 273/408.
- The outside-driver medians match (hel1582-sweep-375 358, state-surface-contrast-guard 316, hel1573 176, hel1575 740).
- **Independently of specvar:**
  - The jobs API gives `e2e (3)` 1395 s for 44464180222 and 1219 s for 44589133697.
  - Summing the raw reports myself gives hel1733 467 / 392 s, hel1583 311 / 253 s and hel1665 704 / 693 s for those two runs.
  - All of these agree with variance.md.
- `before.md` lists the same 7 runs with matching slowest-leg walls and headroom (1395 s means 105 s of headroom).

The revised conclusions follow from the data:
- The three named specs drive the slowest leg in 2 of the 7 main runs, both over 1200 s.
- The AC3 expectation now states the worst main run (1395 s, 105 s headroom).

Issues: none blocking.

### Phase 2: Code Review — PASS

I ran these myself at `bad4f3037`:

| gate | result |
| --- | --- |
| `npm run lint` | exit 0 |
| `npm run format:check` | clean |
| `check:e2e-types` | exit 0 |
| `check:e2e-user-cleanup` | clean (182 files) |
| `check:e2e-evidence-paths` | clean (182 files) |
| `check:e2e-prod-build-projects` | clean |
| `check:openspec` | clean |
| `node scripts/e2e-shard.selftest.mjs` | 28 cases passed |

I did not re-run the full `npm test` or the frontend build: nothing they cover changed since evaluation-4 ran them green at `b79cf81ae` (`git diff --name-only b79cf81ae HEAD` lists only the table and variance.md).

Issues: none.

### Phase 3: UI Review — N/A

No UI-trigger paths changed.

### Overall: PASS

### Non-blocking Suggestions
- In `variance.md`, the hel1575-dashboard-tabs row of the outside-drivers table says "(740 s main)" and then "one file of 760 s on one leg". The specvar median is 740, so change "760" to "740".
- In the same table, the hel1684-draft-structural row still says "338 s main". The 7-run specvar median is 337 and its main swing is 14 %. The row's evidence is PR-population only, so this is cosmetic.
