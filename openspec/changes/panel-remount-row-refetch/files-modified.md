- `frontend/src/features/panels/state/outputFreshness.ts` — new import-free module: per-Output/pipeline/global generation, retain/release refcount with `REMOUNT_GRACE_MS`, reset hooks (D1)
- `frontend/src/features/panels/state/outputMetaCache.ts` — new shared `GET /api/outputs/:id` cache: in-flight merge, retention/generation-gated serving, failures evicted (D3)
- `frontend/src/features/panels/state/panelRowsReuse.ts` — new pure `normalizeQuery` / `isReusable` / `isPendingFor` (D2)
- `frontend/src/features/panels/hooks/useOutputRetention.ts` — new hook: a mounted card retains its Output (StrictMode-safe)
- `frontend/src/features/panels/hooks/usePanelData.ts` — `mountOwnership` option, `ownershipSkippedKey` early return (N1), live-store reuse/pending skip, `waitForOwnedRequest` (N2/N3), refresh always fetches
- `frontend/src/features/panels/hooks/usePanelSortFilter.ts` — the one-time correction sets the mount-ownership token and skips when the window is reusable/pending (live store)
- `frontend/src/features/panels/hooks/useOutputMeta.ts` — reads/writes the shared cache; held value is the initial state (no flash, no request)
- `frontend/src/features/panels/ui/PanelCard.tsx` — retains its Output, owns a `mountOwnership` token, passes it to usePanelData and the body
- `frontend/src/features/panels/ui/grid/MobilePanelStack.tsx` — same wiring for `MobileStackPanelBody`
- `frontend/src/features/panels/ui/PanelCardBody.tsx` — threads `mountOwnership` into `usePanelSortFilter`
- `frontend/src/features/panels/types/panel.ts` — `lastFetchOk` / `generation` / `lastError` on `PanelPaginationState`, `PanelFetchError`
- `frontend/src/features/panels/state/panelsSlice.ts` — pending/fulfilled/rejected record the reuse bookkeeping (page-0 only; load-more carries it forward)
- `frontend/src/features/panels/state/panelThunks.ts` — `fetchPanelPage` returns the generation read at request start
- `frontend/src/features/panels/services/pipelineRunFanout.ts` — `lastObservedRunIdByPipeline` survives `closeEntry`; `hasRunBaseline`; `invalidatePipeline` on every observed succeeded run (D5)
- `frontend/src/features/pipelines/services/outputService.ts` — create/update/delete invalidate (D4)
- `frontend/src/features/pipelines/services/pipelineService.ts` — pipeline/step/root/reorder/run writes invalidate (D4)
- `frontend/src/features/patchSets/services/patchSetService.ts` — apply/undo `invalidateAll` (D4)
- `frontend/src/features/proposals/services/combinedProposalService.ts` — apply `invalidateAll` (D4)
- `frontend/src/features/pipelines/services/pipelineProposalService.ts` — apply `invalidateAll` (D4)
- `frontend/src/features/onboarding/services/firstRunService.ts` — first-run dashboard/template `invalidateAll` (D4)
- `frontend/src/features/auth/state/authSlice.ts` — logout resets the freshness state and metadata cache (D4)
- `frontend/src/test/jest.setup.ts` — global `beforeEach(resetOutputFreshness)` so module-level caches never leak between tests
- `frontend/src/test/remountFixtures.tsx` — shared fixtures/harness (4 panel kinds incl. persisted sort + URL control)
- `frontend/src/features/panels/ui/grid/PanelGrid.remountReuse.test.tsx` — red-first StrictMode crossing test (rows + metadata == 0 across 3 crossings)
- `frontend/src/features/panels/ui/grid/MobilePanelStack.remountReuse.test.tsx` — CR2 ordering: one page-0 request for a persisted-sort card and a cross-filtered card
- `frontend/src/features/panels/hooks/usePanelData.remountReuse.test.tsx` — reuse/refetch matrix, in-flight sharing, error surfacing (N2/N3), ownership
- `frontend/src/features/panels/state/outputMetaCache.test.ts` — merge, no failure caching, retention-vs-fetch-age, edit then remount
- `frontend/src/features/panels/state/panelThunks.generationStamp.test.ts` — slice-level guard that a window is stamped with the generation at request start (M26)
- `frontend/src/features/panels/state/panelRowsReuse.test.ts` — normalize equality and each `isReusable` precondition
- `frontend/src/features/panels/state/panelsSlice.reuseFields.test.ts` — the pagination bookkeeping reducers
- `frontend/src/features/panels/state/writeInvalidation.test.ts` — table-driven: every D4 write path invalidates exactly what it can touch; logout resets
- `frontend/src/features/panels/services/pipelineRunFanout.remount.test.ts` — unobserved run notified on reconnect; no baseline for running/never-run/failed `runs/latest`
- `frontend/src/features/panels/state/panelsSlice.test.ts` — expected page-0 shape gains `lastFetchOk`/`generation`/`lastError` (legitimate shape change)
- `e2e/hel1392-remount-request-burst.spec.ts` — Playwright: ALL `/api` requests across N=3 desktop<->phone crossings (read>30s, early, cross-filter)
- `e2e/hel1392-remount-staleness.spec.ts` — Playwright: in-app Output edit and pipeline re-run are visible after a remount, both themes
- `e2e/support/remountBurstSeed.ts` — seeds the 8-panel burst dashboard; exact-id deletion with 429 retry

