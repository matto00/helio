## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed against the live tree at HEAD febb2013bd8b41704084192749535c3c4249576f. The change directory is untracked
(planning artifacts only). Everything in the artifacts was treated as a claim and checked against the source.

### What I verified (with evidence)

**Backend (D1), orchestrator questions 1 and 2**

- `DashboardChangesRepository.changes` runs `contentQuery.zip(dataQuery)` inside one `ctx.withUserContext`, and the data
  query inner-joins `outputs` (`backend/.../persistence/dashboards/DashboardChangesRepository.scala`). Under RLS a
  dashboard-only grantee therefore gets no data rows. The proposal's "Why" is correct.
- Disclosure (question 1). `PublicPanelListResolver.panelList` calls `findAllByDashboardId(..., accessAlreadyGranted = true)`
  and emits `PanelResponse.fromDomain(panel, ..., orphanedControlIds = Some(..))`. For an `OutputPanel` this goes through
  `OutputPanelConfig.responseJson`, which always writes `"outputId" -> c.outputId.value` (`OutputPanel.scala:152-153`).
  `includeOwnerId` only redacts `ownerId` and `meta.createdBy`. `OutputPanel.outputId` is rebuilt from `panels.output_id`
  (`PanelRowMapper.outputConfig`). So every grantee who can list the panels already receives the same ids
  `panels.output_id` holds. The claim holds.
  - Capture times: `DashboardPanelStatusService.status` returns `dataUpdatedAt = historyRepo.latestCapturedAtInternal(..)`
    for each bound Output to any caller the route admits, using internal (system) reads. That is the same newest
    `captured_at` value D1 would report. The claim holds.
  - Residual gap (non-blocking, see notes). Only `PanelRowMapper.domainToRow` keeps `output_id` NULL for non-output
    kinds. The DB has only `panels_output_kind_requires_output_id` (kind=output implies non-null), not the reverse. The
    "subset of the panel list" invariant therefore depends on application code, not on the schema.
- Public grants (question 2). `dashboards_select` is `helio_can_access_dashboard(id)` (V36, owner changed in V40). Its
  public branch (`grantee_id IS NULL`) applies only when `app.current_user_id` is empty. For an authenticated user it
  admits only the owner or a named grantee. `withUserContext` always sets the user id, so an authenticated stranger
  cannot get a public-grant dashboard through step 1 of `GET /api/dashboard-changes`. This makes the route narrower than
  `panel-status`, which admits a share token or public grant. Scoping step 2 to step 1's ids, with items built from the
  content map, is sound. A system-context read bounded that way discloses nothing beyond the panel list and
  `panel-status`.
- `DbContext.withSystemContext` exists and requires an inline justification comment at every call site. The class doc
  of `DashboardChangesRepository` currently says "Both run in the caller's user context" and will need updating
  (non-blocking note).

**Frontend (D2-D4), orchestrator questions 3 and 4**

- Rows routing is fail-closed and does not depend on D3. `fetchPanelPage` picks the per-panel route from
  `panelReadScopeFor(state, dashboardId, panelId)` (`panelThunks.ts` ~399). Metadata routing does depend on D3:
  `fetchOutputMeta` picks `GET /api/outputs/:id` versus the per-panel `output-meta` route from the global, Output-keyed
  `panelScopes` map (`outputMetaCache.ts`). Today `restoreFromMemory` calls `unscopeOutput` for every bound Output
  (`showDashboardPanels.ts:65`). D3's "apply `applyPanelReadScopes` BEFORE `panelsRestored`" is therefore what stops a
  restored shared card from requesting `/api/outputs/:id`. Ordering it before `panelsRestored` is correct and sufficient
  for the memory path.
- Owner reload regression check. D3 drops a copy for "a dashboard the store does not hold". `hydrateTabs` fires only
  once `state.dashboards.status === "succeeded"` (`dashboardTabsListeners.ts:42-52`), and `App.tsx:173-179` waits for
  `tabsHydrated`. So `dashboards.items` is loaded before `showDashboardPanels` runs, and owner warm reload is not
  regressed. No issue.
