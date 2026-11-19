## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD `4f1717739457afa9a913215a06230156669d7e23` against base `b2603ab7998f3e9b4bdca5089a18f89da16fdc8b` (resolved live with `resolve-review-base.sh`). Every gate below is my own fresh run. Transcripts are in `.concertino/scratch/HEL-1786/eval-*.txt`.

### Phase 1: Spec Review — FAIL

The acceptance criteria hold:
- **Grantee features use dashboard-scoped routes only.** Viewers and editors get all three features through `GET /api/dashboards/:id/panel-status` plus the per-panel rows and provenance routes. The owner path is unchanged.
- **Access and RLS.** The dashboard ACL is checked on every request. A stranger and an unknown id get the same 404, and no session gets 401. RLS was proven as `helio_app_test`: with a user context, the grantee's own `SELECT` returns 0 rows from outputs, pipelines and history, yet the route returns 200 with data. That counter-check is self-authenticating.
- **Disclosure.** The key allow-list, a forbidden-substring check for ids, error text and step names, and a schema with `additionalProperties: false` are all present.
- **e2e.** The viewer and editor runs and the phone run make zero `/api/outputs/` or `/api/pipelines/` requests.
- **Red first.** Commit 7fc82e27b contains only tests and planning files, no implementation.
  - Backend red: the route was absent (404 / missing `items`).
  - Jest red: missing modules, which tasks 1.3 allows.
  - e2e red: the fact was absent for viewer, editor and phone.

Tasks are all marked done and match the diff. `CONSTRAINTS` is empty. No scope creep. The `files-modified.md` deviation is acceptable: `forOutput` and `sourcesFor` share the private `orderedSourceIds` rather than one calling the other, and there is still one derivation.