- `frontend/src/features/panels/ui/grid/MobilePanelStack.sortFailure.test.tsx` — card-level Verification 3(g): a failed user sort is toast-only, table and Filters stay mounted (cycle 2)

## Cycle 2 (evaluation-1.md)

- design.md D2/D3/D4 and tasks.md 2.2/2.3 rewritten to describe what was built (no thunk-arg `origin`, `generation` from the fulfilled payload, no `primeOutputMeta`, cache in `state/outputMetaCache.ts`).
- `waitForOwnedRequest` now releases its store subscription on unmount (StrictMode cleanup/re-run resumes it). Mutation M23.
- Fan-out run ids are cleared by `resetOutputFreshness` (logout) via `onFreshnessReset`. Mutation M24.
- Live-SSE `invalidatePipeline` now has a test; mutation M22. Card-level 3(g) test; mutation M25. All in `evidence/mutations.txt` (25 mutations, all red).
- Over-budget files (`usePanelData.ts`, `panelsSlice.ts`, `pipelineService.ts`) NOT split: PR-description follow-up.

- Cycle-2 dev-DB: the earlier cycle-2 e2e runs created 5 users (713711af-f8a2-44e1-8faf-840d6a7cebc4, 52344fc9-920f-46fa-a7f4-e45bbc5d491e, efbfa808-1e6e-4eac-9bb2-800c0e2c5ea9, e5a6a4a2-3c27-47db-afa9-e55f5415bf43, 5a3804ac-e9ee-40ed-b866-cea6d9ea50c1) and the staleness reruns created 27 more (1db7c2a2-34d1-48c7-b0f1-f2b7e7cadbd1, c6dba413-ce7a-430d-878d-99739bc24a1a, 4142c9c2-16c1-49b1-8714-f069b25a52f2, a00d595d-abbf-4d43-873d-97483b6f9cad, b15950d0-ceee-46b7-a8f2-1274c964ae0f, e7ec9fce-00ea-4f55-ba69-41a011e0c4c1, e41da937-89ca-4ef5-8fb8-bf332599b68b, ed4d3167-4b39-42f9-afe7-1b81dbd11f20, 07ba7202-ef44-4d0d-892e-2de4d8b7eb85, 42b2f9cc-c79d-474a-8d3d-913611b451ea, 40758049-eee9-4a07-bfef-55a0f9f2edf8, 02e98252-45b3-455a-8733-a8c61cdfd1de, 090d163f-8cae-4920-aa98-606afe4fa774, ef424b8c-ca8a-4604-a96f-6c7cfe982bdb, 0efd4a61-f8e6-4b6b-af1e-04423c6bea92, 79f4a2fe-249d-4a8a-86f1-2aa78ed9c2b6, 11b554e0-ca44-4fc3-8a8e-89a93fe7d81e, bbfbbff6-1e42-4256-b8d3-fec3f7a7f8d6, b8c5b587-070b-403d-a05b-8f53957f9f71, 02b6d8d6-b076-4cef-bfbc-294016d17ac0, aa601bd3-df50-4693-8614-7aedaa4f5266, d9e9d3a7-0bbe-4f83-a654-661cab5ae419, 66981f56-0233-4b6e-ae3a-ec7b9241272c, d6547ec4-2084-4920-923e-9429f4008327, bc76a3ab-0666-454b-8061-f92c5d313647, 8c599ec9-7eea-402b-b76f-54dd95eff9c7, ff860c86-11ba-47aa-9195-59b330047571); all removed by exact id (rate-window rows first). Dashboards/pipelines/sources: 0 left.
- The staleness spec's final "reuse resumes" step now retries up to 4 round trips: the out-of-band source write queues a server auto-run whose succeeded event legitimately invalidates once (seen as an intermittent extra fetch before this change).

