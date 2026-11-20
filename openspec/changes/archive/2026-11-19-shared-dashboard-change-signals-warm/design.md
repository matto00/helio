## Context

See proposal.md (Why). On main febb2013b (executor re-verifies): `DashboardChangesRepository` runs both queries in one
`withUserContext`, so under `helio_app` a dashboard-only grantee gets `dataUpdatedAt: null`, `outputs: []` (HEL-1786 D1
read history with `withSystemContext` after the ACL for the same reason). `HomeSummaryService` reuses the service.
`changeRule.hasChangedSince` has no role check, so the dot needs only the server fix. HEL-1773 disabled the warm cache
for non-owned dashboards (`captureTab`, `showDashboardPanels`, `warmNonOwner.test.ts`); `restoreFromMemory` applies the
owner `unscopeOutput` rule where `fetchPanels` scopes a non-owned dashboard's Outputs (`panelThunks.ts` ~84). The
grantee panel list returns each Output panel's `config.outputId`. `panelStatusStore`'s first read is a pure baseline.
Non-goals beyond proposal.md: HEL-1784/HEL-1778 files.

## Decisions

### D1. Data times read after the dashboard check, for the readable set only

`changes` becomes two steps: (1) `contentQuery` under `withUserContext` exactly as today; its result is the set of
dashboards the caller can read (RLS decides, unchanged). (2) `dataQuery` under `withSystemContext`, with `ANY(<ids
returned by step 1>)` — never the raw request ids — and the same SQL shape (inner join to `outputs` only to drop panels
bound to a deleted Output; LATERAL `LIMIT 1` probe), plus `AND p.kind = 'output'` so every reported id is one the panel
list returns by query, not by convention. The `withSystemContext` call carries `DbContext`'s mandated inline
justification and the class doc is updated. Empty readable set → no second query. Items are still built from the content
map, so an unreadable id stays omitted twice over. Disclosure: `outputs[].outputId` is a subset of the `config.outputId`
values the same caller's panel list for that dashboard returns; each time is the newest `captured_at`, which the
per-panel `history` route and `panel-status` `dataUpdatedAt` already give a grantee. No other field is added.
Owner-visible change: an owner's panel bound to an Output whose pipeline the owner cannot read now gets a data time —
matching the panel list's `dataAsOf`, which is already read internally.

### D2. Warm capture for a non-owned dashboard: panels and rows only

`captureTab` no longer skips a known non-owned dashboard. `buildWarmEntry` records `readScope: "panel"` for it and
writes `outputMeta: {}` and `runBaseline: {}` (scoped metadata is a per-panel stub and run baselines belong to the owner
fan-out; neither may be seeded as owner data). Owned entries record `readScope: "output"`; an entry with no `readScope`
(written before this change) reads as `"output"`. The `WarmEntry` version stays `1` (field is additive). `readScope` is
added to `WarmEntry`, `WARM_ENTRY_KEYS` and `sanitizeEntry` (`warmStore.ts`), else `BoundedWarmStore.write` strips it
and every stored shared copy reads back as `"output"` (skeptic-design-1 CR1); the `boundedWarmStore.test.ts` key-set
assertion changes intentionally. The in-memory list entry (written by `setListEntry` and by `recordFetchResult`, which
records it from the same `nonOwned` decision `fetchPanels` makes; and by `captureTab` and `applyWarmEntry`) also carries
`readScope`.

### D3. Restore only when the copy's scope matches the current, known role

The caller's current scope is `output` when the dashboard is in the store and owned, `panel` when it is in the store and
not owned, unknown otherwise (the store already holds the list here: `hydrateTabs` waits for `dashboards.status ===
"succeeded"`). `showDashboardPanels` restores only when the scope is known AND equals the copy's `readScope`; otherwise
it drops the copy (memory entry and stored entry) and loads cold (`fetchPanels`).
- Memory path: `restoreFromMemory` checks the list entry's `readScope` first.
- Stored path (both callers: `showDashboardPanels` and `hydrateTabs.boundedRestore`): the check lives INSIDE
  `applyWarmEntry` (it takes the caller's current scope, returns false and seeds nothing on a mismatch or unknown
  scope), so it runs before any seeding; and `applyWarmEntry` never calls `seedOutputMeta` or `seedObservedRun` for a
  `"panel"` entry, even if those fields are non-empty.
