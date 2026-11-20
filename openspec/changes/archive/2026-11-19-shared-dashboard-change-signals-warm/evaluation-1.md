## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD `6e24436f7bcc52a8480f110a21da265858db8e56`, base `d8cdfb460` (resolved live via resolve-review-base.sh).
Evidence below was produced by fresh evaluator runs. Durable copies are under `/home/matt/Development/helio/.concertino/runs/HEL-1783/evidence/`.

### Phase 1: Spec Review — PASS
Issues: none blocking.

- AC1 (data times for grantees, nothing more disclosed): `DashboardChangesRepository.changes` now runs the content query in user context. It then runs the data query in `withSystemContext`, over the readable ids only (`ANY(readable)`, never the raw request ids), with `AND p.kind = 'output'`, and it builds items from the content map. The inline bypass justification is present. `DashboardChangesRoutesSpec` covers: grantee times = newest point per bound Output; the reported ids are a subset of the grantee's own panel-list `config.outputId`s; the Output of the unshared dashboard (`oE`) never appears in the response text; editor and dual-grant users get the same time; a stranger gets nothing; a public-grant stranger gets nothing.
- AC3 (RLS): the spec runs over `TwoUserRlsApiFixture`'s `helio_app_test` pool (`NOSUPERUSER NOBYPASSRLS`, TwoUserRlsApiFixture.scala:127). The `rls-helio-app.txt` transcript runs under a NOBYPASSRLS role and shows 0 rows for the grantee on `outputs` and `output_snapshot_history`. The new query takes 0.08 ms for 12 Outputs x 600 points.
- AC2 (dots and warm cache for shared dashboards, grantee e2e): `e2e/hel1783-shared-dashboard-tabs.spec.ts` passed in my run against my own lane servers. It covers (a) a warm switch, (b) the dot plus its accessible name and a re-read through the per-panel rows route, (c) a non-null `dataUpdatedAt` with outputs = [outputId], and (d) a warm reload with zero panel-list and rows requests. Throughout, there were zero `/api/outputs|/api/pipelines` requests, zero `/api` errors and zero console errors.
- C13 / CR1: under a restore marker, `usePanelData.ts:319-334` sets `restoredMount = isFirstMountDecision && mountOwnership !== undefined && hasRestoreMarker(panel.id)` and passes `full = fullReplay || restoredMount` to `replayableQuery`. That gives the full `lastQuery`: sort, the whole filter including quick/columns/ops, and `crossFilterEq` under the existing `stillActive` rule. The same query is used for the reuse check and the dispatch. Without a marker, the argument is `fullReplay || false`, so behaviour is byte-identical. The scoped meta stub is never persisted: `buildWarmEntry` writes `outputMeta: {}` and `runBaseline: {}` for `readScope: "panel"`, and `applyWarmEntry` seeds metadata and baselines only when `scope === "output"`.
- C14 / CR2: `usePanelData.restoreMarker.test.tsx` asserts `publicRows` is not called both before and after the scoped metadata resolves. It does this for a persisted columnSort, persisted columnFilters and a URL control filter, each also under StrictMode. A separate test with a differing persisted default asserts exactly one per-panel rows request, with the `desc` sort.
- C15 / CR3: confirmed by my own re-run (below). m12 reds the sort and column-filter variants and the differing-default case, and leaves the URL-control variant green (expected). m11 reds all three variants, including the URL control filter. The Output in e2e (d) has a persisted `columnSort: revenue desc`. The persisted screenshot shows the rows in revenue-desc order after the warm reload.
- Tasks: all items are checked and match the diff.
- Scope: no `dashboardsSlice` change. No HEL-1784 file (FormRenderer, FormPanelView, PanelService, form-schema route, ApiRoutes) and no HEL-1778 file (CI shard weights, workflows) is touched. No migration.
- Red first: `04b764f62` (red, `--no-verify`, stated in its commit message) precedes the implementation commit `fe7721124`. Git history cannot show whether a hook ran, so I re-ran the hook's checks at HEAD instead. All passed: repo-integrity, lint, typecheck, e2e-types, format, schemas, spec-structure, openspec, scala-quality, test-temp-dir-hygiene, e2e-evidence-paths, e2e-user-cleanup, no-credential-leak, eslint-ts-rules, tokens and the full jest suite.

