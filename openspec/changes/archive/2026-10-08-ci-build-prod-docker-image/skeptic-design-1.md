## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed the planning artifacts (ticket.md, proposal.md, design.md, tasks.md, specs/ci-production-image-build/spec.md),
which are untracked, on HEAD eda9ed491428c904ab9d486146ed65b47c003ba7.

### What I verified (with evidence)

- **Spawn-cwd guard:** `assert-cwd.sh` returned `READY ambient=/home/matt/Development/helio branch=task/ci-build-prod-docker-image/HEL-1427`.
- **The design's description of the current state matches the tree:**
  - `.github/workflows/ci.yml` triggers are `push: [main]` and `pull_request: [main]`, with no `paths`/`paths-ignore`. The
    jobs are frontend, backend (matrix), security, e2e (matrix) and ci-complete. Nothing in it runs `docker build`.
  - `ci-complete` (ci.yml:661-678) is `if: always()` with `needs: [frontend, backend, security, e2e]`. Its script exits 1
    on `contains(needs.*.result, 'failure')` or `'cancelled'` and otherwise passes, so `skipped` counts as success. This
    matches D6, and no script change is needed.
  - `cd-backend.yml:46` runs `docker build -t "$IMAGE" .` from the root with no `--target`, so the build ends at the
    final `runtime` stage. D2's "build exactly what CD builds" is accurate.
  - The Dockerfile's builder stage copies `backend/project/*.scala` (only `TestShards.scala` exists in `backend/project/`)
    before `sbt update`. `backend/build.sbt:206,211-212` references `TestShards.*`, so the mutation in D7 does break
    project load inside `RUN cd backend && sbt update`. The spec's phrase "fails at the dependency-resolution step" is
    accurate.
  - Critical-path numbers: I checked them with `gh run view 37880626177` (push on eda9ed49). frontend took
    03:44:10→03:49:26 (5m16s), and e2e (1) took 03:44:11→03:51:16 (7m05s), the slowest leg. The backend legs took
    2m33s–3m31s. All match design.md.
- **D3 (always-on): within the ticket's latitude, and the "never skipped" claim is correct.**
  - The ticket makes path filtering conditional ("Path-filter it if it's too slow"). Running on every PR covers more
    than the listed paths, so all of them are covered.
  - A job with no `if:` and no `needs:`, in a workflow with no path filters, cannot reach a `skipped` result. The only
    non-success results it can produce are `failure` and `cancelled`, and ci-complete fails on both.
  - A superseded PR run produces `cancelled`, which fails that run's ci-complete. That is already true for every job
    today and does not affect the new head's run.
  - The D3 acceptance condition (docker-image must finish faster than the slowest other job in the same real-CI run, or
    the executor stops and escalates without adding a filter or cache) correctly limits how far the planner approved
    itself. The "~70 s of sbt" local estimate is unproven. A cold `sbt update` (Spark tree) plus a cold compile and
    `assembly` could plausibly approach 7 min, so this condition matters, and the plan routes a miss to the owner.
- **D4 (no layer cache): within latitude, not an owner decision as planned.**
  - The ticket bullet states its goal ("so it doesn't add significant wall time") and qualifies it ("Mind the HEL-1299
    Actions cache budget").
  - The driver constraint says to prefer no cache if a layer cache would materially eat the 10 GB budget.
  - D4 meets the wall-time goal by running in parallel and checks that with D3's measured condition. If that check fails,
    the plan escalates. That is the right place for an owner decision.
  - Plain `docker build` on a hosted runner writes no Actions cache entry, so the HEL-1299 freeze (no change to existing
    cache keys, paths or restore/save split) holds by construction. Task 2.3 checks the diff for this.
- **D7 (red proof on a throwaway draft PR):** this satisfies the AC ("A PR that reintroduces the gap fails CI") and the
  driver constraint (red on real CI with a linked run id, then reverted, then green on the final head).
  - It waits for the red run to finish before pushing the revert, which avoids the D10 cancel-in-progress race.
  - Closing the PR triggers `cache-cleanup-pr.yml` (`pull_request_target: closed`, `gh cache delete --all --ref
    refs/pull/N/merge`). That removes the throwaway PR's setup-node npm cache entries, so the budget impact is temporary.
    Task 3.2's cache check correctly runs before 3.3 closes the PR.
  - It is no less valid than putting red and revert into the real PR's history: the squash merge would erase them anyway.
- **Precommit/CI parity guard compatibility:**
  - `scripts/check-precommit-ci-parity.mjs:95-105` parses `ci-complete`'s `needs:` with `/needs:\s*\[([^\]]*)\]/` and
    splits on commas. A hyphenated `docker-image` entry parses fine as long as the flow-sequence form stays.
  - The `docker-image` job's `run:` block (`docker build`) does not affect hook coverage.
- **Placeholders, contradictions and scope:**
  - No TODO or TBD markers. The one deferred value (the D5 timeout) has a concrete rule (~2.5x measured, run-id comment).
  - Proposal, design, tasks and spec agree with each other.
  - Both ACs map to tasks: AC1 to tasks 3.1/3.2, AC2 to task 2.2 plus the 3.1 red.
  - Nothing goes beyond the ticket's scope. No API or schema contract is affected, so no contract delta is needed.

### Verdict: CONFIRM

### Non-blocking notes

1. **Attribute the red to docker-image (task 3.1).** Beyond `docker-image = failure` and `ci-complete = failure`,
   record ci-complete's `results:` echo line. Also confirm every other job in that red run succeeded. Otherwise a
   coincidental e2e flake in the same run would make the "ci-complete gates on the new job" proof ambiguous.
2. **Make the cache check in task 3.2 attributable.** `gh cache list --ref refs/pull/N/merge` will show setup-node npm
   entries, because every PR saves those. Attribute entries by key prefix: only the existing setup-node npm keys should
   be present. Also add a static check that the `docker-image` job contains no `actions/cache*`, `cache:`,
   `--cache-to` or `--cache-from`.
3. **Keep `ci-complete.needs` as a single-line flow sequence** (`[frontend, backend, security, e2e, docker-image]`).
   The parity guard's regex returns `[]` for a block-style list, and that would silently leave the guard with nothing to
   check.
4. **D3 acceptance measurement.** Compare completion time against the latest-finishing other job (jobs can start at
   different times), not only duration. Record both values.
5. **Local measurement (task 1.1).** `nice -n 19 docker build` only nices the CLI client. The build itself runs under
   dockerd/BuildKit and will use every core. Run it when no other heavy lane is running.
   - Removing the two image tags leaves BuildKit build cache under `/var/lib/docker`. Record its size rather than
     running a broad `docker builder prune`, which would also hit other lanes' cache.
6. **Task 2.3** uses `git diff origin/main`. Prefer the `resolve-review-base.sh` SHA, or a freshly fetched `origin/main`.
7. **PR body.** State the deviation from the ticket's literal "use layer caching" bullet and the measured evidence
   (docker-image duration vs critical path, and the builder-layer sizes), so the owner sees the trade at review time.
