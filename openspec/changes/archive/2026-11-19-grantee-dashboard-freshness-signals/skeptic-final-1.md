## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD `0b27956bb0381ce948c5bfbcf5dc7f6dfe54e678`. The review base was resolved live: `resolve-review-base.sh` returned `b2603ab7998f3e9b4bdca5089a18f89da16fdc8b`, with exit 0. That diff has 4 commits and 82 files. The working tree is clean apart from the untracked `evaluation-2.md`. Spawn-cwd guard: `READY`.

### What I verified (with evidence)

**(a) Full backend suite: established by me, within the 600 s tool limit.** The executor's run took 1182 s, so I could not repeat it in one foreground call. I used the repo's own CI shard mechanism instead (`HELIO_TEST_SHARD_INDEX`/`HELIO_TEST_SHARD_COUNT`, `build.sbt` ~236). That mechanism verifies the partition is exact before it runs. I ran four foreground `sbt -J-Xmx3g testFull` runs under `nice -n 19` and `timeout 590`, one after another:

| shard | suites | succeeded | failed | canceled | elapsed | exit |
|---|---|---|---|---|---|---|
| 0/4 | 169 | 2134 | 0 | 4 | 243 s | 0 |
| 1/4 | 190 | 2670 | 0 | 0 | 274 s | 0 |
| 2/4 | 190 | 1995 | 0 | 1 | 270 s | 0 |
| 3/4 | 190 | 3224 | 0 | 0 | 275 s | 0 |
| **sum** | **739** | **10023** | **0** | **5** | | |

- Every shard logged `[hel1468-guard] ScalaTest summary: failed=0 aborted=0 unreadable=0`.
- The sums match the executor's claimed 739 suites, 10023 succeeded and 5 canceled exactly.
- `DashboardPanelStatusRoutesSpec` ran in shard 2.
- Transcripts:
  - `/home/matt/Development/helio/.concertino/runs/HEL-1786/evidence/.concertino/scratch/HEL-1786/skeptic-sbt-shard0.txt`
  - `/home/matt/Development/helio/.concertino/runs/HEL-1786/evidence/.concertino/scratch/HEL-1786/skeptic-sbt-shard1.txt`
  - `/home/matt/Development/helio/.concertino/runs/HEL-1786/evidence/.concertino/scratch/HEL-1786/skeptic-sbt-shard2.txt`
  - `/home/matt/Development/helio/.concertino/runs/HEL-1786/evidence/.concertino/scratch/HEL-1786/skeptic-sbt-shard3.txt`

**Frontend gates (fresh):**
- `npm --prefix frontend run lint`: exit 0.
- `typecheck`: exit 0.
- `format:check`: exit 0.
- Full jest with 3 workers: 863/863 suites and 10200/10200 tests, exit 0. Transcript: `/home/matt/Development/helio/.concertino/runs/HEL-1786/evidence/.concertino/scratch/HEL-1786/skeptic-jest.txt`.

**e2e (fresh):** I started servers with `start-servers.sh` on the lane DB. The backend log shows `jdbc:postgresql://localhost:5432/helio_hel1786`; the run used `ANTHROPIC_API_KEY` empty and `assert-phase.sh servers` returned PASS. With the same `DATABASE_URL` I ran Playwright with 2 workers on two files:
- `e2e/hel1786-shared-dashboard-freshness.spec.ts`
- `e2e/hel1773-viewer-grantee-dashboard.spec.ts`

Result: **11 passed**. The harness deleted the 7 throwaway users it created. Servers were stopped with `stop-servers.sh` (`STOPPED ports=7218,10125`). Transcript: `/home/matt/Development/helio/.concertino/runs/HEL-1786/evidence/.concertino/scratch/HEL-1786/skeptic-e2e.txt`.

**AC trace:**
1. **"Each feature works for viewers and editors through a dashboard- or panel-scoped route":**
   - New route `DashboardPanelStatusRoutes.scala`: `GET /api/dashboards/:id/panel-status` inside `authorizeResourceWithSharing("dashboard", …)`.
   - Freshness: `DashboardMetaRow.tsx` and `DashboardRefreshLine.tsx` use `useSharedDashboardMeta` for non-owners. The owner's hook gets `NO_PANELS`, and the shared hook gets a `null` id for an owner.
   - Run-finish refresh: `PanelCardBody.tsx`, `usePanelStatusRefresh` in panel scope. It re-reads rows through the per-panel rows route.
   - Badge: `PanelCard.tsx` takes `status?.invalid` in panel scope, and `PanelProvenance.tsx` no longer forces the badge off.
   - The e2e drives all three for both the viewer and the editor.
2. **"Re-checks access per request; stranger 404; RLS as NOBYPASSRLS":**
   - The ACL directive runs on every request. I read `AclDirective.scala:80-156`: the owner gets Owner, a grant row gives its role, and no grant with no token gives 404.
   - The spec runs over the `helio_app_test` pool, created `NOSUPERUSER NOBYPASSRLS` (`TwoUserRlsApiFixture.scala:127,144`).
   - A stranger's 404 body equals the unknown-id 404 body, and no session gets 401.
   - RLS transcript (`rls-helio-app.txt`): the dashboard-only viewer's own `SELECT`s on `outputs`, `pipelines` and `output_snapshot_history` return 0, 0 and 0 rows. The route still returns 200 with non-null `lastRunAt` and `dataUpdatedAt` and non-empty `sources`.
   - `ExistenceNotLeakedRoutesSpec` also has a row for the new route.
