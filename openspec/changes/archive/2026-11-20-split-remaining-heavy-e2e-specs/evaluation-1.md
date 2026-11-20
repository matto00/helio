## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD 7984321a20909ab716f42e261bb41360c7eeccfd against live-resolved base 9a867c7c1 (origin/main, HEL-1790 included).
Task 6 (PR CI measurement, AC3) belongs to the orchestrator at Delivery and is not judged here.

### Phase 1: Spec Review — PASS
Issues: none blocking.

- AC1 (cause per spec, then split, keeping every test and assertion): variance.md names a cause per spec from 13 counting
  main runs (structural: hel1575, hel1582-mobile-pipeline; leg-wide: hel1684, state-surface, hel1573; leg-wide amplified:
  hel1582-sweep-375). All six are split on describe/loop boundaries. No cost cut was made, so no assertion path was touched.
  Part weights in the regenerated table are 73-201 s. The named exception is `hel1582-sweep-375-maximal` (300 s, one test,
  not splittable). `hel1684-draft-structural-desktop` is 201 s, which is within "about 200 s".
- AC2 (leg-wide slowdown): investigated from job logs and reports. Finding: 23/23 slow legs (factor >= 1.15) are on Azure
  and 0/59 AWS legs are slow. The slowdown is constant through a leg. variance.md says plainly what the logs cannot show
  (CPU model, steal, load). I spot-checked run 44692374356: slow leg 5 = `Cloud: Azure / Region: eastus`, leg 1 =
  `Cloud: AWS / us-west-2`, which matches the table. A per-leg runner record is added so future runs can show the cause.
- AC3: pending at Delivery (task 6), as briefed.
- Spec delta (e2e-ci-sharding): the ci.yml steps meet every SHALL (see Phase 2).
- C16: HEL-1790's files are not in the branch diff. C17: no product code, schema, migration, timeout-minutes, leg-count or
  partitioner change. Frontend/DESIGN.md edits are comment- and doc-only (verified line by line).
- C19 is honoured. Details are in Phase 2.
- Known deviation, `registerHeavySweeps` via a private `registerSweeps(size, kinds)` instead of two calls: **accepted**.
  It registers the same two tests, in the same order, under one `test.use` and one describe. That avoids the duplicate
  sibling describe the design itself flagged for 390/768. Lists, timeouts and annotations are identical (below), and
  variance.md records the deviation. design.md Decision 2 and task 3.3 still describe "two calls" (see suggestions).

### Phase 2: Code Review — PASS
Issues: none blocking.

Gates I ran fresh in WORKTREE_PATH:
- `npm run lint`: rc 0.
- `npm run format:check`: clean.
- `npm test`: 70/70 suites (617 tests) plus frontend 873/873 suites (10307 tests).
- `npm --prefix frontend run build`: rc 0.
- `check:e2e-types`, `check:e2e-user-cleanup`, `check:e2e-evidence-paths`: clean (209 files).
- `check:e2e-shard:selftest`: 28 passed.
- `check:state-contrast:selftest`: 35 passed.
- `check:ci-complete-needs`, `check:precommit-ci-parity`, `check:ci-sbt-guard`, `check:e2e-prod-build-projects`,
  `check:e2e-slow-results:selftest`: all OK.
- No backend files changed, so sbt does not apply.

Independent re-derivations:
- **Test-list parity, my own reducer.** I ran `playwright test --list --reporter=json --project=dev`, plain and with
  `HELIO_E2E_SLOW=1`, at base (main checkout, 9a867c7c1) and at HEAD. My reducer adds per-test `timeout`,
  `expectedStatus`, `annotations` and `tags`. Result: 1037 vs 1037 tests. The only diff line is an absolute-path
  difference in an untouched file's skip annotation (hel1575-switch-measurement, checkout path). The committed
  `list-before.txt` equals my base list minus exactly HEL-1790's two tests, so the baseline is truthful. Per-part test
  counts sum to the originals: 22, 2, 24, 26, 20 and 9.
- **Scope-chain proof (C19).** I re-ran `proof.mjs` at HEAD: PASS, zero differences in all six groups. hel1684's
  afterEach count429 still covers 8/13 sites on both sides. The hel1582 MAXIMAL skip gate is 3/3 on both sides. The
  mobile `test.use` is 19/19.
- **Own mutations, not the executor's.** (A) Dropping the file-level `describe.configure({mode:"parallel"})` from
  `hel1575-dashboard-tabs-dot-other-user.spec.ts` makes the proof FAIL (2 scope chains differ). (B) Changing
  `test.setTimeout` in `state-surface-contrast-guard-routes-light.spec.ts` makes it FAIL. The proof can fail.
