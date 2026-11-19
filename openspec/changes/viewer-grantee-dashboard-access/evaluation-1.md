## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed head: `3f8202cf243d8db8a194b2ce6523a838c8ddae4d`. The base was resolved live with `resolve-review-base.sh` and is `5f137cb5ffbf358b4ac47f044ad6fe26fce74d37`.

### Fresh gate evidence (my own runs on the final head)

| Gate | Result | Transcript (`.concertino/scratch/HEL-1773/`) |
|---|---|---|
| `npm run lint` | exit 0 | `eval-lint.txt` |
| `npm run format:check` | exit 0 | `eval-format.txt` |
| `npm run typecheck` | exit 0 | `eval-typecheck.txt` |
| `npm --prefix frontend run build` | exit 0 | `eval-build.txt` |
| `npm test` (3 workers) | 66 + 846 suites, 579 + 10077 tests passed | `eval-jest.txt` |
| `sbt -J-Xmx3g testFull` | 9911 succeeded, 0 failed, 728 suites | `eval-sbt-testfull.txt` |
| e2e `hel1773-viewer-grantee-dashboard.spec.ts` (full file, lane DB) | 7 passed | `eval-e2e-hel1773.txt` (persisted) |
| C15 related e2e (12 spec files, lane DB) | 153 passed | `eval-e2e-related.txt` |

- **Deviation 5 (phone-sheet commit landed after the final run):** I ran the full HEL-1773 e2e file on `3f8202cf2` itself. It passed 7/7.
- **C15 coverage gap, now closed:** the executor's related-spec run (`related-e2e.txt`, 17:21) came before `3f8202cf2` (17:44). It also left out several specs that read `.dashboard-chip`, whose CSS this change alters (`display: inline-flex`). On the final head I ran these specs, all green:
  - hel773-top-anchored-mobile-nav-sheet
  - hel813-mobile-touch-target-floor and its .regression spec
  - hel1583-mobile-dashboard
  - hel1583-refresh-line-no-shift
  - hel1646-skeleton-refresh-slot
  - hel1656-pull-to-refresh
  - hel1681-refresh-control
  - hel1583-glass-nav
  - hel1003-actions-menu-keyboard-reach
  - hel1575-reload-after-edit
  - hel1260-orphan-owner-repair
- **RLS claim (rls-helio-app.txt):** I read the spec that produced it, `DashboardSharedListRoutesSpec`.
  - It runs over `TwoUserRlsApiFixture`, whose app pool is a real `NOSUPERUSER NOBYPASSRLS` role, `helio_app_test` (fixture lines 126-144).
  - The `(1)` list, `(2)` pipelineFed and `(3)` outputs-count statements run through `ctx.withUserContext` on that pool.
  - `(4a)` goes through the real route tree.
  - My own `testFull` run printed the same five `[HEL-1773 RLS]` lines, with a fresh dashboard id.
  - The stranger list case is covered by the first test in the same RLS fixture ("A private" and "A to C viewer" are not listed for B).
  - The claim holds. One caveat: this is the test role `helio_app_test`, not the prod `helio_app` login. The executor's transcript says so.

### Phase 1: Spec Review — PASS (one owner-behaviour regression is raised in Phase 2)

- **AC 1 (list `include=shared`, `accessRole`, paging, schema, RLS):** met.
  - `findAllVisiblePaged` is one left join that only matches named grants. A public grant has a null grantee and cannot match.
  - The `unique_grantee_per_resource` constraint (V16) means the join cannot duplicate a dashboard.
  - Count and slice are taken over the same query.
  - The schema gains an `accessRole` enum and the seam test validates the wire JSON against it. The `400` and default-unchanged cases are tested.
- **AC 2 (grantee opens, stranger gets not-found, owner unchanged):** met by the e2e on the final head. The owner-unchanged part has one regression, see CR1.
- **AC 3 (Shared marker):** met in the sidebar, the Home shelf, the phone chip row and the phone sheet. I checked the running app in dark and light themes at 1440, and in light at 768 and 390 (screenshots persisted). The marker reuses the existing pinned-badge recipe and tokens.
- **AC 4 (viewer read-only, per-panel reads only, no `/api/outputs/*`):** met. The e2e invariant passed for the viewer on desktop, the viewer on a phone, and the editor.
- **AC 5 (editor edits, owner-only actions not offered):** met. Rename and Customize persist, and the sidebar menu is exactly Rename and Export. Server facts I checked:
  - `exportSnapshot` admits editors and refuses viewers.
  - Panel binding is owner-of-Output only (`PanelBindingChecks.rejectMissingOutput`).
