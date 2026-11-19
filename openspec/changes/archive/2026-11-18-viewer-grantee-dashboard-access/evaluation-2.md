## Evaluation Report — Cycle 2 (evaluation-2.md)

Reviewed head: `b097d0b9579f80cd4276ecc10ac608aa0bb78921`. The base was resolved live and is `5f137cb5f`. The cycle-2 delta is commit `b097d0b95`, which touches:
- `outputMetaCache.ts`
- `showDashboardPanels.ts`
- the new `outputMetaCache.scope.test.ts`
- `files-modified.md`

### Fresh gate evidence (my own runs on b097d0b95)

| Gate | Result | Transcript (`.concertino/scratch/HEL-1773/`) |
|---|---|---|
| lint, format:check, typecheck, frontend build | all exit 0 | `eval2-{lint,format,typecheck,build}.txt` |
| `npm test` (3 workers) | 66 + 847 suites; 579 + 10081 tests passed (the 4 new cases are included) | `eval2-jest.txt` |
| e2e: `hel1773-viewer-grantee-dashboard.spec.ts` (full file) plus the four `hel1575-*` warm-tab specs (the change touches `showDashboardPanels`), lane DB | 35 passed | `eval2-e2e.txt` |
| `sbt testFull` | not re-run: no backend file changed since cycle 1 (9911/0 on 3f8202cf2) | — |

### Phase 1: Spec Review — FAIL

AC 2 says "owners are unchanged". It is still violated in one remaining path; see Phase 2. Every other cycle-1 Phase 1 finding stands.

### Phase 2: Code Review — FAIL

**CR1 from cycle 1 (stub served, persisted and restored on the owner's own dashboard): fixed on every path cycle 1 reported.** I re-ran the live reproduction with fresh users; evidence is in `eval2-outputmeta-probe.txt` section A.
- A full load of the shared dashboard DY still makes only per-panel requests. C16 holds.
- Sidebar to the owned DA (warm tab): the facts are present and `peekOutputMeta(O)` is the real Output.
- A full reload of DA (warm restore from the browser store) also gives the real Output, with scope `null`.
- DY then a cold owned dashboard: `GET /api/outputs/O` is now made, so the cache refetches through the right route.

The design is sound: each cache entry carries a `scoped` marker that must match the current scope before it is served, `peekOutputMeta` skips stubs, and `restoreFromMemory` clears the scope. The four new jest cases are meaningful; the executor's transcript shows all four red on 3f8202cf2.

**New finding: a residual owner regression in the same family, reproduced twice** (`eval2-outputmeta-probe.txt` section B).

1. **Symptom:**
   - X has a full page of the shared dashboard DY open.
   - X switches in-app (sidebar) to an owned dashboard X has not yet opened, which binds the same Output O.
   - The meta row stays at "1 panel", with no "refreshed … / source …" facts, and no `GET /api/pipelines/:id` is ever made. This holds even though the cache holds the real Output within 750 ms (I sampled every 250 ms for 8 s).
   - A full load of that same dashboard shows the facts, and so do two controls with no shared dashboard involved:
     - owned D3 → cold owned D4, same O;
     - owned *empty* dashboard → cold owned D5, same O.
   - So the defect is introduced by this branch.
2. **Mechanism (code reading, consistent with the probe):**
   - `DashboardMetaRow.tsx:71-76` passes `state.panels.items` once `loadedDashboardId === selectedDashboardId`.
   - `loadedDashboardId` is set at `fetchPanels.pending`, while `items` still hold DY's panels (which bind O) and O is still scoped to DY. `isOwner` is already true for the new dashboard.
   - `useDashboardMeta` (`useDashboardMeta.ts:44-62`) calls `getOutputMetaCached(O)` and correctly gets the DY stub, because scope and entry agree. It stores the stub in its local `outputs` state.
   - When the new dashboard's panels arrive, `outputKey` is still `"O"`, so the effect never re-runs. The stub (`pipelineId: ""`) stays in hook state, there is no feeding pipeline, and no facts are shown.
   - `DashboardRefreshLine.tsx` reads the same hook with the same selector shape, so it is likely affected the same way. I inferred this from the code; I did not probe it.

### Phase 3: UI Review — PASS

- The e2e passes on the new head, and the shared-dashboard invariant holds in my live run (DY requests: only `/panels`, `/output-meta`, `/rows`).
- The cycle-1 UI checks are unchanged by this frontend-cache delta (theme and breakpoint screenshots are persisted from cycle 1).

### Overall: FAIL

### Change Requests

1. **Do not let `useDashboardMeta` keep Output metadata from a previous dashboard's scope.** Files: `frontend/src/features/panels/hooks/useDashboardMeta.ts:39-62` and/or `frontend/src/app/dashboardMeta/DashboardMetaRow.tsx:71-76` and `DashboardRefreshLine.tsx`.
   - Any one of these is acceptable:
     - (a) re-run the outputs effect on `dashboardId` as well as `outputKey`, resetting `outputs` when the dashboard changes, so the read happens after `fetchPanels` has set the scope;
     - (b) re-validate held entries against `getOutputMetaCached` (now route-aware) on every run, and drop an entry the cache no longer serves;
     - (c) pass panels to the hook only when they actually belong to the selected dashboard, using `panelsSettledFor` or `items[0].dashboardId === selectedDashboardId`, not `loadedDashboardId` alone.
   - Add a jest case:
     1. Render `DashboardMetaRow` with a shared dashboard selected whose panels bind O, with O scoped.
     2. Switch the selection to an owned dashboard, keeping the stale items with `loadedDashboardId` already switched.
     3. Unscope O and deliver the owned panels.
     4. Expect `getPipelineById(P)` to be called and the refresh/source facts to render. It must be red on b097d0b95.
   - Re-run my probe: full load DY → sidebar to a cold owned dashboard binding O → facts appear.

### Non-blocking Suggestions

- The cycle-1 suggestions stand: `ownerId` required in the type, de-duplicate the badge CSS, the first-run experience for a shared-only user, and child 6 `dashboard-changes`.
- In `fetchOutputMeta`, a superseded in-flight entry still assigns `entry.value` to the orphaned object. This is harmless today because the map no longer points at it. A `cache.get(outputId) === entry` guard before the assignment would make the intent explicit.
