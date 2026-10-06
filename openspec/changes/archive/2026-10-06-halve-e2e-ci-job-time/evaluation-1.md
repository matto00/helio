## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed head: `d2023f72e02ba0ed35285a5e17edd4187ce1bcf3`. The diff base was resolved live as `94e996d3` (merge-base with origin/main).
CI is paused by owner ruling. Nothing was pushed, re-run or dispatched. Existing CI logs were read with `gh run view`.
The guard spec files have been byte-identical since `bfc86fb2`, so CI runs 37361053631 (bfc86fb2) and 37362375592 (e43d1561) ran the guard code under review.

Tasks 2.2, 4.3, 5.1, 5.2 and 5.3 are evaluated as PENDING-CI, not as defects.

### Phase 1: Spec Review — FAIL

The following were checked and pass:

- **C3:** `e2e/hel1260-orphan-owner-repair.spec.ts` is unmodified (0-line diff).
- **C4:** every ci.yml hunk falls inside the `e2e` job (L326–463). `ci-complete` is unchanged (`needs: [frontend, backend, security, e2e]`, `if: always()`). There are no backend-job edits.
- **HEL-951 contract:** `npx playwright test --list` collects 175 tests in 36 files, with `testIgnore` untouched. `--shard=i/6` partitions that same set (30/30/30/27/29/29). CI logs show 175 tests on 6 shards, against a baseline of 149 = 149 − 2 + 28 cells.
- **Before numbers (C1):** job walls of 982/1075/897 s for 37337348981/37324205115/37324120988 match `gh run view --json jobs`. `node scripts/e2e-profile.mjs list` on the 37337348981 log reproduces the top-15 table exactly (149 tests, 36 files, 1342.8 s).
- **PR run shard walls (C1):** the walls for 37352688820, 37354906033, 37356358733, 37362375592 and 37367173384 match the job metadata.
- **D3 shape:** there are 18 + 10 cells. Both guard files use `describe.configure({mode:"parallel"})` with no `beforeAll`/`afterAll`. Titles are static, and runtime ids resolve inside each cell. Each cell asserts `unresolvedFraction < 0.5` (state-surface) or `measured > 0` (focus).
- **Per-cell unresolved fractions:** CI logs all 18 `cell "..." unresolvedFraction=0.000` (37362375592).
- **Shard spread:** guard cells span more than one shard (focus in shard 1, state-surface in shard 6).
- **Overlays replay:** the cell replays exactly `/`→`/sources`→`/pipelines`→`/pipelines/<id>`→`/connectors`→`/chat`→`/settings`→`/`. Each step is gated on readiness, and `expectRecentRecorded` polls for the titled pipeline entry. The palette Recent-row assertion is meaningful: empty-query registered actions are generic (`builtInActions.ts`/`CreateCommandActions.tsx` carry no resource names), so a row titled with the dashboard or pipeline name can only come from recents. The `command-palette` population is 15/15 on CI in both themes, equal to main.
- **Focus guard population:** all 10 per-view counts are equal to main on CI in both 37361053631 and 37362375592. That covers the cookie-login hand-off; see Phase 2.
- **Removal ledger (D2/C7):** nothing has been deleted yet, which is correct pending skeptic confirmation. Each named surviving test was checked:
  - hel510:47: `?` opens the overlay and asserts the `open` attribute plus its text.
  - hel510:196–206: Ctrl+K opens the palette and asserts `open`.
  - hel1090:446–448 and hel1088:183–185: the palette "Switch to light theme" option is used, then the test asserts `data-theme="light"` and that the palette closed.
  - hel519-recent-navigation:90–102: list-click to `/sources/:id`, then the Recent group label is visible and the source option is visible. This is stronger than hel519-screenshots' label-only check.

  None of these files is in `testIgnore`. Hover, ArrowDown and screenshots carry no assertion. Both rows hold up as class (a). The final skeptic still has to confirm them per D2.
- **hel1023/hel1028 `afterAll` change:** the residue summary is now a per-registration `console.log` of the exact email, carrying the same information. Rows are cleaned by exact id in `afterEach`/`finally`, which is unchanged.

The following fail:

1. **D3 per-view population equality does not hold on CI (task 3.1 is marked done but not met).**
   - `[HEL-866 guard] view "/sources:sidebar-rail"` is 3/3 (dark/light) in all three main baselines and in every PR run up to 37359043449.
   - On the current guard code it is **1/1** in 37361053631 (shard 5) and **3/0** in 37362375592 (shard 6).
   - The route cells (`state-surface-contrast-guard.spec.ts` ~L856–864) probe after `goto`, a `data-theme` check, `toHaveURL` and a fixed `waitForTimeout(200)`. There is no readiness gate for the sidebar rail's own content, so how much of the rail gets measured depends on load timing. Down to **0** elements is a silent coverage loss: `assertPartitioned` stamps at the same moment, so it cannot catch this.
   - profile.md's "46/46 equal" comes from a local run and is contradicted by the PR's own CI logs. D3 requires the comparison on a PR CI run.
2. **profile.md traceability and accuracy (C1 / AC "report the flake rate"):**
   - Two rows have no run id: `6b64a003` is **37359043449** and `bfc86fb2` is **37361053631**.
   - The `bfc86fb2` row says "all green", but that run's conclusion is `failure` with `ci-complete` `cancelled` (976 s). The e2e legs were green; the run was not.
   - Rows for runs with re-runs (37362375592, 37367173384) do not say which attempt each shard wall comes from.
   - "see findings" points to a section that does not exist.
   - The hel1094 failure (37356358733 shard 2) is recorded without any analysis. Its `toHaveCount(3)` received 2 after the 120 s auto-run wait. A sharded run is exactly where the AC "Parallelism must not introduce cross-test interference" needs a stated finding (attributable to sharding/parallel mode or not, with reasoning).
   - The fixed-wait inventory says "36 sites in 18 files". `git grep -c` on base 94e996d3 for CI-running specs (the 22 files minus the 4 testIgnored ones) gives 40 sites in 18 files. Correct the figure or state the counting rule.

### Phase 2: Code Review — FAIL

Gates I ran myself in WORKTREE_PATH:

| Gate | Result |
|---|---|
| `npm run lint` | exit 0, zero warnings |
| `npm run format:check` | clean |
| eslint on every changed TS/MJS file | 0 |
| prettier on every changed file | clean |
| `npx playwright test --list` | compiles, 175 tests |
| `--list --shard=i/6` | as above |

- No `frontend/**` or `backend/**` file changed, so `npm test`, the frontend build and `sbt testFull` are not triggered. No sbt was used.
- No local Playwright run was performed. The CI logs on the reviewed guard code were stronger evidence for the population and settle questions than a local run would be.

**`settleTransitions` behaviour equivalence:** I accept it as equivalent.
- It awaits every running document-wide `CSSTransition` after a frame, including reverse transitions from the previous element's cleared state, then waits one more frame. It is capped at 1 s, which is longer than the old 400 ms.
- A mid-transition read would surface as unresolved colours (Chromium `oklab(...)`, which `parseColor` refuses) or as false "clipped" focus findings. CI shows `unresolved=0` in all 18 cells and all 10 focus cells green on 37361053631 and 37362375592.
- The executor also reports mutation-red after the settle change. That is local evidence I did not reproduce, because reproducing it requires a code mutation.

**Focus guard cookie hand-off:** it does not change what is measured. All 10 focus per-view counts on CI equal main (`/settings` 34/34 included).

**Lever (2) parallel-mode files:** hel1028, hel1023, hel813, hel773, hel516-palette-quick-create, hel519-recent-navigation and hel588 were each checked.
- No `beforeAll`/`afterAll`.
- Every test registers its own user via `uniqueEmail(label)`, a random suffix, or a single `Date.now()` use.
- Module-level state is read-only constants, except hel1023's `WeakMap<Page, …>`, which is per-page.
- `beforeEach`/`afterEach` and describe-scoped `let`s are per-test-execution.
- The backend rate limiter is per-principal, so it has no cross-user coupling.
- I found no order dependence. The added hel1028 `toBeVisible()` before `boundingBox()` is a correct web-first wait.

**ci.yml:**
- The background `sbt run` starts after the sbt cache restores. The later "Wait for backend health" step still fails loudly and cats `/tmp/backend.log`.
- Artifacts have per-shard names.
- The JSON upload runs `always()` with `if-no-files-found: ignore`.
- N comes from `strategy.job-total`.

**playwright.config.ts:** `workers: CI ? 2 : undefined`, and the JSON reporter writes `test-results/results.json` on CI only. `testIgnore` is untouched.

Issues:

1. **Duplicate population-contract log line:** `e2e/focus-presence-guard.spec.ts:335-337` and `:340-342` emit the identical `[HEL-520 focus-presence guard] view "...": N focusable element(s) measured (uncapped)` line twice per cell. CI shows 20 lines instead of 10. The README now names these lines as the population contract a reviewer compares against main, so the doubled count is a readability and DRY defect, not just noise.
2. **Root cause of Phase 1 item 1:** the state-surface route cells (`e2e/state-surface-contrast-guard.spec.ts` ~L856–864) still use a fixed `waitForTimeout(200)` in place of a readiness condition (contrast with the focus guard's `ROUTE_READY_MARKERS`). The split exposed this: route cells now run on a fresh, concurrently loaded page rather than late in one warm serial walk.

### Phase 3: UI Review — N/A

No trigger path changed (`frontend/**`, `ApiRoutes.scala`, `schemas/**`, `openspec/specs/**`). This is CI/test tooling only.

### Overall: FAIL

### Change Requests

1. **Gate each state-surface route cell on its own rendered content before stamping or probing** (`e2e/state-surface-contrast-guard.spec.ts`, route-cell body ~L856–864).
   - Add a per-route readiness marker, as `focus-presence-guard.spec.ts`'s `ROUTE_READY_MARKERS` does, covering both `<main>` and the sidebar rail where the rail renders seeded content.
   - For `/sources`, at minimum: the seeded "HEL-866 Guard Source" visible inside `.app-sidebar`, plus the main-list marker.
   - Do the same for any other route whose rail lists seeded data (`/`, `/pipelines`, `pipeline-detail`).
   - Keep or remove the 200 ms settle as you judge, but do not rely on it for readiness.
   - Then re-establish the D3 per-view equality from a **PR CI run log**, not a local run, once CI resumes. Mark task 3.1 back to `[ ]` until then, and replace profile.md's "46/46 equal (local)" with the CI run id plus the result. Include the observed 37361053631 (1/1) and 37362375592 (3/0) `/sources:sidebar-rail` deviations as the reason for the change.
2. **Delete the second, duplicate `console.log`** at `e2e/focus-presence-guard.spec.ts:340-342`. Keep the one before `assertRouteFullyCovered`, so each cell emits exactly one population line, matching main's 10 lines per run.
3. **Fix profile.md traceability (C1):**
   - Fill in run ids 37359043449 (`6b64a003`) and 37361053631 (`bfc86fb2`).
   - Restate the `bfc86fb2` row as "e2e legs green; run concluded failure (ci-complete cancelled)".
   - Name the attempt number for re-run rows (37362375592 attempt 2, 37367173384 attempt 4).
   - Add the "Findings" section the table references, with one entry per red leg:
     - hel1260: 37352688820 shard 2 (dark), 37359043449 shard 3 (light), 37367173384 shard 3 attempt 1, referencing HEL-1289.
     - hel1094: 37356358733 shard 2. Received 2 rows against 3 expected after 120 s. State whether it is attributable to sharding or parallel mode, with the evidence (for example, whether hel1094 shares a shard or worker with a parallel-mode file, and whether it has failed on main).
     - hel1028 `boundingBox` null: 37362375592 shard 2 attempt 1, fixed in 4b0113a3.
   - Correct the fixed-wait inventory figure: 40 sites in 18 CI-running files on 94e996d3 by `git grep -c`, or state the counting rule that yields 36.

### Non-blocking Suggestions

- **D5 overlap gain:** the slowest leg in 37362375592 (shard 6) still had 164 s of pre-test, about the same as the baseline's 163 s. `npm ci` and the browser install got slower (15+16 s and 41 s, against 6+6 s and 23 s) while overlapping with sbt. Say this plainly in profile.md's "after" rather than implying a step-time drop, and reword task 4.2, which is marked done for "cache the Playwright browser" and "verify step timings drop". The cache was rightly dropped with measured justification, but the task text and design D5(b) should record that.
- **Unverified causal claim:** the state-surface `registerAndLogin` comment (L82–84) attributes a `/settings` 25-vs-24 difference to cookie login versus UI login. Given that Change Request 1 shows the route cells' populations are timing-sensitive, that attribution is unverified, and the focus guard's `/settings` count is unchanged (34) under the cookie hand-off. Either probe it or soften the comment to "observed once; not root-caused".
- **Fail-fast health wait:** the background-started backend's health wait could fail fast when the sbt process has died (for example `pgrep -f "sbt run"`, or recording `$!` to a file in the start step) instead of polling for 300 s. The current behaviour is loud, just slow.
- **Shard 6 bottleneck:** all 18 state-surface cells land in shard 6, which is the slowest leg (390–407 s). profile.md's modelling note already says so. If 4.3 misses, lever (2) on the files sharing shard 6 is the next move, not a larger N.