On a `panel` restore, the per-panel read scope is applied to every bound Output BEFORE `panelsRestored`, through ONE
function shared with `fetchPanels` (factor `applyPanelReadScopes(panels, dashboardId, nonOwned)` out of `fetchPanels`;
`restoreFromMemory`'s owner `unscopeOutput` loop becomes the same call). Stale windows are invalidated as today
(`isWindowFresh` against `signal.outputs`, now populated), so a re-read goes through `fetchPanelPage`'s panel-scope
branch (per-panel rows route).

### D3b. Row reuse only for a window a panel restore kept (skeptic-design-2 CR1, design-3 CR1 option b)

`isReusable` (`panelRowsReuse.ts`) requires `hasRunBaseline(pipelineId)` from Output metadata, which a panel-scoped
Output never has, so without a change every restored shared card re-reads its rows. A `panel` restore marks each window
it KEPT and seeded (D4) as restore-reusable (a per-panel marker in the warm module, set in `restoreFromMemory`, consumed
by that panel's next mount, cleared on expire/reset). For a scoped Output (`getOutputPanelScope` defined), `isReusable`
is true iff the marker is present AND settled/OK, query matches, retained, generation matches; no metadata or
run-baseline requirement. Every other panel-scoped remount re-reads exactly as today (no status poll may be running
then, so nothing else could catch a stale window). The unscoped (owner) branch is unchanged byte for byte. Lifetime
(design-4 CR1, design-5 CR1): the marker is visible to EVERY `isReusable` call during the panel's FIRST mount after the
restore, including `usePanelSortFilter`'s correction that runs only once the scoped Output metadata resolves (on a
stored-copy restore that metadata is not held at mount, so the child decides AFTER `usePanelData`), and is gone for any
later mount whatever the first mount decided: it is consumed when that first mount fetches and when it unmounts
(StrictMode's simulated unmount must not consume a reuse: the executor names the mechanism in files-modified.md). Within
that mount a status-poll advance or a generation bump still forces a fetch. Markers are also cleared when another
dashboard's panels are restored or fetched, so one never outlives its restore.

### D4. A restored panel baselines its run-finish refresh on its restored rows

Gap: a run after the last change-signal refresh but before the return is otherwise swallowed (first read = baseline).
`panelStatusStore` gains `seedPanelStatusBaseline(dashboardId, Record<panelId, capturedAtMs>)`, called once, from
`restoreFromMemory` (it covers memory, lazy stored and hydrate restores), for the windows it KEPT (windows
`isWindowFresh` already invalidated are not seeded: they re-read anyway). Semantics (skeptic-design-1 CR3):
- (a) Seeds apply to the first snapshot that RESOLVES after seeding, whether that read was issued before or after the
  seed (normally `DashboardMetaRow`'s subscribe has issued it already). On that snapshot a seeded panel is treated as
  having a previous `dataUpdatedAt` equal to its seed: advance iff the item's `dataUpdatedAt` is strictly later (null
  never). Unseeded panels keep the HEL-1786 rules (baseline on first snapshot, diff afterwards).
- (b) An advance detected for a panel with no advance listener registered yet is kept PENDING for that `(dashboardId,
  panelId)` and delivered when the panel's listener subscribes (then cleared); it is never dropped. A pending advance is
  cleared with the entry on last unsubscribe, by a later seed for that panel, and on reset.
- (c) Seeds and pending advances live in a map keyed by dashboard id, independent of the ref-counted `entries` record
  (on the phone shell no consumer may be subscribed when the restore seeds). Seeds are consumed by that snapshot,
  replaced by a later seed for the same dashboard, and cleared on freshness reset (logout). The owner path does not seed
  (it has `runBaseline`).

### D5. Tests, red first (committed before implementation)

Backend: extend `DashboardChangesRoutesSpec` or add `DashboardChangesGranteeRlsSpec` (executor's call, stated in
files-modified.md) running the route's reads as non-`BYPASSRLS` `helio_app` via `TwoUserRlsApiFixture` (the
`DashboardPanelStatusRoutesSpec` pattern): owner A, dashboard-only viewer B, editor, dual-grant, stranger. Cases:
grantee gets `dataUpdatedAt` = newest history point and `outputs` = exactly the bound Outputs; every
`outputs[].outputId` appears in B's own full (all pages) panel-list response; an Output bound only on A's unshared
dashboard never appears for B even when B requests both ids; stranger/unknown id omitted; owner response unchanged;
Output with no history → `null`; an authenticated stranger requesting a dashboard with a public (`grantee_id IS NULL`)
grant gets no item. RLS transcript (labelled statements) as `helio_app`: B's `SELECT` on `outputs` and
`output_snapshot_history` for the bound ids is 0 rows while the route returns non-null times — saved to
`.concertino/scratch/HEL-1783/rls-helio-app.txt`. The existing <20 ms deep-history scenario is re-measured for the
grantee path. Jest: capture of a non-owned dashboard (entry has panels+rows, empty meta/baseline, `readScope: "panel"`);
the stored case writes through `BoundedWarmStore.write` (sanitizer exercised), never `MemoryWarmStore.put`; warm restore
(memory and stored) of a viewer dashboard makes no `fetchPanels`, sets `getOutputPanelScope` for each bound Output and
calls no Output/pipeline service; scope mismatch or unknown dashboard → cold; an owner-scoped stored copy read while the
caller is a viewer seeds no Output metadata and no run baseline, through BOTH stored-copy callers (`showDashboardPanels`
and `hydrateTabs`); `isReusable` for a scoped Output with no meta/baseline is true only with the restore marker, and for
an unscoped Output with no run baseline still false; a mounted card after a `panel` restore makes no rows request;
marker consumption: from a `panel` restore (card reuses, no rows request), every status consumer and the card unmount,
the data advances, and a remount within `REMOUNT_GRACE_MS` with no restore re-reads its rows; a restored card whose
first mount fetches (different query) and is remounted after an advance also re-reads; a stored-copy (reload) `panel`
restore whose scoped metadata resolves after mount, with a persisted default `columnSort` (and separately a URL control
filter), makes no rows request after the metadata resolves; an owned dashboard's restore of an Output also scoped
elsewhere keeps `isReusable` on the owner branch; stale window invalidated and not seeded; owner paths unchanged.
`panelStatusStore`: seeded panel fires iff later; equal/earlier/null do not; unseeded still baseline; a read issued
BEFORE the seed and resolving after it applies the seed; an advance resolving before the panel's listener subscribes is
delivered on subscribe; reset clears seeds and pending advances. `warmNonOwner.test.ts` assertions inverted (intended,
listed in files-modified.md). e2e `e2e/hel1783-shared-dashboard-tabs.spec.ts` (full file; lane DB via `DATABASE_URL`;
backend with `ANTHROPIC_API_KEY` empty): owner A seeds a CSV source → pipeline → table Output on dashboard DA shared to
viewer V (dashboard grant only) and runs it; V also has a second tab DB. As V: (a) DA → DB → DA within the TTL with
nothing changed sends no DA panel-list or rows request; (b) on DB, A changes the data and runs the pipeline; after a
change-signal refresh DA's tab shows the dot (accessible name "…, changed since you last viewed"); activating DA shows
the new value read through the per-panel rows route; (c) the `/api/dashboard-changes` response for DA has non-null
`dataUpdatedAt`; (d) V reloads on DB and activates DA within the TTL with nothing changed since: no DA panel-list or
rows request (stored-copy restore). The change-signal refresh is triggered deterministically (a `visibilitychange`
hidden→visible on the page, at least `SIGNALS_VISIBLE_MIN_GAP_MS` (30 s) after the previous refresh or under
Playwright's clock; executor confirms in `tabsBrowserTriggers.ts` and names it in the spec), never by waiting out the
2-minute cadence. Throughout: zero requests to `/api/outputs/` or `/api/pipelines/` from V's page, no `/api/*` 4xx/5xx,
no console errors. Mutations after green, each red at its own assertion: (m1) data query back in user context → backend
grantee case and e2e dot step red; (m2) data query over raw request ids AND items built from data rows →
stranger-omission case red; (m3) capture skip for non-owned restored → jest capture + e2e (d) red (NOT (a): see the note below); (m4) `panel` restore
calls `unscopeOutput` → jest scope case + e2e Output-route invariant red; (m5) seeded panel ignored, and separately seed
applied only to reads issued after it, and separately pending advance dropped → each its jest case red; (m6) restore
ignores `readScope` mismatch → jest mismatch case red; (m7) `readScope` dropped from `sanitizeEntry` → jest stored case
+ e2e (d) red; (m8) `hasRunBaseline` required again for scoped Outputs → card-level jest + e2e (d) red; (m9) marker
check removed → route-level remount jest red; (m10a) marker never consumed, (m10b) consumed only on a successful reuse →
each its marker jest case red; (m11) marker consumed by the first `isReusable` call → the metadata-after-mount case red.
Transcripts in `.concertino/scratch/HEL-1783/`.
Correction (final-gate CR2): m3 and m8 turn e2e (d), not (a), red. The e2e Output carries a persisted default `columnSort` on a
NON-control column (skeptic-design-6 CR3), so on the memory path in (a) the scoped metadata is held, the child corrects first and
its `dispatchFetch` takes the HEL-1780 client-only skip (`panelQueryRecorded`, no request); `mountOwnership` makes the parent
defer, so (a) never reaches `isReusable` or the marker. (a) still exercises the memory restore (evaluator's probe: a restored list
entry with `readScope: "panel"` and no panel-list/rows request); only (d), the stored path, reaches the marker, and m8/m3/m7 turn it
red there (`evidence/mutations-e2e.txt`).
Final-gate CR1 addition: a restored card with NO terms still compares its query with the window under the marker (`usePanelSortFilter`
correction); mutation m13 (that branch removed) turns the (i)/(ii)/(iii) cases of `usePanelData.restoreMarker.test.tsx` red. Gates grep `e2e/` for every selector, accessible name or text the change
alters and report hits.

## Risks / Trade-offs

- [Two transactions] → content/data may straddle a write; the next refresh converges. Data read only for step 1's ids.
- [System-context read] → bounded by step 1's id set and the output-panel join; proven by the `helio_app` spec and m2.
- [Seed precision] history `captured_at` is taken before the write transaction and `capturedAt` estimates request start,
  so a run straddling a rows read can compare as not newer (same race class as HEL-1786's cold baseline; closing it
  needs a snapshot time on the rows response, out of scope) → the next run refreshes.
- [Copy under another role] → D3 drops it. [Unconsumed seed] → one extra rows read. No new route, no migration.
