## Skeptic Report — final gate (round 2, skeptic-final-2.md)

Reviewed HEAD fb2258e1c6137faafd2a3186f70717a7c1b5bfbd against live-resolved base 9a867c7c1e71bfff332ef86d1116da943cfee87b
(`resolve-review-base.sh`, exit 0). Scratch: `/home/matt/Development/helio/.concertino/scratch/HEL-1789/skeptic-final-2/`.

### What I verified (with evidence)

- **Spawn guard:** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=task/split-remaining-heavy-e2e/hel-1789`.
- **What changed since round 1 (HEAD 7984321a2):** `git diff --name-only 7984321a2 HEAD` lists only design.md,
  evaluation-1.md, skeptic-final-1.md, tasks.md and variance.md in the change directory. No spec, support, workflow,
  weights or frontend file changed. All the change-dir markdown passes `prettier --check`.

#### Round-1 CR1 (run 44683347610 leg 7 misclassified): resolved

- A fresh `gh run view --job 136111721006 --log` shows `Cloud: Azure`, `Region: centralus`, Runner Image Provisioner
  `Version: 20261103.629`, image `Version: 20261111.370.1`. The jobs API gives 05:47:23Z to 06:02:44Z, which is 921 s,
  success.
- I recomputed from the persisted `.concertino/runs/HEL-1789/evidence/legfactors.json` with my own script:
  - 105 legs over 15 runs. AWS has 59 legs: wall median 884, setup median 129, 0 legs at or above 1.15.
  - Azure has 46 legs: wall median 1060.5, factor median 1.149, 23 legs at or above 1.15 and 13 at or above 1.30,
    across ten regions.
  - Images: AWS 20261111.127.1 x39 and 20261116.133.1 x20. Azure 20261111.370.1 x38 and 20261116.376.1 x8.
  - These match variance.md:154-157, 183, 188 and 192. The 44683347610 row reads `7:1.00`. The false "run with no
    Azure leg" sentence is now "a run whose only Azure leg was fast … an Azure leg is not always slow".
  - The image-version claim is restated over all 105 legs, and the 20261103.629 version is correctly identified as an
    agent/provisioner version, not an image.
- I spot-checked four more legs against fresh job logs and the jobs API (135299090981, 135471032852, 136061418796,
  135888796262). Cloud, region, image and wall (888, 863, 888, 1091 s) all match legfactors.json.
- The persisted `cloud-table.md` matches variance.md's per-run table. `legwide-summary.txt` reports
  `unclassified 0 total 105`, 46/23/13 for Azure and the four image buckets. Two small numbers are stale (see the notes).

#### Round-1 CR2 (per-part medians): resolved

- variance.md now uses the final table for each figure: 201 / 182 (hel1684), 300 (maximal), 153 (fit-and-touch) and
  88 (off-reduce-snap).
- It adds a "Final part weights (the committed table)" paragraph. Every figure in it matches my
  `grep` of `e2e/shard-weights.tsv`.
- It now states openly that hel1684 `desktop` at 201 s is marginally over the "about 200 s" target, and why.
- The Azure-heavy note, "44697763503 leg 1 at 1325 s", checks out. A fresh jobs API read gives e2e (1) 1325 s, and its
  log shows `Cloud: Azure`, `Region: northcentralus`.

#### Whole branch, afresh

- **AC1 (keep every test).** I ran `npx playwright test --list --reporter=json --project=dev` at HEAD and reduced it
  with my own walker. It lists 1037 tests. A sorted `diff` against the committed `list-before.txt` (1035) shows exactly
  the two added `HEL-1790 guard … (dark|light)` lines and no removals.
- **AC1 (keep every assertion and scope, C19).** I re-ran `proof.mjs` at HEAD: `RESULT: PASS (zero differences in
  every group)`. I also confirmed that the six original files plus `hel1582Phone.ts` and the 390/768 sweep files are
  byte-identical between the proof's base 2b33217e1 and the review base 9a867c7c1 (`git diff --quiet`, exit 0). So the
  proof's base is the true pre-change state.
- **Weights (Decision 5).** `node scripts/e2e-shard.mjs weights --list <my HEAD list> art/{44697763503,44692374356,44683347610,44660016746,44655001204}`
  gives data rows identical to the committed `e2e/shard-weights.tsv`.
- **AC2 / runner record (spec delta).** I read the ci.yml diff in full:
  - The sampler starts after checkout and before e2e-setup, with a 1400 s self-stop, under the 1500 s job limit.
  - It is stopped by PID with `if: always()`.
  - Every new step has `continue-on-error: true`.
  - The identity step reads only /proc/cpuinfo, nproc, MemTotal and uname, with no environment dump.
  - The artifact is `e2e-runner-shard-<n>` and does not match `playwright-json-shard-*`.
  - `scripts/ci-load-sampler.cjs` is unchanged. It samples user, system, iowait, steal and idle percentages plus load1
    and procs_running at 1 Hz, and exits on SIGTERM and at its bound.
  - The spec delta's requirement and its three scenarios are met by this design.
- **Scope (C16/C17).**
  - No HEL-1790 file is in the branch diff.
  - Frontend and DESIGN.md edits are comment- and doc-only (I checked every +/- line).
  - `package.json` changes only the `e2e:state-contrast-guard` path filter.
  - There is no timeout-minutes, leg-count, partitioner, product, schema or migration change.
- **UI (step 4).** No view renders differently, so I started no servers.
- **Task 6 (AC3), achievable and honestly framed.**
  - The branch is not pushed yet (`git ls-remote` is empty).
  - Design Decision 6 defines the mechanism: sequential empty-commit pushes, up to 8 runs for 5 counting ones, single
    `--job` reruns only and named. It says that fewer than 5 counting runs means AC3 is unmet and is escalated.
  - It also states plainly that "the 1200 s outcome is not guaranteed by the split" and requires naming the driver and
    the runner record for any run over 1200 s. That is achievable and honest.
  - origin/main has advanced by two commits (HEL-1788, HEL-1777). Between them they modify only
    `e2e/hel1784-editor-form-submit.spec.ts` and add no new e2e spec, so a merge before measuring defaults no weight.

### Verdict: CONFIRM

Both round-1 change requests are resolved, and I checked the fixes against fresh CI ground truth. The split, the parity
proof, the weights and the runner record still reproduce at HEAD.

### Non-blocking notes

- Two figures in the leg-wide table are slightly stale after the reclassified leg (setup 112 s) moved into the Azure
  set.
  - The recomputed Azure median setup is 139.5 s, but variance.md:155 and 184 say 141 s.
  - The persisted `evidence/legwide-summary.txt` still says Azure `wall med 1065`, while variance.md (correctly) says
    1060.5. The json in the same directory gives 1060.5.
  - Neither changes any conclusion. The 0.44 setup/factor correlation may also have shifted slightly.
- variance.md:103 gives `overlays-chrome` as 121 s, but the final table and line 267 give 120 s.
- variance.md:252, "the earlier 5-run set dropped 44655001204's neighbours 44640957498", is garbled. Reword it if the
  file is touched again.
- **Delivery.**
  - Main's own run 44697763503, on the merged head this branch is based on, already had a 1325 s Azure leg. The PR
    should report the cloud mix of each counting run next to its slowest leg, and must not present an AWS-heavy set as
    "1200 s met".
  - Name the hel1684 Discard flake candidate up front, so that a single `--job` rerun is pre-justified.
