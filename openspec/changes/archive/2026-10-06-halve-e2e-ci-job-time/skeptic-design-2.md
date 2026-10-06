## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed HEAD 94e996d3006654f5f974eab36800e40712537012. The planning artifacts are untracked in the change dir.

### What I verified (with evidence)

- **Spawn guard:** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=task/halve-e2e-ci-time/HEL-1288`.
- **Round-1 CRs, status:**
  - CR1 (parallel-mode, no beforeAll/afterAll, `--list --shard` signal) is addressed in D3 and tasks 3.1/3.2.
  - CR2 (count-based arithmetic, D5 load-bearing, tuning levers) is addressed in Context, D4, D5 and task 4.3.
  - CR3 (cells and aggregate mapping) is addressed in D3, but the population-equality proof has a gap (CR1 below).
  - CR4 (per-shard artifact names) is addressed in D8.
  - CR5 (equivalence bar and approver) is addressed in D2, but class (b) has a gap (CR2 below).
- **Playwright 1.55.1 scheduling.** The worktree has no `node_modules`. I read the main checkout's `node_modules/playwright/lib/runner/testGroups.js`; the worktree's `package-lock.json` pins `@playwright/test` 1.55.1, the same version.
  - `createTestGroups`: a test with a `parallel` ancestor and no `beforeAll`/`afterAll` (and no `default`/`serial` ancestor) becomes its own group. Default-mode tests in a file share one `general` group. Hooks route a test to `parallelWithHooks`, chunked by `expectedParallelism`. D3's "describe.configure parallel, no beforeAll/afterAll" therefore yields per-cell groups. `test.setTimeout` at describe scope is not a hook.
  - `filterForShard`: groups are assigned by group start index over a test-count range. This is contiguous and count-balanced, matching the D4 wording.
- **HEL-951 contract.** `ci.yml` e2e runs `npx playwright test`, and `testIgnore` lives in `playwright.config.ts`. `--shard` filters the config-collected suite, so the contract is kept. `ci-complete` has `needs: [frontend, backend, security, e2e]`, `if: always()`, and fails on `failure`/`cancelled`. A matrix leg failure aggregates to the job result, so D4 is correct to leave it unchanged. The single `upload-artifact` step (`name: playwright-report`) is the one D8 renames.
- **Guard populations are deterministic across runs.** I downloaded the e2e job logs for 37337348981, 37324205115 and 37324120988. All three show:
  - `[HEL-866 guard] elements probed: 490, resolved=490, unresolved=0`.
  - Focus-presence `total measured: 246`, with per-view 19/21/25/24/34 in both themes.
  - So a strict equality check is feasible. `unresolved=0` in every run, so the per-cell `unresolvedFraction < 0.5` change carries essentially no false-red risk.
- **D3 assertion mappings, checked against guard source:**
  - state-surface `assertPartitioned` (L692): `chromeCoverageHere` comes from `collectCandidates(page, chromeScope, …)` on the current route's document (L686–691). The route cell is self-contained, as claimed.
  - The per-route `toggle` expand on `/pipelines/:id` is asserted (L620–623) and needs only the cell's own seed.
  - L862 `unresolvedFraction` becoming per-cell is stricter, and the justification is sound.
  - focus-presence: `assertRouteFullyCovered` already throws on `totalStamped === 0` per view. L383 `totalMeasured > 0` becoming per-cell `> 0` is consistent with that.
  - Failure-verdict paths throw per element, so they are equivalent when split.
- **D3 population-equality proof: does NOT hold as written (CR1).**
  - The design states the populations are comparable because there are "no product code changes". That ignores in-test, cross-view browser state that the unsplit guard accumulates in one page context.
  - `RecentVisitsRouteObserver.tsx` records every `/pipelines/:id` and `/sources/:id` arrival into `localStorage["helio.recentVisits"]` (`recentHistoryStore.ts`, `RECENT_HISTORY_STORAGE_KEY`). `recentVisitsListeners.ts` records dashboard selection.
  - On an empty query, `CommandPalette.tsx` L130–131 prepends these recents to the ranked list.
  - The unsplit guard opens the palette (L716–725) after it has visited `/pipelines/${pipeline.id}` in the route loop. Its measured `command-palette` view is 15 elements per theme (r1 log: `view "command-palette" (dark): 15 visible interactive element(s), sampled 15`).
  - A split `overlays` cell that seeds and goes straight to `/` has no pipeline recent. Its palette population differs, so the sum check against 490 fails, or the cell silently measures a different set.
  - This is from source reading, not a live measurement. Either way the design asserts an equality it has not established, and it gives the executor no rule for the mismatch.
- **D2 class (b) is defined by grep, and its pre-identified exemplar is misclassified (CR2).**
  - `hel516-screenshots.spec.ts` has zero literal `expect(`, but it does assert. `expect.poll(…).toBeGreaterThan(0)` at L21–28 checks that Ctrl+K opens the palette. `getByRole("option", { name: "Switch to light theme" }).click()` at L45 fails if the option is missing. `waitForSelector(".help-overlay[open]")` at L69 checks that `?` opens the help overlay.
  - Under D2 as written, a (b) row needs no final-skeptic confirmation. A file with real explicit and implicit assertions could be removed with nothing named as surviving coverage.
- **D4 tuning procedure is correct for count-balanced contiguous sharding.** It models via `--list --shard` before spending CI runs. The levers are ordered (N, then a proven-isolated parallel file, then escalation), and it forbids reordering or renaming files to game the split. I re-derived nothing new against round 1's model, which I did not re-run. The ≤7 min target stays plausible only with D3 and D5 both landing, which the design now states.
- **D5:** the current job runs `npm ci` ×2 and the browser install before `nohup sbt run`. Overlapping them is a sound lever. The health-wait keeps loud failure with a `cat /tmp/backend.log`.

### Verdict: REFUTE

The plan is close. Sharding, HEL-951, `ci-complete`, artifacts and tuning are now sound. Two of the four judgments the gate was asked for still fail against ground truth:

- D3's population-equality "proof" rests on a false premise. Cross-view localStorage state changes the palette population.
- D2's class (b) lets a spec with real assertions out without confirmation.

Both are cheap to fix in the artifacts.

### Change Requests

1. **D3 / task 3.1: make the population-equality proof account for in-test cross-view state, and compare per view.**
   - (a) Name the order-dependent browser state the unsplit guard accumulates. At minimum that is `localStorage["helio.recentVisits"]`: recorded by `RecentVisitsRouteObserver.tsx` and `recentVisitsListeners.ts`, and prepended to the empty-query palette in `CommandPalette.tsx` L130–131. `helio-theme` is the other one, which `setTheme` already sets per cell.
   - (b) Require the `overlays` cell to replay the predecessor navigation the unsplit run performed before opening the palette (at least visit the seeded `/pipelines/<id>`), so that the measured palette set is the same set, not just the same count.
   - (c) The equality check must compare each existing per-view line (`[HEL-866 guard] view "<view>" (<theme>): N visible interactive element(s), sampled M`, 36 lines per r1 run, and the focus guard's 10 `view "…": n focusable element(s) measured` lines) against main run 37337348981. Comparing only the 490/246 totals is not enough, because a sum can hide compensating deltas.
   - (d) State the rule for a per-view mismatch: find and replay the missing state, or escalate. The cell must not be adjusted until the totals match.
2. **D2 (b): define "no behavioural expect" to include implicit assertions, and remove the mis-stated exemplar.**
   - Class (b) should apply only to a test with no explicit assertion (`expect`, `expect.poll`, `expect.soft`) and no implicit one (`waitForSelector`/`waitForURL` on a state change, or role/text-located actions whose failure is the check).
   - `hel516-screenshots.spec.ts` fails that definition (L21–28, L45, L69). Correct the "0 `expect`" claim in D2. Any removal of it goes through (a) or (c), with surviving tests named for:
     - Ctrl+K opens the palette;
     - the palette's theme-switch option works;
     - `?` opens the help overlay.
   - Alternatively, add (b) rows to the set the final-gate skeptic must independently confirm.

### Non-blocking notes

- Test titles must be static at collection time. `--list`/`--shard` see titles before any seeding runs, and the route list includes runtime ids (`/pipelines/${pipeline.id}`, `/sources/${source.id}`). Key the cells by a static label (e.g. `pipeline-detail`, `source-detail`) and resolve the id inside the cell.
- The cell counts implied by D3 are 18 for state-surface (2 × [chrome + 7 routes + overlays]) and 10 for focus-presence (2 × 5 routes; its route list differs from state-surface's). Stating them makes the `--list` count delta checkable in task 2.2/5.1.
- Context says the non-test critical path is "≈ 3.1 min", but the arithmetic paragraph uses "~2.7 min pre-test overhead". Reconcile them in `profile.md`: post-test steps vs pre-test.
- `test.setTimeout(360_000)` can drop to a per-cell budget once split. That is not required, but a hung cell would otherwise hold a shard for 6 min.
- Per-cell `unresolvedFraction`: every baseline run shows `unresolved=0`, so recording each cell's fraction is cheap. The escalation clause is unlikely to fire.