- **Weights.** I ran `node scripts/e2e-shard.mjs weights --list <my HEAD list> 44697763503 44692374356 44683347610
  44660016746 44655001204` over the scratch artifacts. The output is byte-identical to `e2e/shard-weights.tsv`.
  `gh run list` confirms these are the 5 most recent main runs with all-green e2e legs. 44683347610's failure is
  docker-image and ci-complete only; every e2e leg succeeded. 44687930342 was cancelled and 44667845106 had an e2e
  failure.
- **Old full file names:** zero hits outside the archive, this change and scratch.
- **`npm run e2e:state-contrast-guard -- --list`:** lists 20 tests.

ci.yml runner record (the brief's checks):
- **Cannot fail a leg.** Start, identity, stop and upload are all `continue-on-error: true`, and stop and upload are
  also `if: always()`. The sampler is backgrounded with `nohup ... &` and its output redirected. This is the same
  pattern the frontend job already uses at ci.yml:171-176.
- **Cannot lengthen a leg.** The only added time is one artifact upload. The sampler is bounded at 1400 s, which ends
  before the 1500 s limit; it starts about 30 s into the job.
- **No environment dump.** The identity step reads only `/proc/cpuinfo` (model name, hypervisor flag), `nproc`,
  `/proc/meminfo` MemTotal, `uname -r`, `date` and `matrix.shard`.
- **No `results.json` in the artifact.** The directory holds only `load.ndjson`, `sampler.log` and `identity.txt`; the
  PID file is written outside it. The artifact name `e2e-runner-shard-<n>` does not match `playwright-json-shard-*`, and
  `findReports` only picks up directories that contain a `results.json`.

Code quality:
- Shared code lives once in `e2e/support/` (C18). Each part repeats the original's file-level configure, use and
  setTimeout.
- The serial-file dependency check is documented. Every test registers its own user, and there is no module-level
  mutable state.

### Phase 3: UI Review — PASS
Issues: none blocking.

The trigger matched `frontend/**`, but the frontend edits are comment-only (App.css and three `*.css.test.ts` files), so
no rendered UI changed. The observable surface of this change is the split e2e parts, so I ran a subset locally. Setup:
servers via `start-servers.sh` on 7221/10128, DB `helio_hel1789`, `ANTHROPIC_API_KEY` empty. Parts run:
`hel1582-sweep-375-c8`, `hel1575-dashboard-tabs-dot-other-user`, `state-surface-contrast-guard-routes-light` and
`hel1684-draft-structural-desktop`.

- Result: 23/24 passed.
- The one failure was the ticket's known flake candidate: the hel1684 desktop-light "insert step: Discard restores the
  saved pipeline with no request" test (formerly `:427`). It recorded the same stray
  `GET /api/pipelines/<id>/steps/<id>/preview` the ticket describes.
- That test's body and scope chain are byte-identical to base (proof). A repeat run of every Discard test in that part
  (`--repeat-each=6`, 36 runs) passed 36/36. So this is the pre-existing intermittent flake, moved verbatim, as the
  design allows. It is not a regression.
- Servers were stopped with `stop-servers.sh` (STOPPED 7221, 10128). The worktree is clean.

### Overall: PASS

### Change Requests
none

### Non-blocking Suggestions
- `design.md` Decision 2 / Decision 3 note and `tasks.md` 3.3 still describe `registerHeavySweeps` as "two calls" /
  "their composition". Add one line saying it is implemented as a private `registerSweeps(size, kinds)` with one describe
  (the reason is already in variance.md), so the planning artifacts match the code.
- variance.md's per-part medians (e.g. hel1684 `desktop` 168 s / `phone-and-kept` 158 s, sweep-375-maximal 315 s) predate
  the final regeneration: the table now has 201 / 182 / 300 s. "Medians shift by a few seconds" understates a 33 s
  shift. Refresh those numbers from the final table, or state that they come from the earlier run set.
- The hel1684 Discard flake reproduced once in 24 local runs here. It can cost a counting CI run in task 6. Name it in
  the PR, as the ticket requires, so a single `--job` rerun of that leg is pre-justified.
- Some symbols got `export` but have no consumer outside their module:
  - `hel1573-motion-primitives.ts`: PRIMITIVE_TARGET, isPrimitive, byName, rowEnters, drivePrimitives,
    expectInstantOrStill, runMode
  - `hel1575-dashboard-tabs.ts`: trackRunBaselines
  - `hel1684-draft-structural.ts`: stepWrites, closeSheet
  - `state-surface-contrast-guard.ts`: MAX_ELEMENTS_PER_VIEW, describeElement, collectCandidates

  Dropping those `export`s would keep the support API to what the parts use. This is cosmetic, and lint passes.
- `hel1575-dashboard-tabs-warm-and-palette.spec.ts` (504 lines) and `hel1582-mobile-pipeline-fit-and-touch.spec.ts` (560
  lines) remain over CONTRIBUTING's ~400-line soft budget. They are much smaller than the originals (1069 / 1204), and
  the split boundaries were chosen on measured weight, so this needs no action.