Issue (spec divergence from the CONFIRMED design D6):
- **The e2e no longer proves the "refreshed" fact.** D6 says the desktop meta row "shows the refreshed fact" and the phone pass asserts "the 'refreshed' caption". After the red commit, the e2e was loosened to accept `/^(refreshed|last run failed) /` (`e2e/hel1786-shared-dashboard-freshness.spec.ts:293-295` and `:340-342`).
- **Root cause, which I verified, is a race in the fixture itself.**
  - Appending the violating row to the checked source (`:186-191`) arms a dataset-write auto-run.
  - The blocked manual run at `:192` does not cancel it: per HEL-1739, a failed run cancels nothing.
  - So a second blocked run of the checked pipeline can land after pipeline 1's run at `:237`.
  - In my green run the two runs were about 1 s apart (screenshot: "refreshed 3 seconds ago" vs the checked panel's provenance "Last run failed 4 seconds ago").
- **What this costs.** The e2e can no longer catch a wrong "latest item" selection or a succeeded-to-intent mapping regression end to end. The comment at `:203-204` ("Run LAST so it is the dashboard's most recent run and the meta row reads 'refreshed'") is now false.
- **Mitigation.** Jest (`dashboardMeta.fromStatus.test.ts`, `DashboardFreshness.shared.test.tsx`) does cover the mapping, and `e2e/hel1773-viewer-grantee-dashboard.spec.ts` asserts exactly `/refreshed/` for a single-pipeline dashboard. So this is a deterministic-fixture gap, not a product defect.

### Phase 2: Code Review — PASS

Gates (fresh, in `WORKTREE_PATH`):

| Gate | Result |
| --- | --- |
| `npm run lint` | exit 0 |
| `npm run format:check` | exit 0 |
| `npm run typecheck` | exit 0 |
| `npm test` (3 workers) | 70 + 863 suites; 617 + 10200 tests passed |
| `npm --prefix frontend run build` | exit 0 |

Backend: I ran 9 affected specs with `sbt -J-Xmx3g -batch -Dsbt.server.autostart=false "testOnly ..."`. Both project-path lines name this worktree, and the result is 222 tests succeeded, 0 failed. The specs were:
- `DashboardPanelStatusRoutesSpec`
- `ExistenceNotLeakedRoutesSpec`
- `ProvenanceServiceSpec`
- `OutputRoutesSpec`
- `PublicProvenanceRoutesSpec`
- `ProvenanceRoutesSpec`
- `DashboardGranteePanelRoutesSpec`
- `PublicRouteOwnerIdLeakSpec`
- `DashboardSharedListRoutesSpec`

**Deviation:** I did not re-run the full `sbt testFull`. The executor's run took 1182 s, which is over the 600 s foreground tool ceiling, and the lane constraints forbid running a suite in the background past that ceiling. The executor's `sbt-testfull-summary.txt` (10023 succeeded, 0 failed) is therefore an unverified claim. The specs on the code paths this change touches are verified.

My own mutation spot-checks. Each was restored with `git checkout -- <file>`, and `git status` was clean afterwards:

| Mutation | Change | Result |
| --- | --- | --- |
| m2 | ACL removed from `DashboardPanelStatusRoutes` | red at `DashboardPanelStatusRoutesSpec.scala:159` (stranger got 200, not 404) |
| m3 | `AssertionStatusRule` uses the latest run of any status | red at `:177` (dry-run case invalid = true) |
| m8 | `dataUpdatedAt` from `pipeline.lastRunAt` | red at `:145` and `:208` |
| m5 | `PanelProvenance` forces the badge off in panel scope | jest `PanelCard.sharedBadge` red (2 failures, badge button not found) |

Changes made to the tests after the red commit, each checked:
- **Backend spec dropped its "running → null" case.** This is justified: `V22__pipelines.sql:6` limits `last_run_status` to `IN ('succeeded','failed')`, so that row cannot be stored.
- **`PanelCardBody.statusRefresh.test.tsx` changed `getOutputById` "not called" to "no added call".** This is acceptable, because the real-browser invariant (zero `/api/outputs/` requests) holds in the e2e.

Code observations (none blocking):
- `OutputService.assertionStatus` now uses `latestNonDryRunInternal`. That is the same filter and ordering as `listByPipelineInternal(...).find(_.status != "dry_run")`, but with a `LIMIT 1`, and the existing Output route specs pass.
- The read budget matches design D1/risk 2. There is no `count(*)` and no snapshot row read on the poll path.
- The store has a ref-count, one request in flight per dashboard, polls only while visible, keeps the last snapshot on a failed read, never fires on the baseline, triggers on `dataUpdatedAt` only, and is reset on logout.
- `PanelCardBody` invalidates the provenance cache and refreshes the history cache when the trigger fires.
- No dead code, no `any`, and the comments are accurate.

### Phase 3: UI Review — PASS

I started servers on the lane DB `helio_hel1786` with `start-servers.sh` (DB_USER set, `ANTHROPIC_API_KEY` empty), confirmed them with `assert-phase.sh servers` (PASS), and stopped them afterwards with `stop-servers.sh`.

- **New e2e file:** `e2e/hel1786-shared-dashboard-freshness.spec.ts`, 3 passed (43.6 s). Viewer and editor desktop runs plus the phone run show:
  - zero Output or pipeline requests
  - no `/api` 4xx/5xx responses
  - no console errors
  - the "Invalid data" badge, which opens provenance
  - the run-finish refresh without a reload
- **Touched-selector e2e:** I grepped `e2e/` for `dashboard-refresh-line`, "Invalid data", "Data checks failed", "Refresh dashboard", the meta-row fact classes and the fact text. These hit files ran green, 108 passed (5.6 m):
  - hel1065, hel1398, hel1444
  - hel1583 glass-nav, hel1583 refresh-line-no-shift
  - hel1646, hel1681, hel1738
  - hel1773, plus hel1780 as a related grantee file
- **Screenshots:** I reviewed `e2e-evidence/HEL-1786/viewer-invalid-badge.png` (1280 desktop: meta row fact and sources, badge, provenance popover) and `viewer-phone.png` (390: refreshed caption, refresh button, new rows). No layout breakage.
- **Breakpoints:** 1100 and 768 were not separately resized. The grantee render path is the same `DashboardMetaFacts` / `DashboardRefreshLine` markup the owner path uses, and the existing refresh-line e2e files above cover it.

The accessible name "Data checks failed - view provenance" is a button, reachable as a role-based locator.

### Overall: FAIL

### Change Requests
1. **Make the e2e freshness fixture deterministic and restore the design's `refreshed` assertion** (`e2e/hel1786-shared-dashboard-freshness.spec.ts`).
   - In `beforeAll`, after the checked pipeline is shown invalid (`:193-201`), wait until the dataset-write auto-run the row append armed has drained before creating or running pipeline 1. For example, poll `pipeline_auto_run_debounce` for `checkedPipeline.id` through `e2e/support/db.cjs` until no row remains, then wait until the checked pipeline's run count is stable or no run is in flight.
   - Then change `:293-295` and `:340-342` back to `toHaveText(/^refreshed /)`.
   - Keep the comment at `:203-204` true, and remove the "accepts either" note from `files-modified.md` Known limits.
   - Accepted alternative: if a deterministic drain is not achievable, assert the exact expected text derived at assertion time from the owner's view. Read both pipelines' `lastRunAt`/`lastRunStatus` through the owner API, pick the latest, and expect `refreshed` if it succeeded, else `last run failed`, inside an `expect.poll`. Either way the e2e must fail if the wrong item is selected or the intent is mapped wrongly.

### Non-blocking Suggestions
- **m6 is not red in the e2e** (Known limits). It is red in jest (`DashboardFreshness.shared.test.tsx`), and the reason given holds: the panel-scope Output-meta cache makes the mutated hook issue no request in the browser. Acceptable as documented.
- **The phone test does not isolate the "Refresh dashboard" control.** It checks `statusReads.length > 1` within 10 s. A second read from a remount, rather than from the button, could also satisfy it. Consider asserting the count increments by exactly one right after the click (compare a count taken just before the click).
- **`DashboardPanelStatusService.scala:303` uses `op.outputId.get` after an `isDefined` guard.** `collect { case op: OutputPanel => op.outputId.map(o => op.id.value -> o.value) }.flatten` would avoid the `.get`.
