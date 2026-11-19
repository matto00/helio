## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD `ec096b2226ab38ee0f2cfe0bbfa68967480230df`. Base resolved live via `resolve-review-base.sh` = `5f137cb5ffbf358b4ac47f044ad6fe26fce74d37` (merge-base matches). 94 files, +4532/-425.

### What I verified (with evidence)

**Acceptance criteria (child 1, ticket.md restated scope)**
- List contract: `DashboardRoutes.scala` adds `include` (`shared` only, anything else 400); `DashboardService.findAllWithPipelineFedFlag(includeShared)`; `DashboardRepository.findAllVisiblePaged` is one left join on the caller's own named grant row (`granteeId === uid`, role in {editor, viewer}), count and slice over the same query, order `last_updated desc, id asc`, role `owner` whenever `owner_id` is the caller. Public grants (null grantee) cannot match. The duplicate risk is closed by the `unique_grantee_per_resource UNIQUE (resource_type, resource_id, grantee_id)` constraint (V16), which I checked. Without `include` the list is still owner-only with `accessRole: owner`, so helio-mcp, PAT callers, assistant and search are unchanged. `schemas/dashboards/dashboard.schema.json` gains the optional `accessRole` enum, and helio-mcp's type is updated.
- RLS: `DashboardSharedListRoutesSpec` runs the full route tree over `TwoUserRlsApiFixture`, whose app pool is `helio_app_test` created `NOSUPERUSER NOBYPASSRLS` (fixture lines 126-145, read). The cases cover owned/viewer/editor/public-only/granted-to-someone-else, the self-grant listed once, paging/count across the union, 400, the schema seam and the default owner-only list. `rls-helio-app.txt` shows: (1) the list as helio_app_test; (2) pipelineFed works for the viewer; (3) `outputs` row 0 for the dashboard-only viewer and editor, 1 for the pipeline owner, which is why non-owners must avoid `/api/outputs/*`; (4a) per-panel rows/output-meta 200 for viewer/editor/owner and 404 for the stranger; 51/0. The stranger case for the list is covered by "A to C viewer" and "A private" being absent from B's list in case 1.
- Grantee opens / stranger not-found / owner unchanged / Shared marker / viewer read-only / editor edits / no Output or pipeline requests: covered by the e2e below and by my own live probes.
- HEL-921 premise: no per-panel payload route is added. The non-owner rows path goes only to `/api/dashboards/:id/panels/:p/rows` (`panelThunks.fetchPanelPage` branch). History is disabled for non-owners (`useOutputHistory`, `useCanUseOutputRoutes`), so `/api/outputs/:id/history/:point/rows` is never reachable from a dashboard-only viewer. Child 2's AC keeps this explicit.

**Gates I ran myself**
- e2e on the lane DB (`DATABASE_URL=...helio_hel1773`, set for both `start-servers.sh` and Playwright, 2 workers): the full `hel1773-viewer-grantee-dashboard.spec.ts` (8 tests), plus `hel1746-ask-ui.spec.ts` (it reads the altered "Dashboard actions"/Ask names, and covers owner ask and pin) and `hel1189-output-panel-controls-live.spec.ts` (owner controls on output panels). Result: **24 passed, exit 0**. Evidence: `ref=/home/matt/Development/helio/.concertino/runs/HEL-1773/evidence/.concertino/scratch/HEL-1773/skeptic-e2e.txt`.
- `hel909-output-picker-panel-sheet.spec.ts` (binding section) is in the config's `testIgnore`. `--list` gives 0 tests, which is pre-existing and not affected by this change.
- I did not re-run jest/lint/typecheck/sbt. No product file changed since the evaluator's cycle-3 runs on this same HEAD. Its pasted transcripts (`eval3-*.txt`) are unambiguous and match the HEAD SHA.

**Red-first / mutation evidence (read, not re-run)**
- `child1-red.txt`: on the stage-1 code, the opens/list tests are red and the owner/landing controls are green.
- `cr2-e2e-red.txt`: the switch test is red only at its own assertion.
- `mut-m8b.txt`: rows forced through `/api/outputs` turns the viewer, phone and editor invariants red.
- `mut-m7.txt`: green alone. This is disclosed as deviation 3: the meta-row gate is defense in depth, and `mut-m7b` (m7+m8b) is red. I accept that reasoning.