- Freshness comparisons use server time throughout. `capturedAt` is `serverNowMs()` at request start
  (`panelThunks.ts:470`). `isWindowFresh` compares it to `signal.outputs[].dataUpdatedAt`. `changeRule.hasChangedSince`
  has no role check. The claim that "the dot needs only the server fix" holds.
- `captureTab` returns early on `isKnownNonOwnedDashboard` (`warmCapture.ts:107`), which also skips `retainTab`.
  Removing that skip restores the tab-level retention that `panelRowsReuse` requires (`isRetained` plus a generation
  match). `retain()` is a passive refcount (`outputFreshness.ts:69`) and starts no request. Correct.
- **Stored-entry allow-list (finding, CR1).** `BoundedWarmStore.write` calls `sanitizeEntry(entry)`
  (`boundedWarmStore.ts:42`). `sanitizeEntry` rebuilds the entry from a fixed key list, and `WARM_ENTRY_KEYS` is asserted
  by `boundedWarmStore.test.ts:64`. A new `readScope` field is stripped on every write unless both are changed. The
  design says nothing about either. The result: every stored shared copy reads back without `readScope`, falls back to
  `"output"` (D2), and D3 drops it. Reload-warm for shared dashboards silently never works, even though the modified
  "survives a reload" requirement covers non-owned dashboards. Neither the planned jest nor the planned e2e would catch
  this: the e2e has no reload step, and a jest that puts entries directly into `MemoryWarmStore` bypasses the sanitizer.
- **Memory-entry scope (finding, CR2).** D3 says a copy is restored "(memory or stored) only when ... the entry's
  `readScope` equals" the current scope. The in-memory list entry is `{panels, contentCapturedAt}`
  (`setListEntry` in `warmCapture.ts` and `warmRestore.ts`) and has no `readScope`. D2 only adds it to `buildWarmEntry`.
  A competent implementer could read this two ways: add `readScope` to the list entry, or check memory copies against
  nothing. The order of the check is also unstated. `applyWarmEntry` seeds `outputMeta`, `runBaseline`, row windows and
  retention before `restoreFromMemory` runs, so a scope-mismatched stored owner copy would seed owner metadata and run
  baselines before being dropped.
- **D4 timing (finding, CR3).** `DashboardMetaRow` subscribes to panel status through `useSharedDashboardMeta(isOwner ?
  null : selectedDashboardId, panels)` (`DashboardMetaRow.tsx:96`). It needs only `selectedDashboardId`, not panels, and
  it is a child of `App`, so its subscribe effect runs in the same commit before `App`'s `showDashboardPanels` effect
  (`App.tsx:173-179`). In the normal flow, therefore, the dashboard's first `panel-status` read is already in flight
  before the restore calls `seedPanelStatusBaseline`. D4 says "the next read for that dashboard" applies seeds. Taken
  literally as "the next read issued", the in-flight read becomes a plain baseline (`advancedPanels(null, ..)` returns
  `[]`) and the race D4 exists to close is still open.
  - A second ordering is also unhandled. Advances are delivered only to `advanceListeners` present when the response
    lands (`panelStatusStore.read`). A card's `usePanelStatusRefresh` subscribes in `PanelCardBody` after
    `panelsRestored` commits. If the seeded first response lands before a card has subscribed, the seed is consumed, the
    advance reaches nobody, and the restored stale window keeps being reused: `panelRowsReuse` still passes because
    nothing bumped the generation. That is stale rows served until the next real advance.
  - The test plan (D5) has no case for either ordering, and the e2e does not exercise D4 at all.

**Plan coverage**

- AC1 (data times without over-disclosure): D1 plus the `helio_app` spec and transcript. Covered.
- AC2 (dots and warm cache, e2e as grantee): e2e (a), (b) and (c). These cover tab-switch warmth and the dot; reload
  warmth is jest-only (see CR1).
- AC3 (RLS): `TwoUserRlsApiFixture` runs over a non-BYPASSRLS `helio_app_test` pool (its class doc), plus a `helio_app`
  transcript. Covered.
- Owner-ruling scope (warm restore moved from HEL-1780): D2-D4. Covered.
- No schema change: the response shape is unchanged. The spec delta updates the requirement text. No contract delta is
  missing.
