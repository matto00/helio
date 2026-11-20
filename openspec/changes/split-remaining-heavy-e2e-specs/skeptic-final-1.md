## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD 7984321a20909ab716f42e261bb41360c7eeccfd against live-resolved base 9a867c7c1
(`resolve-review-base.sh`, exit 0). Scratch for this review: `/home/matt/Development/helio/.concertino/scratch/HEL-1789/skeptic-final/`.

### What I verified (with evidence)

- **Spawn guard:** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=task/split-remaining-heavy-e2e/hel-1789`.
- **Test-list parity (AC1, "keeping every test"), my own reducer.** I ran `playwright test --list --reporter=json --project=dev`
  in the main checkout (at 9a867c7c1 = base) and at HEAD, plain and with `HELIO_E2E_SLOW=1`. My reducer keeps
  `project | describe chain > title` and also the resolved `timeout`, `expectedStatus` and `annotations` of each test.
  Base 1037 = HEAD 1037 = HEAD-slow 1037. The only diff line is the absolute checkout path inside an untouched file's skip
  annotation (`hel1575-switch-measurement`). The committed `list-before.txt` equals my base list minus exactly HEL-1790's two
  `hel1790-hover-probe` tests (LC_ALL=C sort, `diff`), so the before-list is truthful.
- **Scope-chain and assertion parity (C19).** I re-ran the executor's `proof.mjs` at HEAD: `RESULT: PASS (zero differences
  in every group)`. Bodies 0, chains 0, hooks 0 differ in all six groups. `expect(` counts over test and hook bodies are
  equal: hel1684 51 + 4 = 55 on both sides, and its `afterEach` count429 covers 8 of 13 sites on both sides. The hel1582
  MAXIMAL skip gate is on 3 of 3 sites on both sides. The mobile `test.use` covers 19 of 19 sites. The evaluator showed
  separately that the proof fails under its own two mutations. I also grepped every part: each one repeats its original's
  file- or describe-level `describe.configure`, `test.use` and `test.setTimeout`.
- **Weights regenerated from CI, not by hand.** I ran `node scripts/e2e-shard.mjs weights --list <my HEAD list>` over
  `art/{44697763503,44692374356,44683347610,44660016746,44655001204}`. Its data rows are identical to the committed
  `e2e/shard-weights.tsv` (`diff` gives no output), and the header lists the same runs. `gh run list --branch main` shows
  these are the 5 most recent completed main runs with all e2e legs green. The part weights are 73-201 s, and the named
  exception, `hel1582-sweep-375-maximal`, is 300 s as a single test.
- **The leg-wide (AWS vs Azure) association (AC2), re-derived from fresh job logs.** I fetched every e2e leg's log for
  three main runs (`gh run view --job <id> --log`):
  - 44692374356: Azure on legs 2 (1026 s), 4 (1268), 5 (eastus, 1417, the slowest) and 3 (1078). AWS us-west-2 on legs
    1 (993), 6 (919) and 7 (960).
  - 44660016746: leg 3 is AWS us-east-1 (856 s, factor 0.98). The other six legs are Azure (1056-1264 s, factors
    1.11-1.39).
  - 44683347610: legs 1-6 are AWS us-west-2 (871-1002 s). **Leg 7 is `Cloud: Azure`, `Region: centralus` (921 s,
    factor 1.00)**.

  The core association reproduces: no AWS leg is slow, and the slow legs are on Azure. One claim does not: see CR1.
- **Runner record (spec delta, Decision 4b).** I read the ci.yml diff in full.
  - The sampler starts right after checkout and stops itself after 1400 s. That is under 1500 s, even counting the
    roughly 30 s that runs before it.
  - It is stopped by its recorded PID with `if: always()`, and the sampler exits cleanly on SIGTERM
    (`scripts/ci-load-sampler.cjs`, unchanged).
  - Each of the four new steps is `continue-on-error: true`.
  - The identity step reads only `/proc/cpuinfo` (model name and hypervisor flag), `nproc`, `MemTotal`, `uname -r`,
    `date` and `matrix.shard`. It dumps no environment.
  - The artifact is `e2e-runner-shard-<n>` and holds identity.txt, load.ndjson and sampler.log, with no `results.json`.
  - No workflow downloads by a pattern that would match it, and `findReports` only reads directories that contain a
    `results.json`.
  - This is the same pattern the frontend job uses (ci.yml:171-176).
  - Conclusion: Task 6 can read CPU model, steal and run queue per leg, so the AC3 measurement can attribute a slow leg.
    The branch has not been pushed yet (`git ls-remote` returns nothing), so the record has not run on CI.
- **Scope (C16/C17).** HEL-1790's files are not in the diff. There is no product code, migration, timeout-minutes,
  leg-count or partitioner change. The frontend edits are comment-only (App.css and three `*.css.test.ts` files).
  `package.json` changes one script to a path filter.
- **UI (step 4):** the frontend changes are comment-only and no view renders differently, so I did not start servers.
- **The gates the evaluator ran** (lint, format, jest, build, e2e checks, selftests) are pasted with their output in
  evaluation-1.md, and I did not re-run them. The diff does not change since that report (same HEAD).

### Verdict: REFUTE

The work itself (the split, the parity proof, the weights and the runner record) holds up against everything I re-ran.
The refute is about the AC2 evidence record. `variance.md` is the committed source for the owner's runner-class decision,
and one of its CI-data claims is false.

### Change Requests

1. **`variance.md` misreports run 44683347610 as having no Azure leg.** Its leg 7 (job 136111721006) ran on
   `Cloud: Azure`, `Region: centralus`, `Version: 20261103.629`, at factor 1.00 and 921 s. The executor's
   `logs/136111721006.head.txt` was a 0-byte fetch, so that leg came out `"?"`. A fresh `gh run view --job 136111721006
   --log` shows the cloud in "Set up job". Correct the following, and re-run `cloud.mjs` after re-fetching that leg's log:
   - variance.md:155: Azure becomes 46 legs, still 23 slow and 13 at 1.30 or more. Recompute the medians.
   - variance.md:157: the note "one leg's log was empty and is not classified" becomes "all 105 classified".
   - The 44683347610 row of the per-run table becomes `7:1.00`, not `-`.
   - variance.md:183: the sentence "a run with no Azure leg (44683347610) has a slowest leg of 1002 s" is false. Restate
     it: that run's one Azure leg was fast (1.00), so slow legs occur only on Azure, but an Azure leg is not always slow.
   - variance.md:193: "0 of 59 AWS" stays, and Azure becomes "23 of 46".
   - The image-version bullet (variance.md:188-190) claims the Azure image versions are 20261111.370.1 and
     20261116.376.1. This leg ran 20261103.629. Restate that claim against all 105 legs.

   Mirror the same corrections into `.concertino/runs/HEL-1789/evidence/` (cloud-table.md, legwide-summary.txt) so the
   persisted copy matches.
2. **Refresh the per-part medians in `variance.md` from the final `e2e/shard-weights.tsv`, or label them as coming from
   the earlier run set.** These numbers stand as the evidence that each part is about 200 s or less, but several no
   longer match the committed table:

   | part | variance.md | final table |
   | --- | --- | --- |
   | hel1684 `desktop` | 168 s | 201 s |
   | hel1684 `phone-and-kept` | 158 s | 182 s |
   | `hel1582-sweep-375-maximal` | 315 s | 300 s |
   | `hel1582-mobile-pipeline-fit-and-touch` | 155 s | 153 s |

   "Medians shift by a few seconds" (variance.md, last line) understates a 33 s shift.

### Non-blocking notes

- design.md Decision 2 and tasks.md 3.3 still describe `registerHeavySweeps` as "two calls". The code uses a private
  `registerSweeps(size, kinds)`, which is better because it avoids sibling describes with the same title, and the lists
  confirm it. One line in design.md would align the plan with the code.
- **Delivery.** The evaluator reproduced the hel1684 Discard flake (formerly `:427`) once in 24 local runs. Name it in the
  PR up front so a single `--job` rerun of that leg is justified in advance.
- **Delivery.** main has advanced to 894a72c56 (HEL-1788), which edits `e2e/hel1784-editor-form-submit.spec.ts` only. It
  adds no new spec file, so no weight defaults. A merge before measuring is optional.
- **AC3 honesty.** The split caps any one spec's swing, but it cannot lower a leg that runs at 1.3-1.46x on Azure. With
  the regenerated plan (about 1640 s weighted per leg on 2 workers, plus about 130-140 s setup), such a leg can still go
  over 1200 s. Design Decision 6 already requires naming the driver and its runner record when that happens, and treating
  the runner-class remedy as an owner decision. The PR must not present a lucky AWS-heavy set of runs as "1200 s met".
  It should report the cloud mix of the counting runs next to the slowest leg.
- The new regeneration set (3 of 5 runs are Azure-heavy) raised the weighted per-leg load from about 1495 s to about
  1640 s. That only affects proportions in LPT, but a weight row now partly encodes the cloud a file happened to land on.
  This is worth a sentence in the PR.