- PR notes: the "~5 down / ~13 up" production request figures are DERIVED from the dev (StrictMode) counts by halving the doubled effect-driven calls, not measured on a production build.
- Cycle 3: `fetchPanelPage` start-time generation stamp is now tested (`panelThunks.generationStamp.test.ts`, mutation M26 reading the generation at response time turns it red); `subscribeWait`'s early-settled branch clears `inFlightRef`; the staleness spec's evidence JSON records every retry attempt's counts.
- Cycle-3 dev-DB: final staleness run users deleted by exact id: f93ea144-9df5-4eae-b386-b3b8479ca988, 29cf8e67-53ef-4818-adeb-a2a4f9b30046 (dashboards/pipelines/sources deleted via API, 0 left).

## Notes (for the evaluator)

### Red first (recorded)

- Jest, unmodified source (tracked changes stashed): `evidence/jest-red-first-baseline.txt` and `evidence/jest-red-first-unmodified-final.txt` — `PanelGrid.remountReuse` fails (rows calls received, expected `[]`), exit 1. Green after the change.
- Playwright baseline on the unmodified tree (`HEL1392_MODE=baseline`, StrictMode dev build), then after:

| case                                                 | before total (rows / outputs:id) | after total (rows / outputs:id) |
| ---------------------------------------------------- | -------------------------------- | ------------------------------- |
| cold load, 8 panels                                  | 87 (20 / 48)                     | 39 (12 / 8)                     |
| crossing down (desktop->phone)                       | 50 / 44 (12 or 8 / 32)           | 7 (0 / 0)                       |
| crossing up (phone->desktop)                         | 78 / 68 (12 or 8 / 48)           | 15 (0 / 0)                      |
| 3-crossing burst (read > 30s first)                  | 172                              | 29                              |
| panels showing "Rate limit exceeded" after the burst | 8                                | 0                               |