- **Tasks:** all are marked done and match the diff.
- **Design deviations I was asked to judge:**
  - **Deviation 1 (fail-closed exception for an item with neither `accessRole` nor `ownerId`):** acceptable.
    - Every server path builds the dashboard from `DashboardResponse.fromDomain`, which always sets `ownerId` (DashboardProtocol.scala:134-143).
    - So the exception can only fire for hand-built client objects, never for wire data.
    - Non-blocking suggestion below.
  - **Deviation 2 (auto-open and the PanelList zero-dashboards empty state still keyed on an empty list):** acceptable as a deliberate, documented deviation.
    - Onboarding *progress* counts owned dashboards only, which is what spec.md requires.
    - Live check with a user whose only dashboard is shared: landing is the existing "No dashboard open — Choose a dashboard from the list" empty state. It is not blank and has no console errors (`eval-onlyshared-landing.png`).
    - Trade-off: an invited user with no dashboard of their own never sees the first-run drop zone. That is product polish for a later child, not a child-1 failure.
  - **Deviation 3 (m7 alone stays green):** acceptable.
    - The `outputMetaCache` seam already turns `useDashboardMeta`'s reads into per-panel reads, with `pipelineId: ""`, so no `/api/pipelines/` request is made.
    - The direct gate in `DashboardMetaRow`/`DashboardRefreshLine` is defense in depth, and only m8b+m7 together can show it.
    - This is honestly reported. It is not a missing gate.
  - **Deviation 6 (`dashboard-changes` for shared ids untested):** out of child-1 scope (D7 assigns it to child 6). The e2e saw that request return 200 inside the invariant window. Non-blocking.
- **Constraints C1-C16:** honoured in the diff, including C16: the invariant passes for the viewer, the phone viewer and the editor. My own work kept to C1-C5, C12-C15.

### Phase 2: Code Review — FAIL

Canonical code-quality and design [mechanical] checks:
- Lint is clean (zero warnings) and formatting is clean.
- New CSS uses `--space-*`, `--text-*`, `--font-mono`, `--app-*` and `--weight-*` tokens throughout.
- New badges have accessible names: `"<name> (Shared)"`, with the visible badge `aria-hidden`.
- Types are strict, there is no `any`, and I found no dead code.

Issue:

1. **Correctness bug, owner regression (deviation 4 confirmed live):** `frontend/src/features/panels/state/outputMetaCache.ts`.
   - **The cause:** the panel scope (`panelScopes`, lines 36-50) is keyed only by `outputId`, while the metadata cache (`cache`, line 25) is keyed by `outputId`, and changing the scope never evicts the cache.
     - `fetchOutputMeta` (lines 99-136) hands back a cached entry whatever route fetched it.
     - The stub `outputFromPublicMeta` builds (`ownerId: ""`, `pipelineId: ""`) is then served on the owner's **own** dashboard.
     - Warm capture (`warmCapture.ts` → `peekOutputMeta`) then persists that stub, and warm restore (`warmRestore.ts:54` → `seedOutputMeta`) puts it back after a reload.
     - The warm-restore path (`showDashboardPanels.ts` → `restoreFromMemory`/`applyWarmEntry`) never calls `fetchPanels`, so it never calls `unscopeOutput` either.
   - **A reachable scenario:** X owns Output O, which is on X's dashboard DA. Y grants X `editor` on Y's dashboard DY. X adds a panel bound to O on DY; the server allows this because X owns O.
   - **Live reproduction** (lane DB, final head; evidence `eval-outputmeta-probe.txt`, persisted):
     1. I loaded DY. It correctly read `.../panels/:p/output-meta`.
     2. I clicked DA in the sidebar. Requests: `/api/dashboards/DA/panels`, `/api/outputs/O/rows`, `/assertion-status`. There was **no `GET /api/outputs/O`**.
     3. I fully reloaded DA (warm restore). `peekOutputMeta(O)` returned `{ownerId: "", pipelineId: "", name: ""}` with `getOutputPanelScope(O) === null`.
   - **Effects on the owner's own dashboard:**
     - `TableRenderer.canWrite` is false (TableRenderer.tsx:51), so column changes are no longer saved.
     - `useDashboardMeta` loses the refresh and source facts: the meta row reads only "1 panel".
     - The run-event refresh cannot find a pipeline.
     - All of this survives reloads until the warm entry expires.
   - This breaks "owners are unchanged" (AC 2). See CR1.

