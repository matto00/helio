## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD `aa973721e7c704c277fb5a58a2f47cccf10ec972`. The base was resolved live by `resolve-review-base.sh` (rc 0) as `3bf3590ec2cb2bf4b1478159a8cae832274becf6`. The diff is 30 files: the three splits, three support modules, the tool and selftest, the table, the README, one jest comment and the change artifacts. No UI change, so the visual step does not apply.

### What I verified (with evidence)

- **AC2: the table reproduces.** I ran a fresh `DEV_PORT=7210 npx playwright test --list --reporter=json --project=dev` at HEAD, then `node scripts/e2e-shard.mjs weights --list <my list> <the 5 run dirs>`. Excluding the `# Runs` line (only the argument order differs), the output is identical to the committed `e2e/shard-weights.tsv`, and stderr reports 0 dropped. Specific rows: `hel1608` is 86 (was 8); the four hel1665 parts are 172/179/199/173; the hel1733 parts are 129/94/113; the hel1583 parts are 101/103; the old files have no row. `gh run list` confirms that the 5 source runs (44446279352, 44455550476, 44468195695, 44488684006, 44498291938) are the 5 most recent successful 7-leg main runs. The newer 44533329820 failed. `plan` defaults exactly one spec, `hel1786-shared-dashboard-freshness.spec.ts`, which merged after the newest counting run. The plan's legs are 1439-1443 s weighted.
- **AC1: the variance numbers are real.**
  - I recomputed the per-spec sums from the raw `runs/*/playwright-json-shard-*` with the repo's own `fileSumsForRun`. hel1665: 685/785/699/756/723. hel1733: 332/330/325/334/336. hel1583: 200/204/203/203/209. hel1608: 96/84/79/103/86. PR a6: 691/332/217/91. All match `variance.md` exactly.
  - Through the jobs API, PR attempt 2's leg 3 ran 00:44:31Z-01:08:32Z, which is 1441 s, as claimed.
  - The cause analysis is evidenced, not asserted: a leg-wide uniform slowdown in which the spec's ratio tracks its leg-mates while the rest of the run stays near 1.0. The doc honestly states that the 1200 s outcome is not guaranteed and names the drivers outside the three specs for a follow-up.
- **No test lost or weakened.** I wrote my own multiset comparison (`project|describe chain > title`) of scratch `base-list.json` against my fresh HEAD list. Both have 932 tests with 0 differences. The base has 128 spec files and HEAD has 134 (+6 = 9 parts − 3 originals). Per part: hel1583 15+15, hel1665 21+23+25+21, hel1733 10+9+13. No `@prod-build`, `.only`, `.skip`, `fixme`, `beforeAll` or `afterAll` in any original. The file-level `configure`/`setTimeout(180_000)` is repeated in every hel1665 part and `configure` in both hel1583 parts. hel1733 had none at file level. The support modules hold no module-level mutable state. Scratch `proof.out.txt` (AST body comparison, 0/0 and equal `expect` counts) agrees.
- **Tool behaviour matches the spec delta.** A direct probe of the exported `currentTests`/`attributeFile`/`fileSumsForRun` covered all four rules:
  - The reported file is kept when it still holds the title path, even if another file has the same path.
  - A single holder wins for a moved test.
  - A renamed test in a still-discovered file stays on its file.
  - A deleted file with no match returns null and is dropped.
  - An ambiguous move throws, naming the test.
  - The `diag` re-attribution is recorded, and retries are summed the same way as the old `sumDurations`.
- **Red first and mutations.** `red-selftest.txt` shows the new cases failing against the unchanged tool. `mutations.txt` shows M1-M7, M9 and M8b each turning a case red. M8's 0-fail entries were a broken mutation, which the executor disclosed and redid as M8b.
- **Gates, run fresh by me, all rc 0:**
  - `check:e2e-shard:selftest` (28 cases), `check:e2e-types`, `check:e2e-user-cleanup` and `check:e2e-evidence-paths` (180 files each)
  - `eslint --max-warnings=0` on every changed `.ts` and `.mjs` file
  - `prettier --check` on the changed e2e, support, script, README, jest-comment and change `.md` files