Remainder per crossing (dev, StrictMode): `distinct-values` 4 (the two control tables' dropdown option fetch), `runs/latest` 2, `run-events` 1, and on the way up `assertion-status` 8. **StrictMode:** dev doubles effects, so the dev numbers for effect-driven calls (`distinct-values`, and before the fix rows/outputs:id) are about twice production; the zero assertions hold in both. **Production expectation:** about 5 down / 13 up (distinct-values 2 instead of 4), so 3 crossings/min is ~30 requests against a 120/60s limit. Raw JSON: `evidence/burst-baseline-*.json`, `evidence/burst-after-*.json`.

- The cross-filter case (pie click -> "Filter dashboard by") ran at the same counts: 0 rows, 0 metadata; the capability cache (5 min) was warm, so the disclosed "known remaining fetcher (ii)" did not occur in the measurement.

### Mutations (every guard)

`evidence/mutations.txt` holds the 21 unit-level mutations (each turns a named test red, exit=1): N1 early return, ownership skip, retention / baseline / generation / `lastFetchOk` preconditions, pending skip, fan-out seeding, updateOutput / runPipeline / applyPatchSet / logout invalidation, metadata merge and failure caching, card retention, `inFlightRef` settle, waited-error surfacing (and its over-surfacing twin), ownership token, correction skip. `evidence/live-staleness-mutations.txt`: removing `updateOutput`'s invalidation turns the live staleness spec red (chart stays bar). Removing `runPipeline`'s invalidation, or even also the fan-out reconcile's, leaves the live spec GREEN: a remounting card's reconcile notifies and `refresh()`es it, so a stale window is corrected by the notify path; the invalidation guards the NEXT mount and is covered by `writeInvalidation.test.ts` / `pipelineRunFanout.remount.test.ts` (M18, M21). Stated rather than hidden.

### Divergences from design.md (deliberate, each simpler and equally binding)

- The thunk-arg `origin` field was dropped. `lastError` is recorded for every non-self-healing page-0 rejection together with its request id, and a waiting card surfaces it only for the request it waited on (N3), which also satisfies "a failed user-driven sort refetch is toast-only" (jest: waited-on request vs later failure).
- `generation` is returned in the thunk's fulfilled payload (read at request start inside the payload creator) rather than passed in the arg, so no caller can forget it. It is optional in the type so existing reducer tests stay valid.
- `outputMetaCache` is a separate module (not inline in `useOutputMeta`) and no `primeOutputMeta`: an Output write just invalidates, the next mount refetches (spec scenario "Output edit then remount").
- A cache entry fetched while any invalidation lands is returned to its callers but never served to a later mount.

### Cold-load double fetch (task 1.3, D6)

Baseline cold load: 20 rows requests for 8 panels. Root cause confirmed by the after-run (12): the dev-only StrictMode double effect run re-dispatched because the render closure's `paginationEntry` was still null; the live-store pending check removes it (8 stripped + 4 persisted-sort/URL-control corrections = 12). In production (no double effects) it was already 12 before this change, so the "16 for 8 panels" figure was a dev artefact. Not a separate bug. Remaining by design: a card with a persisted sort/filter default, URL control op or cross-filter term sends the stripped request and then the corrected one on a cold load (metadata unknown yet); with metadata held (every remount) exactly one dispatcher owns the mount.

### D4 enumeration (`grep -rnE "httpClient\.(post|put|patch|delete)" frontend/src`, tests excluded) — every file classified

- `outputService.ts` createOutput -> `invalidatePipeline`; updateOutput/deleteOutput -> `invalidateOutput`; previewOutputs, validateExpression (POST, read-only) -> no.
- `pipelineService.ts` updatePipeline, deletePipeline, createPipelineStep, addPipelineRoot, removePipelineRoot, reorderPipelineSteps, runPipeline (also dry: conservative) -> `invalidatePipeline`; updatePipelineStep, updatePipelineStepEnabled, duplicatePipelineStep, deletePipelineStep (step id only) -> `invalidateAll`; createPipeline (new ids, nothing cached), permission grant/revoke (access only), schedule PUT/DELETE (no data change), expandPipelineShape (pure expansion, no write) -> no.
- `patchSetService.ts` apply/undo -> `invalidateAll`; preview -> no. `combinedProposalService.ts`, `pipelineProposalService.ts` apply -> `invalidateAll`. `firstRunService.ts` (dashboard, template) -> `invalidateAll`. `authService.ts` logout -> `resetOutputFreshness` (login/register/MFA/preferences -> no).
- Not invalidating, with reason: `dataSourceService.ts` (source create/delete/refresh/row writes/schema patch) and `panelService.ts` form submit/`/rows`: they change Output rows only through a pipeline run (auto-run, covered by the SSE/reconcile path); `panelService.ts` panel create/title/appearance/binding/batch/duplicate/delete/upload/config: panel placement only (a rebinding changes the fetch key on a mounted card, a new mount reuses nothing for an unseen Output); `dashboardService.ts` (dashboard CRUD/layout/duplicate/import): panels and layout, not Output data; `proposalService.ts` (dashboard proposal apply: panels referencing existing Outputs), `authoringService.ts`, `refinementService.ts` (preview), `assistantConversationsService.ts`, `connector*Service.ts`, `shareTokenService.ts`, `settings*Service.ts`, `apiTokenService.ts`: no Output data.

### Live checks

- Live staleness (C4): `e2e/hel1392-remount-staleness.spec.ts`, dark and light, running app on :6824/:9731: cross (0 rows / 0 metadata), in-app Output edit (bar -> line) with no run, history navigation back (metadata refetched, chart renders `line`), source write the page never saw + in-app "Run pipeline" + back (table shows the new row), cross both ways (fresh data at both widths, reuse resumes: 0/0). One conservative extra fetch after a run this page made is expected: the card remount reconciles that run as a real observation (the in-flight mount request was started before the generation bump, so that window is not reusable once).
- Visual check: `evidence/phone-reused-{dark,light}.png`, `evidence/desktop-fresh-{dark,light}.png`, `evidence/phone-fresh-{dark,light}.png` viewed in both themes at desktop (1400) and phone-stack (1000 viewport) width; no CSS changed, cards render identically to a fresh load (reused window, same table/chart).

### Dev DB

Created/deleted by exact id through the API (every call 204): per-run dashboard/pipeline/source ids are logged in `evidence/burst-*.json` (`created`) and the run output. User rows are not deletable via the API; removed by exact id from SQL (their `pipeline_run_rate_window` rows first): 6c2dc82e-39c0-4eab-b6df-8ba4c7365a4b, 99b7d57b-e8a3-4bd6-b313-12ab8a7708e3, 276abfd8-361d-411c-b781-5e8a53b5ae5c, 09920cf3-2ce0-492a-bc70-b2bd87161d5f, 2d21a6e5-9c3f-4ef8-92f7-1bd9707af6a6, eb2b78d9-b049-4154-898d-25e74f0307bf, de7eb57e-189a-4618-b244-247aeaccb5ea, 40aabc08-3e06-4429-baf4-cd229d4fec02, a89fc1d9-2612-43cd-852f-94b91af26b1c, 09f8a598-44a4-41fd-bfe0-db1ddd4ef9be, 5de3fa48-a86f-4c58-b007-f0c989de97d6, d8e0428d-6cf1-453f-9a44-c7947851940f, 80f4b618-310a-45df-b45a-b08c24f32fb8, cd48ebff-12cc-45c1-9885-884c09524661, f4889c48-7287-41a9-9e79-d64e00ff8504, 20d264b2-e034-4c9c-9b51-dbed90b2b02d, e3365561-1d30-4263-87d9-d0924239e9ac, 77d53991-d9ed-4545-8d39-7b9da50b0527, c182dcff-dcd6-4d14-b9d4-1658ba4dcb2d, 0cc6bfea-e355-4fae-8c0c-7010939fd396, b7e2df88-ecaf-4379-8833-c3c3adb13629, bce06057-36aa-4980-862e-71ffbbaa61b0. Left untouched: the orchestrator's premise-probe user a4d418f0-ec0f-49d7-a982-32f5051a580a. Post-check: 0 `HEL-1392%` dashboards/pipelines/data_sources/outputs.

### Spinoff candidates / follow-ups (not fixed here)

- `GET /api/outputs/:id/distinct-values` is requested again by each control-bar dropdown on every remount (2 per crossing in production, 4 in dev) — a small per-Output cache like `outputMetaCache` would remove it.
- `assertion-status` (8 per phone->desktop crossing) and the SSE close/reopen (`runs/latest` + `run-events`) remain, per D7; together ~13 requests per upward crossing in production, ~5 per downward.
- Cold load still sends a stripped request and then the corrected one for cards with a persisted default / control / cross-filter term whose metadata is not yet known.
- `usePanelData.ts` is 395 lines, `pipelineService.ts` 430, `panelsSlice.ts` 459: propose a split in the PR description (pre-existing sizes, this change added to them).
- HEL-1418 and the rate limiter are untouched (C2, C5).