- Referenced files exist: `DashboardChangesRoutesSpec.scala`, `DashboardPanelStatusRoutesSpec.scala`,
  `TwoUserRlsApiFixture.scala`, `warmNonOwner.test.ts`, and the `hel1575-*`, `hel1773-*`, `hel1780-*` and `hel1786-*`
  e2e specs.
- The "existing <20 ms deep-history scenario" is a spec scenario. I found no automated timing test in
  `DashboardChangesRoutesSpec`. "Re-measured" therefore means a manual measurement, which is acceptable if the
  transcript is saved.

### Verdict: REFUTE

The backend design (D1) is sound, and its disclosure argument checks out against the code. The frontend design has
three concrete gaps. One makes a spec'd behaviour (reload-warm for shared dashboards) silently dead. Two leave the D3
and D4 contracts ambiguous in ways that decide whether owner data is seeded and whether stale rows are served. All
three are cheap to fix in the artifacts.

### Change Requests

1. **D2/D5: persist `readScope` through the sanitizer.** Add `readScope` to `WarmEntry`, to `WARM_ENTRY_KEYS` and to
   `sanitizeEntry` (`frontend/src/features/dashboards/tabs/warm/warmStore.ts:26-87`). List the
   `boundedWarmStore.test.ts:64` key-set assertion as an intended change in files-modified. Require the "stored restore
   of a viewer dashboard" jest case to write its entry through `BoundedWarmStore.write`, not `MemoryWarmStore.put`, so
   the sanitizer is exercised. Add a mutation (m7: drop `readScope` from `sanitizeEntry`) that turns that case red.
   Either add a reload step to `e2e/hel1783-shared-dashboard-tabs.spec.ts` (V reloads on DA within the TTL; no DA
   panel-list or rows request; no `/api/outputs|/api/pipelines`), or state explicitly why the reload requirement is
   proven by jest alone.
2. **D3: say where the memory copy's scope lives and when the check runs.** Either add `readScope` to the in-memory
   list entry (set by `captureTab` and by `applyWarmEntry` from the stored entry) and check it in `restoreFromMemory`,
   or state that memory copies are not scope-checked and why that is safe. Also state that the stored-copy scope check
   runs BEFORE `applyWarmEntry` seeds anything, and on a `"panel"` entry `applyWarmEntry` must not call `seedOutputMeta`
   or `seedObservedRun` even if the fields are non-empty. Add a jest case: an owner-scoped stored copy read while the
   caller is a viewer seeds no Output metadata and no run baseline.
3. **D4: define seed semantics against the real mount order.** Specify all three of the following:
   - (a) A seed applies to the first snapshot that **resolves** after seeding, whether or not that read was issued
     before the seed. In the normal flow `DashboardMetaRow` issues that read before the restore
     (`DashboardMetaRow.tsx:96`, a child effect of `App.tsx:173-179`).
   - (b) What happens when a seeded panel's advance is detected but no advance listener for it is registered yet: keep
     it pending until that panel subscribes, or bump the panel's freshness so `panelRowsReuse` refuses the stale
     window. Do not drop it silently.
   - (c) Whether seeds are written for windows that `isWindowFresh` already invalidated. That would cause a duplicate
     rows read; recommend seeding only the windows kept.

   Add jest cases for (a), the first read in flight before the seed, and (b), the response landing before the card's
   listener subscribes. Extend mutation m5 accordingly.

### Non-blocking notes

- D1: add `AND p.kind = 'output'` to the data query's panel subselect. The "every reported id is in the panel list"
  invariant then holds by query, not only by the convention in `PanelRowMapper` (no CHECK forbids `output_id` on other
  kinds).
- D1: the `withSystemContext` call needs the inline bypass justification `DbContext` mandates. Update the
  `DashboardChangesRepository` class doc ("Both run in the caller's user context").
- D5: consider a backend case where B is an authenticated stranger and D carries a public (`grantee_id IS NULL`)
  viewer grant: D is omitted. This pins the public-grant answer above against future policy changes.
- e2e (b) needs a deterministic way to trigger the change-signal refresh. The 2-minute cadence should not be waited
  out. Name the trigger in the spec.