### Phase 2: Code Review — PASS
Gates (fresh, in WORKTREE_PATH):
- `npm run lint`: exit 0. `npm run format:check`: exit 0. `npm run typecheck`: exit 0.
- `npm test` (3 workers): root 70 suites / 617 tests passed; frontend 868 suites / 10257 tests passed.
- `npm --prefix frontend run build`: exit 0.
- `sbt -J-Xmx3g testFull`, sharded 4 ways (HELIO_TEST_SHARD_INDEX 0..3): 1987 + 2684 + 2177 + 3221 = 10069 passed, 0 failed. The 5 canceled tests are opt-in `HELIO_MEASURE` measurement cases.

Mutations I re-ran myself (each reverted; the worktree was clean afterwards):
- m1 (backend data query back in user context): `DashboardChangesRoutesSpec` gives 2 FAILED (the grantee case and the editor/dual/stranger case).
- m8 (`hasRunBaseline` required for scoped Outputs): jest gives 9 failed. e2e is red at `(d) DA rows requests` (spec line 344).
- m11 (marker consumed by the first `isReusable`): 6 failed, including the URL-control-filter variant and its StrictMode version.
- m12 (stripped mount query under a marker): 5 failed (sort and column-filter variants, their StrictMode versions, and the differing-default case). The URL-control variant stays green, as expected.
- My own probe "mX" (memory restore refused for `scope === "panel"`): e2e is red at `(a) DA panel-list requests` (line 272). So step (a) does exercise the warm memory restore.

Code-quality notes: the new modules are small (`restoreMarkers.ts` 53 lines, `applyPanelReadScopes.ts` 21 lines, `warmScope.ts` 22 lines). The factoring removes the duplicated read-scope loop between `fetchPanels` and the restore. The owner branch of `isReusable` is unchanged. Types are strict, and there is no `any`. The marker is cleared on expire, logout, and another dashboard's fetch or restore.

### Phase 3: UI Review — PASS
- Happy path as a grantee: e2e hel1783 passed (1.2 min). The dot's accessible name is "…, changed since you last viewed". New data is read through the per-panel route. The warm reload shows the persisted sort.
- Unhappy and invariant paths: the spec asserts zero `/api` 4xx/5xx responses and zero console errors across the flow. A scope mismatch or unknown role falls back to a cold load (jest).
- Owner and sibling behaviour unchanged: hel1575-dashboard-tabs, hel1575-delayed-restore-no-update-loop, hel1575-reload-after-edit, hel1575-switch-measurement, hel1773-viewer-grantee-dashboard, hel1780-shared-dashboard-panel-features and hel1786-shared-dashboard-freshness gave 44 passed and 1 skipped (the opt-in hel1575 switch-measurement median test), in 7.3 min with 2 workers against my lane servers (DB `helio_hel1783`, DATABASE_URL set for both the servers and Playwright).
- e2e grep: the change alters no selector, accessible name or visible text. No component, CSS or markup file is in the diff. A grep of `e2e/` for warm-cache and data-time assertions found nothing that encodes the old HEL-1773 "non-owned is never warm" rule outside the specs above, which pass.
- Breakpoints: no rendering, layout or CSS code changed, so there is no layout surface to break. Desktop evidence: `/home/matt/Development/helio/.concertino/runs/HEL-1783/evidence/e2e-evidence/HEL-1783/viewer-shared-tab-reload-warm.png`.

### Overall: PASS

### Change Requests
(none)

### Non-blocking Suggestions
- `frontend/src/features/panels/hooks/usePanelData.ts` grew from 504 to 547 lines, past CONTRIBUTING.md's ~400-line "propose a split" threshold. The 23-line marker-timer effect (lines ~195-210) could become a small `useRestoreMarkerUnmountConsume(panelId, ownsMount)` hook beside `restoreMarkers.ts`. Otherwise, propose the split in the PR body.
- The CR2 jest cases assert only on the `fetchPublicPanelRows` mock. Mocking `outputService` rows and asserting it is not called would make the "zero rows requests" claim cover both rows paths in jest. The e2e already covers the Output-route invariant.
- Design D5 claims m3 and m8 redden e2e step (a). In both the executor's run and mine, they redden only (d), because (a)'s memory path does not depend on capture or on the marker. My mX probe shows (a) is still non-vacuous. Correct the mapping in design.md or files-modified.md so the record matches what actually happens.

Durable evidence: jest.txt, mutations-eval.txt, m1-backend.txt, e2e-hel1783.txt, e2e-m8.txt, e2e-mX-norestore.txt and e2e-siblings.txt, all under `/home/matt/Development/helio/.concertino/runs/HEL-1783/evidence/.concertino/scratch/HEL-1783/eval/`.