3. **"Reveals nothing beyond the grantee's panels":** see (c) below.
4. **"An e2e as viewer and editor exercises each feature and asserts no request to /api/outputs/ or /api/pipelines/":**
   - `watchNetwork` records every grantee-page request matching `^/api/(outputs|pipelines)(/|$)`. `expectInvariant` asserts that list is empty, along with no `/api` 4xx/5xx and no console errors.
   - This applies to the viewer test, the editor test and the phone test. All owner seeding goes through a separate owner context.
5. **"Tests that fail first":**
   - Red commit `7fc82e27b` comes before the implementation commit `5a17dcf07` in `git log`.
   - Red transcripts: `evidence/red-backend.txt`, `red-jest.txt`, `red-e2e.txt`.
   - Mutation transcripts m1 to m9. I read m7-e2e: with the trigger removed, the run-finish step goes red at `cell 'North'` after 45 s. I read m5: the badge goes red in jest.

**(b) Is "an e2e exercises each feature" genuinely proven? Yes, for each feature. One weakness is noted below.**
- **Run-finish refresh** is the strongest assertion: the new region appears without a reload. It is deterministically red under m7.
- **Badge**: deterministic. The test asserts presence on the checked panel, absence on the table panel, and that it opens provenance.
- **Freshness fact**: the e2e proves the fact is rendered for both roles, from the status route, with the source name. The expected prefix is derived live from the owner API.
  - The weakness: whether this one assertion catches a wrong latest-pick or a wrong intent mapping depends on timing, because of the auto-run race (the evaluator's measurement).
  - That logic is proven deterministically in jest, in `dashboardMeta.fromStatus.test.ts` (latest pick, intent mapping, never/unknown, source cap). That is the right layer for it.
  - The AC asks the e2e to *exercise* each feature, and it does. I do not treat the per-test intermittency as a gap in the AC.

**(c) Disclosure.**
- `DashboardPanelStatusResponse.fromDomain` copies fields one by one into a hand-written `RootJsonFormat`. The only keys it emits are `items`, `sources`, `panelId`, `lastRunAt`, `runStatus`, `dataUpdatedAt` and `invalid`.
- `runStatus` is filtered to exactly `succeeded`/`failed`.
- The spec's allow-list test checks the exact key sets. It also checks that the raw body contains none of: the pipeline id, step id, run id, both Output ids, the second root's id, the owner id, a seeded `errorLog` string, the pipeline name, or `"assert"`.
- The schemas set `additionalProperties: false`, and the spec proves a `pipelineId` key fails validation.
- `sources` comes from the same `orderedSourceIds` derivation that provenance uses. The two-root test proves an unread root's source name is absent.
- Everything disclosed is already visible to the grantee through the panel list's `dataAsOf` and per-panel provenance.

**(d) RLS as NOBYPASSRLS:** covered under AC 2 above.

**(e) Sibling-lane files:** `git diff --stat` touches none of `PublicDashboardRoutes.scala`, `FormRenderer.tsx`, `FormPanelView.tsx` or `features/ask/**`. `ApiRoutes.scala` has only an import, a service val and a route line.

**Refactor safety:**
- `OutputService.assertionStatus` moved from `listByPipelineInternal(...).find(_.status != "dry_run")` to `latestNonDryRunInternal`. That method sorts by `startedAt desc` and filters `status =!= "dry_run"`, the same ordering as before (`PipelineRunRepository.scala:560-596`), so behaviour is unchanged. The null-`runRepo` short-circuit is kept.
- The rule now lives in one place, `AssertionStatusRule`.
- The full suite is green, including the existing assertion-status and provenance specs.

**UI / design judgment** (screenshots from my e2e run, all three persisted):
- `/home/matt/Development/helio/.concertino/runs/HEL-1786/evidence/e2e-evidence/HEL-1786/viewer-freshness.png`
- `/home/matt/Development/helio/.concertino/runs/HEL-1786/evidence/e2e-evidence/HEL-1786/viewer-invalid-badge.png`
- `/home/matt/Development/helio/.concertino/runs/HEL-1786/evidence/e2e-evidence/HEL-1786/viewer-phone.png`

What they show:
- **Desktop meta row (viewer):** "2 panels · refreshed 2 seconds ago · sources · …", with the green success dot. Same typography and layout as the owner row.
- **"INVALID DATA" pill:** in the checked panel's footer, beside "OUTPUT (i)" and "UPDATED". It opens the existing public provenance popover, whose Checks section shows "1 failed" in danger colour.
- **Phone:** the "refreshed 16 seconds ago" caption with the Refresh control in the reserved slot. The cards do not shift, and the new rows (North, South) are visible.
- The change adds **no CSS and no new markup**. Every surface reuses the owner's existing components (meta-row facts, `DashboardRefreshLine`, `ProvenanceTrigger` badge) with the data source swapped. Token use, spacing and hierarchy are therefore the owner path's, unchanged, and consistent with sibling screens.
- Light theme: I did not capture it. That is acceptable for this change because no styles or classes changed (see notes).

### Verdict: CONFIRM

### Non-blocking notes
- **e2e freshness robustness:** the evaluator's two suggestions still stand and are worth a follow-up: drain the checked pipeline's pending auto-run in `beforeAll`, and raise the `expectFact` poll timeout above `PANEL_STATUS_POLL_MS`. The `expectFact` timeout is 15 s, the same as the poll interval, which leaves a small green-run flake margin. My run passed.
- **Phone badge:** the phone stack still renders no "Invalid data" badge for any role. That is pre-existing and the same for owners, so this change does not regress it.
- **Light theme:** not screenshotted. The diff contains no stylesheet or className change, so parity is inherited from the owner path, which already ships in both themes.
- **Gate audit:** this gate does not rest on any mtime-ordering evidence.
