## Evaluation Report — re-run at merged head (evaluation-4.md)

This re-run reviewed HEAD `b79cf81ae0c0a2a7d4943c40e2519254966455ec`. The review base is `daf40bfbfd4b38b01d83c9a3b4a834c2da488877`, resolved live with `resolve-review-base.sh` (it is now `origin/main`). Since evaluation-3's PASS at `638732135`, two commits landed:
- `70ec7b2ce` merges `origin/main` (HEL-1781 `febb2013b`, HEL-1784 `daf40bfbf`).
- `b79cf81ae` regenerates `e2e/shard-weights.tsv` and updates the regeneration notes in `variance.md`.

### Phase 1: Spec Review — PASS

**The merge is clean.** I checked it in both directions, ignoring blob-hash `index` lines:
- `git diff 638732135 70ec7b2ce` is identical to `git diff 3bf3590ec daf40bfbf`, so the merge added exactly main's changes.
- `git diff daf40bfbf 70ec7b2ce` is identical to `git diff 3bf3590ec 638732135`, so the merge added exactly the branch's changes.
- There was no conflict resolution and no stray edit.

**The new source run counts.** The GitHub API reports run `44589133697` as:
- `main`, `push`, `success`, attempt 1, head `daf40bfbf`;
- all seven `e2e (n)` legs `success`.

I re-downloaded its `playwright-json-shard-*` artifacts. Their sha256 sums match the lane's scratch copies. `weights` (whose `validateRunReports` enforces 7 reports, `unexpected=0` and `flaky=0`) accepted all five runs.

**The source runs are the right five.** The 5 newest successful main CI runs are 44589133697, 44498291938, 44488684006, 44468195695 and 44455550476. That is exactly the table header. The runs in between (44587029243, 44533329820, 44464180222) are failures and do not count.

**The weight table reproduces byte for byte.** I ran `weights --list <my head list>` over those five runs. The output is identical to the committed table:
- 760 results of 152 tests re-attributed, 0 dropped;
- `plan` reports **no defaulted specs**;
- hel1781 and hel1784 now have rows.

**The test lists keep their identity against the merged base.** I listed tests at `daf40bfbf` (in a throwaway detached worktree, since removed) and at `b79cf81ae`:
- 943 tests on each side, 943 distinct `project | title path` keys, 0 multiset differences, `{"dev":943}` on both sides.
- The three split stems keep their key sets (90 = 21+23+25+21, 32 = 10+9+13, 30 = 15+15).
- The other 791 tests have an identical (file, project, title path) list on both sides. So the only change is the three split files' tests moving to the part files, with their titles unchanged.

**The body proof still holds.** The merge did not touch the three stems or their support modules: the branch side of the merge is byte-identical to the content evaluation-3 proved.

**The `variance.md` update** is accurate on every point I checked: the run ids, that 44446279352 dropped out, the 760/152/0 re-attribution and the zero defaulted specs. The stated 44587029243 failure is consistent with the API's `failure` conclusion.

Issues: none.

### Phase 2: Code Review — PASS

I ran these myself at `b79cf81ae`:

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

The merge brought 17 `frontend/` files, so I also ran:
- `npm test`, with 3 jest workers:
  - root suites: 70 of 70 passed, 617 tests;
  - frontend suites: 865 of 865 passed, 10217 tests;
  - exit 0.
- `npm --prefix frontend run build`: exit 0.

I did not run `sbt testFull`. The branch's own diff against the live base (`daf40bfbf...HEAD`) has no `backend/**` file. The backend files the merge brought were main's own and are unchanged by this branch.

Issues: none.

### Phase 3: UI Review — N/A

The branch's diff against the live base touches no UI-trigger path except one comment line in a jest test file.

### Overall: PASS

### Non-blocking Suggestions
- none