- **No stale references.** A grep for the three old file names outside the archive and this change finds only the parts' own "split from" comments. The HomePage.css.test.ts comment (evaluation-1's finding) is fixed.
- **AC3 plan (Delivery).** Decision 6 and task 5.1 are sound:
  - 5 to 7 attempts, never fewer than 3.
  - Each attempt's reports are downloaded before the next whole-run rerun.
  - Slowest/mean/headroom are taken per attempt from the jobs API.
  - The balance requirement is stated clause by clause, with the 25-run clause honestly marked unmet at 7 legs.
  - C17 orders any re-regeneration before the reruns.
  - The out-of-sample check (`oos.out.txt`, PR a6) predicts the max-minus-mean summed leg dropping from 137 to 93 s.
  - `before.md` is consistent with the jobs API figures above.
- **Not re-run by me:** the 152 split tests locally. Title paths and bodies are proven identical, and the PR's own CI run executes every part before merge.

### Verdict: REFUTE

The measurement, the tool, the table and the no-loss proof are sound. One shape defect blocks: two of the three splits were done by copying the test code into every part rather than registering it from the support module. hel1733, in this same change, shows that the codebase's pattern works.

### Change Requests

1. **hel1583: two 477-line files that differ in one line.** `diff <(sed -n '30,$p' e2e/hel1583-glass-nav-light.spec.ts) <(sed -n '30,$p' e2e/hel1583-glass-nav-dark.spec.ts)` differs only at line 30 (`["light"]` vs `["dark"]`). About 447 lines of test code now exist twice, and nothing keeps the copies in step. The next fix (for example, the known line-554 "/chat in two taps" flake) will be made in one theme and silently not the other.
   - Fix: move the per-theme block (the body of `for (const theme of [...])`, lines 30-477) verbatim into an exported function in `e2e/support/hel1583-glass-nav.ts`, e.g. `describeGlassNav(theme: "light" | "dark")`, the same way `describeMode` was done for hel1733.
   - Each part then calls it once at top level after its own `test.describe.configure({ mode: "parallel" })`.
   - Title paths and bodies stay byte-identical, so the table needs no change.
2. **hel1665: the 69-line matrix test is pasted four times.** It is the `for (const theme of ["<t>"]) / for viewport / for order of ["<o>"]` loop at `e2e/hel1665-home-phone-stability-dark-summary-first.spec.ts:32`, `-light-summary-first.spec.ts:24`, `-light-dashboards-first.spec.ts:25` and `-dark-dashboards-first.spec.ts:25`. All four extracted loop bodies are 69 lines and identical apart from the literals. The same applies to any other loop repeated across parts with a different filter.
   - Fix: export a `describeHomeLoadMatrix(theme, order)`-style function from `e2e/support/hel1665-home-phone-stability.ts` and call it from each part.
   - Tests that live in only one part can stay inline.
3. **After 1-2: re-run the proofs and gates.** That means the design Decision 3 proofs (`proof.mjs`: the title-path multiset and the body/`expect` comparison, which must still report 0/0 with the bodies now in the support modules), `check:e2e-types`, lint and prettier, and the local discover-and-pass run of the hel1583 and hel1665 parts against `helio_hel1778` (C14).
   - Confirm that `weights --list` over the same 5 runs still reproduces `e2e/shard-weights.tsv` unchanged. No file names change, so it must.

### Non-blocking notes

- Evaluation-1 reported another process briefly showing `helio-mcp/` as deleted in this worktree around 09:50. `git status` at my review shows only the two untracked evaluation reports, and HEAD is unchanged. No mtime-ordering claim is load-bearing in this review.
- `hel1575-dashboard-tabs` (760 s, one file) now sits alone on leg 1 at 1443 s weighted. It is stable, so it is not a swing driver, but it is the next floor on any leg. It is already listed in `variance.md`'s follow-up table.
