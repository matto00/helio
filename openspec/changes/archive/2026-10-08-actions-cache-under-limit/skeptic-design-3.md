## Skeptic Report — design gate (round 3, skeptic-design-3.md)

### What I verified (with evidence)

- Spawn-cwd guard: `assert-cwd.sh` returned `READY ambient=/home/matt/Development/helio branch=task/actions-cache-under-limit/HEL-1299`.
  HEAD is 6caba6b130154a03f5ccd61d985175969fb9c641 (main). The change dir is untracked, so these are planning artifacts only.
- I read ticket.md, proposal.md, design.md, tasks.md, specs/ci-actions-cache-budget/spec.md and skeptic-design-2.md in full.
- **Round-2 CR1 (timing signal + source-change case + ac policy): fixed.**
  - (a) D2, C2 and task 2.3 now record each leg's "Compile and test" time and the prune step's time, compared against
    the base main run. The rule returns to the design gate if any leg is more than 10% and more than 30 s slower.
    workflow-state.md CONSTRAINTS C2 carries the same text.
  - (b) Task 6.1 now adds a temporary, reverted commit that changes one `backend/src` file as well as `backend/build.sbt`,
    and requires a small "compiling N" count in the log.
  - (c) D2 now states the selective `ac` policy: an entry is kept only if every blob it names survives. `proc`,
    coursier and ivy are never touched. Task 5.2's fixture asserts all of this.
- **Round-2 CR2 (spec vs D4 allowlist): fixed.** The spec requirement now names the sbt dependency family with KEEP=1.
  It also adds the "superseded sbt dependency entry" scenario, so it agrees with D4 and task 4.1.
- **Round-2 CR3 (stale Risks line): fixed.** The Risks section now cites the PR prune canary and the C2 thresholds. The
  local-proof / "fallback D2" wording is gone.
- Non-blocking notes from round 2 are folded in: `GH_TOKEN` is allowed by the 5.3 static check, and 5.3/5.4 are in order.
- I checked the design's factual claims against `.github/workflows/ci.yml` at 6caba6b1:
  - "Cache sbt" is `actions/cache@v6` in backend (l.183), security (l.287) and e2e (l.526).
  - The compile cache is restore-only, with a main/shard-0/no-exact-hit save (l.201-242).
  - The backend compile key hashes `backend/src/**` + build files, so restore-keys falls back to main's newest entry.
  - `cd-frontend.yml:31` has `cache: npm`, and `cd-backend.yml` has no cache step.
  - All of these match design.md Context.
- Local sbt 2 cache layout (read-only `ls`/`head`, no writes): `~/.cache/sbt/v2/{ac,cas,proc}`. `target/out` symlinks
  resolve to absolute `.../v2/cas/sha256-<hex>-<size>`. An `ac` entry is JSON with
  `outputFiles: ["${OUT}/...>sha256-<hex>/<size>"]`. This confirms D2 can be implemented as described.
- Driver constraints are honoured in the artifacts:
  - No CodeQL change (D6 and the spec requirement).
  - PR-close cleanup deletes only the exact `refs/pull/<N>/merge` (D5 and the spec).
  - AC1/AC2/AC5 are driver-run after merge (proposal and task 6.3).
  - No cache experiment writes under `~` (C1).
  - Janitor deletions get a dry run before merge (Migration, task 6.2).
- AC coverage: AC1 → 6.3 + estimate, AC2 → D3/3.1/6.3, AC3 → D1/6.1, AC4 → D6/spec/6.3, AC5 → C2 in lane + 6.3 after merge.
  Every AC is covered, and I found no scope drift.

### Verdict: CONFIRM

### Non-blocking notes

- The `ac` blob reference format (`sha256-<hex>/<size>`) differs from the CAS filename (`sha256-<hex>-<size>`). The
  prune script and its 5.2 fixture must normalise the two forms. A fixture using the filename form would pass while
  real CI drops every `ac` entry.
- Many `ac` entries name small "value" blobs (`${OUT}/value/...json`) that `target/out` never symlinks. Under the
  current rule these entries are dropped, so the selective keep may behave close to a wholesale drop in practice. The
  C2 timing canary is the safeguard that matters here. Report how many `ac` entries were kept and how many dropped in
  the prune log.
- "Compile and test" includes `testFull`, so one run against one base run is noisy. If C2 trips by a small margin,
  re-run before treating it as a real regression.
- Task 6.1 puts the `build.sbt` comment and the `backend/src` comment in one commit. If that run shows a large compile
  count, the cause is ambiguous. Two commits, or reading which sources were recompiled, would separate the causes.