### Phase 3: UI Review — PASS (objective checks)

- **Happy path:** the viewer opens with rows. The editor renames and retitles, and both persist. The owner keeps their controls. A stranger gets not-found.
- **Unhappy and empty paths:** the shared-only user sees the existing empty state. A form shows "Only the owner can submit this form". An insight panel shows "Not available on shared dashboards yet".
- **Console errors:** none in the e2e invariant windows, and none in my manual pass on the shared dashboard (0 errors, 0 warnings).
- **Accessible names:** the sidebar row and phone chip read `"<name> (Shared)"`. The Home card has an sr-only separator before "Shared". Kebab menus are hidden when they would be empty, not left as empty triggers.
- **Breakpoints:**
  - 1440 dark and light, 768 light and 390 light: no layout breakage. The chip label truncates before the "SHARED" marker.
  - I did not resize to 1100 by hand. The C15 runs (hel813, hel1583-glass-nav) cover the shell at several widths.

### Overall: FAIL

### Change Requests

1. **Stop panel-scoped Output metadata from leaking into owned dashboards.**
   - **Files:** `frontend/src/features/panels/state/outputMetaCache.ts:39-50, 99-136`, `frontend/src/features/panels/state/panelThunks.ts:79-88`, `frontend/src/features/dashboards/tabs/warm/showDashboardPanels.ts` and `warm/warmCapture.ts`.
   - **Minimal fix:**
     - (a) `scopeOutputToPanel` and `unscopeOutput` must evict the `cache` entry for `outputId` whenever the scope actually changes, so the next `fetchOutputMeta` refetches through the right route. Alternatively, mark entries with the route they came from and refuse to serve a scoped entry when there is no scope, and the reverse.
     - (b) The owned-dashboard warm-restore path must reach the same `unscopeOutput` decision as `fetchPanels`. For example, unscope every Output of the restored panels before `panelsRestored`. Without this, a restore after a shared view keeps reading through the other dashboard's per-panel route.
     - (c) `warmCapture` must not capture a scoped stub as an owned dashboard's Output meta. Skip any meta whose `ownerId === ""` and `pipelineId === ""`, or capture only entries fetched through `getOutputById`.
   - **Add a jest case for each:**
     - fetch a scoped meta, then `fetchPanels` an owned dashboard binding the same Output: expect `getOutputById` to be called and `ownerId` to be the real owner;
     - the warm-restore variant;
     - a capture that skips the stub.
   - The executor may choose the shape: a per-panel scope key, keying the cache by route, or something else. The requirement is that an owned dashboard never renders a stub fetched for a non-owned one.

### Non-blocking Suggestions

- `dashboardAccess.ts:20-23`: the "no role and no owner reads as owner" exception exists only for hand-built fixtures. Consider making `Dashboard.ownerId` required in the type and fixing the fixtures through a factory in `renderWithStore`, so production code can never take the exception.
- `HomePage.css` `.home-card__shared` copies the `.dashboard-list__pinned-badge, .dashboard-list__shared-badge` recipe property for property. A shared badge class or utility would avoid a third copy.
- `DashboardChipRow.css` `.dashboard-chip__shared` uses `opacity: 0.7` for de-emphasis. It is acceptable on the inverted active chip, but `--app-text-muted` is the usual token for an inactive chip.
- A shared-only invited user gets no first-run experience (deviation 2). Worth a line in the children draft (child 4, read-only polish).
- An e2e for `dashboard-changes` with a shared id belongs in child 6, as planned.
