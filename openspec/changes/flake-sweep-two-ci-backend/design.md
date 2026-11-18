## Context

See proposal.md - Why. Everything Planning pulled lives in the MAIN checkout (durable across the worktree's life):
`/home/matt/Development/helio/.concertino/scratch/HEL-1758/`:

| What | Path (under scratch/HEL-1758/) |
| -- | -- |
| Attempt-1 logs of all jobs (the jobs API returns only the latest, passing attempt; use `gh api repos/matto00/helio/actions/runs/<id>/attempts/1/logs`) | `logs/a1-44223574075/`, `logs/a1-44226053854/`, `logs/a1-44244750573/` |
| sbt hang diagnostics, backend (1), run 44223574075 att. 1 (thread dumps of the sbt server 2658 and forked test JVM 6554, ps tree, sbt.log) | `artifacts/r44223574075-sbtdiag1/` |
| hel1665:437 trace (run 44223574075 e2e (4)) | `artifacts/r44223574075-pw4/home/runner/work/helio/helio/test-results/hel1665-*/trace.zip` |
| hel1583-home-375:25 trace (run 44226053854 e2e (4)) | `artifacts/r44226053854-pw4/.../hel1583-home-375-*/trace.zip` |
| hel1573:104 trace + video (run 44244750573 e2e (2)) | `artifacts/r44244750573-pw2/.../hel1573-motion-grid-chart--f78c0-*/` |
| 25 recent runs' backend-leg step durations (Restore / Compile and test) | `durations.txt` |

Facts Planning established (the executor re-verifies anything it relies on):
- Restore step ("Restore backend compile output"): 2-8 s in every one of ~95 recent backend leg jobs, and exactly
  120 s in the three failures (44226053854 b(1), 44244750573 b(3) att. 1, 44244673956 b(0)). The glob covers about 1,678
  tracked files (recount at implementation) / 28 MB; `backend/src` and `backend/project` contain no symlinks; at key-evaluation time `backend/target`
  does not exist yet. So it is not "a huge tree": a normal evaluation is well under a second. The stall is in the
  runner's `hashFiles` evaluation itself. It runs right after the sbt dependency cache restore extracted ~976 MB
  compressed into `~/.sbt`/`~/.ivy2`/`~/.cache/coursier`.
- The same expression is evaluated a second time for the main-only save key (ci.yml:331), and the dependency cache key
  `hashFiles('**/build.sbt')` (ci.yml:255/341/395) walks the WHOLE workspace (18,025 tracked files), the same failure class.
- backend (1) 44223574075 att. 1: the forked test JVM was still running suites at the deadline (log lines stream
  continuously through 02:40:34; a fresh suite's Flyway migration was mid-flight). Before tests it compiled 110 main +
  271 test sources (~2.5 min). The rerun ran its tests in 6 m 19 s. Recent "Compile and test" durations span 214-613 s
  across legs; legs 1 and 3 are the heavy ones. `backend/project/test-suite-weights.tsv` was last regenerated on
  2026-10-05 (HEL-1287, 416 suites) by `backend/project/gen-test-suite-weights.py`. Every suite added since then is packed at the median weight.

## Goals / Non-Goals

**Goals:** a cheap, deterministic compile-cache key with before/after restore timings from real runs; a measured
hang-vs-provisioning verdict for the 660 s deadline and a rebalance that restores headroom; a trace- or probe-backed
root cause per e2e candidate, each forced red then 40/40 at 2 workers, or a recorded set of probes that failed to
reproduce it.

**Non-Goals:** raising any timeout or deadline (660 s, step 13 min, job 15 min, e2e expect/test timeouts); sleeps;
retries; HEL-1757's suite-wide fonts treatment; any Flyway migration or model call; touching HEL-1756's
`usePortalPopover`/`panelFit` or HEL-1742's insight backend. If a fix needs one of those files, stop and report it.

## Decisions

### D1. Compile-cache key: computed from git, in a step, used by both restore and save

Root cause (stated at the strength the evidence supports): the glob is small, so the 120 s is the runner's
`hashFiles` evaluation stalling, not the amount of work. The executor checks the runner's `hashFiles` implementation
(actions/runner, `src/Misc/expressionFunc/hashFiles`: a node subprocess that globs and hashes under a fixed 120 s
limit) and correlates the three failures with what ran just before the key evaluation (dependency-cache extract size and
time, runner image version in "Set up job") to name the most specific cause the evidence supports. If nothing more
specific than "the runner-side evaluation stalled" can be shown, say exactly that in the PR body. Do not claim more.

Fix (decided): a new step before the restore, `id: backend-key`, runs a committed script
`scripts/ci-backend-cache-key.sh`. Both keys are computed from git's index with a glob-capable command:
`git ls-files -s -- <pathspecs> | sha256sum` (after checkout the index equals the checked-out commit; `git ls-files -s`
prints mode, blob id and path, so no file content is read and the workspace is not walked). NEVER `git ls-tree` with
glob pathspecs (it does not expand them and prints nothing; skeptic round 1 reproduced this).
- Compile key inputs: `backend/src`, `backend/build.sbt`, `backend/project/*.scala`, `backend/project/*.sbt`,
  `backend/project/build.properties` (the exact set the current `hashFiles` call names).
- Dependency key inputs: the pathspec `':(glob)**/build.sbt'` (matches top-level and nested `build.sbt` exactly ; today the only tracked match is
  `backend/build.sbt`; the script uses whatever the pathspec matches so a future `build.sbt` is still included).
- Format (decided): each key value is the 64-char lowercase SHA-256 hex printed by `sha256sum`. So
  `scripts/cache-janitor.mjs`'s `sbt-deps` family regex `/^sbt-[0-9a-f]{64}$/` still matches the new dependency
  entries, and the old `sbt-<64hex>` hashFiles entry left by the transition is still in the same family and gets pruned
  as superseded (keep: 1). The `backend-compile-v3-Linux-` family is prefix-matched and unaffected.
- The script exits non-zero with a named error when either input set is empty (a constant key must never ship).
- It writes `compile=` and `deps=` to `$GITHUB_OUTPUT`.

Uses (decided): the backend job's dependency restore (255) and save (341) use
`sbt-${{ steps.backend-key.outputs.deps }}`; its compile restore (280) and save (331) use
`backend-compile-v3-${{ runner.os }}-${{ steps.backend-key.outputs.compile }}`. The security job (395) cannot read the
backend job's step output, so it gets its own `id: backend-key` step running the same script, placed before its cache
step. The composite action `.github/actions/e2e-setup/action.yml:49` restores the same `sbt-` family (used by ci.yml `e2e`
x6 at :655, `e2e-prod-build` at :760 and `e2e-slow.yml:62`). It gets its own `id: backend-key` step inside the composite,
before its sbt restore, running the same script, and uses `sbt-${{ steps.backend-key.outputs.deps }}`. The composite
runs after the caller's checkout, so the index exists. Without this the e2e jobs would request a hashFiles-era key that
the janitor prunes, and fall to prefix-only restores forever. They would also keep the whole-workspace walk.
Inventory (re-derived with `grep -rn "hashFiles" .github/`, not only `workflows/`): ci.yml 255/280/331/341/395 and
e2e-setup 49 change. `e2e-setup/action.yml:74` (`hashFiles('package-lock.json', 'frontend/package-lock.json')`) is
two literal paths, not a glob walk, and stays. Touching `.github/actions/e2e-setup/**` triggers `e2e-slow.yml` on the
PR (path filter, e2e-slow.yml:15). Its results are part of this PR's CI evidence.
Prefixes and `restore-keys` are unchanged. Confirm with `git rev-parse HEAD` in the step that the checkout is the
commit under test (for a PR, the merge commit), and confirm the checkout is not sparse (otherwise the index would not
list `backend/**`).

Proof (C12 adapted to CI, which cannot be forced to stall on demand):
(a) `scripts/ci-backend-cache-key.selftest.sh` builds a temp git repo and proves:
- the compile key changes when a `backend/src` file changes;
- the compile key changes when `backend/build.sbt` changes;
- the compile key changes when a `backend/project/*.scala` file changes;
- the compile key changes when a `backend/project/*.sbt` file changes;
- the compile key is unchanged when only a non-backend file changes;
- the dependency key changes when `build.sbt` changes;
- the dependency key is unchanged when only `backend/src` changes;
- both values match `^[0-9a-f]{64}$`;
- an empty input set fails non-zero.

Record it red first against two deliberately broken variants: one using `git ls-tree` with glob pathspecs (the
round-1 defect: the dependency key goes constant) and one that drops `backend/project`. Wire it into an existing
CI-only selftest step. Do not use `.husky/**`. Check that `check:precommit-ci-parity` accepts a CI-only selftest the way
it accepts the existing ones.
(b) Janitor: add a case to `scripts/cache-janitor.selftest.mjs` with a listing that holds an old hashFiles-era
`sbt-<64hex>` entry and a newer script-era `sbt-<64hex>` entry. It must select the old one for deletion. If it passes
unchanged, that is the evidence the format decision keeps the janitor correct; record it. Before relying on it, make
it fail once with a 40-hex key in the listing as the mutation.
(c) Script equality: in the real repo, list the files each pathspec set matches and compare them with what the current
`hashFiles` globs match (enumerate both with `git ls-files`; for `**/build.sbt` use a `find` over the checkout excluding
`.git`). Record the diff, which must be empty.
(d) Before/after: the "before" table is the Restore-step durations already in `durations.txt` plus the three 120 s
failures. The "after" table is, per backend leg, the new `backend-key` step's duration beside the Restore step's (so the
moved work is visible), plus the security job's cache step, with the cache-hit/prefix-hit outcome. Key correctness on the PR run (decided; a missing or misspelled step output evaluates to an empty string and
would silently yield a bare `sbt-` / `backend-compile-v3-Linux-` key that also prefix-hits):
  (i) for every consumer in the PR run - the four backend legs (deps + compile), security, at least one e2e leg,
  `e2e-prod-build` and `e2e-slow` - the PR body cites the RESOLVED key string from that job's log, and each matches
  `^sbt-[0-9a-f]{64}$` or `^backend-compile-v3-Linux-[0-9a-f]{64}$`, never a bare prefix;
  (ii) the `deps` value is identical across all those jobs and equals what the script prints locally at the PR head
  commit; likewise `compile` across the backend legs;
  (iii) the expected PR-run outcome is a PREFIX hit (`Cache hit for restore-key: sbt-...` /
  `backend-compile-v3-Linux-...`), because main's entries are still hashFiles-era and PRs never save;
  (iv) an exact hit is a post-merge expectation only (the first main push saves the new key; a later run exact-hits
  it). Record it as a follow-up observation if available. It is not a PR gate.
  Also (cheap guard, decided): the `backend-key` step itself asserts both outputs match `^[0-9a-f]{64}$` before writing
  them, and is placed before the FIRST cache step of each job that consumes it (in the backend job, before the
  dependency restore at ci.yml:249-256, not only the compile restore). Composite `run` steps declare `shell: bash`.
Report all of it in the PR body.
(e) The compile cache still restores (prefix hit) and the PR's compile is incremental, not a full recompile.

### D2. The 660 s deadline: under-provisioned, fix the packing, not the deadline

Verdict to verify: not a hang. Evidence to cite: continuous test output to the deadline; the forked test JVM (6554)
thread dump shows test work (the executor reads `threads-6554.txt` and names what each busy thread was doing, for
example a ScalaTest suite or a Flyway migration rather than a lock wait). If the dump instead shows a deadlock or a
thread parked on a lock for the whole window, the verdict flips to "real hang": stop and report before changing the
packing.

Act (decided): regenerate `backend/project/test-suite-weights.tsv` and rebalance within the existing 4 legs.
- Weights: extend `gen-test-suite-weights.py` (in scope) to take `<run-label>=<dir>` groups, compute the per-suite
  MEAN over the runs in which the suite appears (each run's shard dirs are unioned first), and write the header itself.
  The header names the run ids and states "mean of N runs" only when that is what was computed. Inputs: the
  `backend-junit-reports-shard-*` artifacts of at least two recent, complete, all-green main runs, downloaded by exact
  artifact id. A failing-first check: today's last-one-wins script fed two runs with different times for one suite
  yields the second run's value, not the mean. Record that, then the fixed script yields the mean.
- Coverage: every suite the build discovers (`TestShards` input) has a measured weight. List any suite still unweighted
  and say why (for example, new in the PR and never run on main).
- Wall-time model (decided, calibrated before it decides anything): a leg's predicted test wall time comes from
  packing the leg's suites into `HEL924_TEST_GROUP_COUNT` = 4 groups with `TestShards.groupWithinShard`, then scheduling
  those groups at `HEL924_TEST_GROUP_CONCURRENCY` = 2 (LPT onto 2 slots; the makespan is the prediction). Calibrate on
  run 44223574075 leg 1 attempt 1 with the OLD partition (from the old weights) and the newly measured per-suite
  durations. Its measured test window is about 498 s and still
  unfinished at the deadline, so the model must predict >= 498 s. Calibrate on at least two completed legs from
  `durations.txt` with their JUnit data. State the model's error. If the error exceeds 20 %, report the model as
  uncalibrated and use the measured CI numbers only.
- Compile term: 161 s (att. 1: sbt start 02:29:34.7 to test compile done 02:32:15.7), or the max over a larger stated
  sample if the executor measures one.
- Budget: predicted heaviest-leg test wall time + compile term <= 480 s (about 73 % of 660 s).
- If 4 legs cannot meet the budget: **stop and escalate** with the per-leg prediction table and the measured per-leg
  durations. Adding a leg is not this lane's decision: ci.yml:212-213 and HEL-1287 C6 record the owner's ~4-leg cap
  ("never add legs ... escalate with measured numbers"). Standing constraint C16.
- After CI: the real per-leg "Compile and test" durations of this PR's run(s) beside the before numbers from
  `durations.txt`. The deadline, step and job timeouts are unchanged (Non-goal).

### D3. hel1665-home-phone-stability:437 - the `40ch` probe read a fallback face's `0` advance

Evidence: CI serif dark logged `{"settledMax":640.001,"ch40":600,"width":640,"lines":2}`. 640 is Fraunces' 40ch (and
the settled cap, HEL-1737), and 600 matches the sans run's 40ch. The test passed `fonts.ready`, the rendered-face
precondition (Fraunces) and `document.fonts.status === "loaded"`, then set `maxWidth: 40ch` and read it back. `ch`
resolves against the advance of `0` in the element's first available font. Leading hypothesis: the face(s) holding the
glyphs the sentence renders were loaded, but the face or unicode-range subset that `ch` resolution consults was not.
Either it was never requested, because the sentence has no digit, or a different weight/style was not yet loaded. So
`status === "loaded"` was vacuous for `ch`. The page loaded and `goto` did not hang. The test took 7.4 s.

Decision on HEL-1757: **not folded in, left separate.** Fold in only if the trace shows a fonts request that never
answered on this test. The executor checks the trace's network entries for fonts.gstatic/googleapis and records the
answer. If it is the stall after all, fold HEL-1757 in only if its fix is a test-fixture change of the same size;
otherwise report and leave it.

Probe and force: in the trace, list the font requests and their timing relative to the measure. Force red by holding
(route gate, not a sleep) the specific font request the hypothesis names until after the measure on unfixed code,
then show the original assertion fails with the CI signature (ch40 = the fallback width). Fix per the cause. For
example, the test makes the font that `ch` uses load before measuring (`document.fonts.load('<weight> <size> <family>', '0')`
for the exact computed font of the element), or the product cap stops depending on it if that is a product defect a
user would see. Then green under the same forcing, then 40/40.

### D4. hel1583-home-375:25 - shelf cards measured before they render

Evidence: `cardCount` 0 vs 4 at line 127. The executor reads the spec's wait before the measure and the trace (what
`/api/...` summary or dashboards request the shelf depends on, and whether it had answered at measure time).
Hypothesis: the measure waits on something that becomes true before the shelf cards mount (for example the run
timeline or a heading), so a slow shelf data response leaves 0 cards. Force: hold the shelf's data response with a
route gate until after the measure on unfixed code -> red with cardCount 0. Fix: wait for the thing the assertion is
about (four `.home-shelf__item` cards, or the shelf's settled state), then green under the same forcing, then 40/40. If the trace shows the
shelf data HAD arrived and cards still did not render, it is a product defect: stop and report with the evidence
before fixing.

### D5. hel1573-motion-grid-chart:104 - no chart canvas within 5 s of `goto("/dashboards")`

Evidence: `locator('.chart-panel__canvas canvas').first()` not found within 5000 ms after `page.goto("/dashboards")`
(line 114-115). The executor reads the trace and video: which dashboard was selected, whether panels/rows requests
answered, whether a chart panel mounted with no canvas (ECharts init deferred, for example zero size or not in view) or
no chart panel at all (wrong dashboard selected, which is the HEL-1754 D1 hydration shape). Force red per the cause found
(route gate or the specific state), fix the cause, then green and 40/40. The spec's existing `waitForTimeout(2500)` is
pre-existing, not added by this change. Do not add more. If no cause reproduces, record every probe (as HEL-1754 D3 did)
and keep it a named candidate.

### D6. Verification protocol (every e2e spec, C12)

1) forced red on unfixed code, exact command and output saved; 2) the fix; 3) the same forcing shows green; 4)
`nice -n 19 npx playwright test <spec> -g "<title>" --repeat-each=40 --workers=2 --retries=0` against this run's
pinned ports (`DEV_PORT=7190 BACKEND_PORT=10097`, never the 5173 fallback), 40/40; 5) the FULL spec file once, green.
Transcripts go under `.concertino/scratch/HEL-1758/evidence/`. Before trusting any probe, check the page URL and port
are this run's (the shared Playwright browser has been hijacked between lanes before). Set `DATABASE_URL` for the
Playwright process the same way the lane's backend gets it, without reading or printing any `.env` (C1). If that is
not possible without reading one, use the dev DB and clean residue by exact id (C14). No `waitForTimeout`, retries or
raised timeouts.

## Risks / Trade-offs

- A git-computed key ignores untracked files under `backend/src`. CI has none (fresh checkout), and that is the point.
- Changing the dependency key orphans today's `sbt-<hash>` entry once. The prefix restore covers the transition.
  The cache-budget pruning removes superseded main entries (existing requirement).
- Regenerated weights help only until suites drift again. The regeneration command is documented in the file header,
  so the next sweep can rerun it. Not automated here (would be scope creep).
- The hashFiles root cause may stay at "runner-side stall". The fix removes the dependency either way.

## Design-gate round 4 notes adopted (non-blocking, tightening only)

- D1 (d)(ii): compare both `deps` and `compile` against the script run locally at the commit the CI step printed
  (`git rev-parse HEAD` in the step; fetch `refs/pull/<N>/merge`), not the PR head. The compile key differs between
  the two once main has moved.
- D3 and D4 get the same fallback as D5: if the hypothesis does not reproduce with the CI signature, record every probe
  and keep the spec a named candidate. Never engineer a forcing that does not match the CI signature.
- D4: prefer waiting on the shelf's settled state over a bare four-item count. The layout assertions are what the test is for.
- D2: include per-shard test counts before and after (sums equal) per the living `backend-ci-test-execution` profiling
  requirement.