**Owner-regression hunt on the `outputMetaCache` scope seam (a third look)**
- Code read: `outputMetaCache.ts` (entries carry `scoped`; served only when the entry's scope equals the current scope; superseded in-flight requests are never stored; `peekOutputMeta` never captures a stub); `fetchPanels` scope/unscope; `restoreFromMemory` unscope; `warmCapture`/`showDashboardPanels` skip non-owned dashboards; `onFreshnessReset` clears scopes only on logout/`clearAuth`.
- Every non-test `fetchOutputMeta`/`useOutputMeta` consumer is inside the dashboard or panel tree. Rebind paths (`swapPanelOutput`, `createPanel`, `duplicatePanel`) all refetch through `fetchPanels`, so a newly bound Output is unscoped on an owned dashboard.
- Live probe: an editor X owns Output O, bound on owned D1/D2 and on DY, which A owns and shares with X. Steps: D1 (owned, facts "refreshed … / source · SKEP src …"), then middle-click DY into a tab and activate it (requests: `/panels`, `/output-meta`, `/rows` only), then activate the D1 tab (the warm-restore path, which the e2e does not cover). Result: facts "refreshed 1 minute ago / source · SKEP src", and the requests are the real `/api/outputs/O`, `/api/pipelines/P`, `/rows` and `/assertion-status`. Pin and sort controls are present. **No third leak found.**
- Screenshots:
  - `ref=…/evidence/.concertino/scratch/HEL-1773/skeptic-d1-initial.png`
  - `skeptic-dy-editor-1440-light.png`
- Residual theoretical race, non-blocking: `fetchPanels` applies scope/unscope even for a superseded fetch. Out-of-order resolution of two rapid switches would also leave the wrong `items` in the store, which is pre-existing behaviour (`fetchPanels.fulfilled` has no arg check). It is not introduced here.

**UI / design judgment (DESIGN.md)**
- Viewer, desktop 1440, light and dark (real theme switch via `helio-theme` and reload). The meta row shows only "2 panels" plus the assistant. There is no Edit layout, Add panel, appearance, Share, Ask or kebab, and the panel kebab offers only "View details". Panel cards and the markdown panel keep parity in both themes. Screenshots:
  - `ref=…/skeptic-viewer-1440-light.png`
  - `ref=…/skeptic-viewer-1440-dark.png`
- Sidebar "SHARED" badge: it reuses the `.dashboard-list__pinned-badge` pill recipe, so it is consistent with the sibling badge.
- Home shelf badge in dark: it uses `--app-accent-dim` and `--app-accent-text` tokens and reads correctly. Screenshot: `ref=…/skeptic-viewer-home-dark.png`.
- Phone chip badge: evaluator's `eval-viewer-390-light.png`.
- Editor on DY:
  - The "Filters" toggle and column sort remain, and work client-side over the loaded rows with zero network requests. I typed "Ea" and got 1 row; a revenue sort put West before East.
  - That fits D6's "client-side sort over the loaded page" allowance and is not broken. Screenshot: `ref=…/skeptic-dy-editor-filters-open.png`.
  - Edit layout and Add panel are present and Share is absent, matching the editor role.

**Drafted children (`children.md`)** — I checked them against the deferrals in design.md D6 and the Non-Goals:
- Child 2 covers:
  - per-panel controls, cross-filter, history, insight and provenance;
  - the freshness line, run refresh, the data-invalid badge and warm restore;
  - the detail modal's controls and the editor binding section;
  - dual-grant users;
  - HEL-921 payload rows.
- Child 3: Ask for grantees with no pin, which is the original ticket's ask-drawer AC.
- Child 4: read-only polish, including the shared-only first-run case (deviation 5).
- Child 5a: editor form submit.
- Child 5: assistant, search and helio-mcp.
- Child 6: dashboard-changes. Files-modified item 4 states the observed partial behaviour (content yes, data no), so child 6 should be filed rather than dropped.
- Every deferral I found maps to a child. Complete.

### Verdict: CONFIRM

### Non-blocking notes
- File child 6. Files-modified item 4 shows `dashboard-changes` returns content times but never data times for shared ids, so "drop if it already works" does not apply.
- The phone chip "SHARED" marker (`.dashboard-chip__shared`: opacity 0.7, no pill) differs from the sidebar and Home pill badges. Child 4 should unify the three badge recipes (the evaluator also noted the duplicated CSS).
- `PanelList` provides the selected dashboard's role while the previous dashboard's cards can still be mounted during a `fetchPanels` pending window. At worst this is a brief extra Output-route request from cards being left. Worth a guard in child 2, when these routes come back for grantees.
- `fetchPanels` applies scope/unscope even when its result is superseded. Harmless today because the stale `items` overwrite is pre-existing, but child 2 could key the scope write on `loadedDashboardId === arg`.
