## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed cold against the live tree at HEAD febb2013bd8b41704084192749535c3c4249576f (worktree branch
`bug/shared-dashboard-change-dots-warm/HEL-1783`; the change dir is untracked planning artifacts). Every artifact
statement was treated as a claim and checked in source. skeptic-design-1.md was read as a claim too. Its CR1-CR3 are
addressed in the text, but it missed the row-reuse gate (finding 1 below), and that gap blocks the core AC.

### What I verified (with evidence)

**D1 (backend). Sound.**
- `DashboardChangesRepository.changes` runs `contentQuery(ids).zip(dataQuery(ids))` in one `ctx.withUserContext`, and
  `dataQuery` inner-joins `outputs`. A dashboard-only grantee under RLS therefore gets no data rows. The "Why" is correct.
- `DbContext.withSystemContext` (DbContext.scala:63) exists and runs on the privileged pool. Bounding it to step 1's
  readable ids, and building items from the content map, is sound. Adding `p.kind = 'output'` makes the panel-list
  subset invariant hold by query rather than by convention.
- The client side holds. `changeRule.hasChangedSince` has no role check, so the dot needs only the server fix.
  `isWindowFresh` treats an Output missing from `signal.outputs` as FRESH (`warmValidity.ts`, `data === null || ...`).
  D1's completeness is therefore load-bearing for the warm restore. m1 (data query back in user context) is caught by
  the backend grantee case and by e2e (b)'s dot step. This is adequate.

**D2 (capture and sanitizer). Correct against the code.**
- `sanitizeEntry` rebuilds the entry from a fixed key list (`warmStore.ts`), and `BoundedWarmStore.write` always
  sanitizes. D2 now names `WarmEntry`, `WARM_ENTRY_KEYS`, `sanitizeEntry` and the `boundedWarmStore.test.ts` key-set
  change. D5 requires the stored case to go through `BoundedWarmStore.write`. m7 is defined. Round-1 CR1 is resolved
  in design.md.
- `captureTab` currently returns early on `isKnownNonOwnedDashboard` (`warmCapture.ts`). Removing that restores
  `setListEntry` and `retainTab`. `buildWarmEntry` would otherwise copy the scoped meta stub (pipelineId `""`). D2's
  `outputMeta: {}` / `runBaseline: {}` is right.
- The in-memory list entry has more writers than D2 names. `recordFetchResult` (`warmCache.ts`, every `fetchPanels`
  result) also writes it, with no `readScope`. Under D2's default ("absent reads as `output`"), a shared list entry that
  `captureTab` did not overwrite (capture skipped because `items === null`) becomes a mismatch, and the restore goes
  cold. That fails safe and is non-blocking, but the writer should be named (see notes).

**D3 (scope match). Mostly unambiguous now. One call site is unaddressed (CR3).**
- `hydrateTabs` waits for `dashboards.status === "succeeded"`, and the test harnesses (`tabsTestStore.ts`,
  `showDashboardPanels.test.ts`, `warmReloadStaleCopy.test.ts`) all put the dashboard in `dashboards.items`. So
  "unknown -> cold" does not regress owner paths or existing tests.
- `fetchPanels` (`panelThunks.ts:84-89`) is the scope seam D3 factors out, and `restoreFromMemory`'s `unscopeOutput`
  loop (`showDashboardPanels.ts`) is the call it replaces. Applying the scope before `panelsRestored` is correct.
  `outputMetaCache` entries carry `scoped`, so an m4 `unscopeOutput` would make the card fetch `GET /api/outputs/:id`.
  The e2e Output-route invariant would therefore go red, as claimed.
- `applyWarmEntry` has a SECOND caller that D3 does not mention: `hydrateTabs.boundedRestore` (`hydrateTabs.ts:111`).
  It reads the stored copy of the reload target and applies it before `showDashboardPanels` runs. D3 places the
  stored-copy scope check "on the read WarmEntry BEFORE applyWarmEntry seeds anything" in the `showDashboardPanels` flow
  only. See CR3.

**D4 (seeds). Semantics match the real mount order.**
- `DashboardMetaRow.tsx:96` / `DashboardRefreshLine.tsx:80` subscribe through `useSyncExternalStore` in child passive
  effects. These run before `App.tsx`'s `showDashboardPanels` effect, so the first `panel-status` read is in flight
  before a seed. D4(a), "first snapshot that RESOLVES after seeding", is the right rule.
- `panelStatusStore.read` delivers advances only to `advanceListeners` present on resolve. D4(b) (pending until the
  listener subscribes) closes that. `usePanelStatusRefresh` sets `refreshRef` in an earlier effect of the same commit,
  so a synchronous delivery on subscribe reaches the card's real `refresh`, and a refresh always fetches
  (`usePanelData.ts`, "a refresh ... always fetches").
- The phone shell subscribes later (cards only, after `panelsRestored`). Seeds therefore have to live outside
  `entries`, which `acquire`/`release` create and delete. D4(c) implies this but does not state it (see notes).

**Finding 1 (blocking): a restored shared window can never be reused, so the warm switch still reads rows.**
- `panelRowsReuse.isReusable` (`frontend/src/features/panels/state/panelRowsReuse.ts:51-59`) is the only gate that lets
  a mounting card skip its rows request (`usePanelData.ts:308`, `usePanelSortFilter.ts:303`). Its last line is:

  ```ts
  const pipelineId = getOutputMetaCached(outputId)?.pipelineId;
  return pipelineId !== undefined && hasRunBaseline(pipelineId);
  ```

- For a panel-scoped Output this is always false:
  - The scoped metadata is `outputFromPublicMeta`, whose `pipelineId: ""` (`outputMetaCache.ts:~60`). Nothing records a
    run for it: "A panel-scoped read has no pipeline to register".
  - `hasRunBaseline("")` is `lastObservedRunIdByPipeline.has("")`, which is false (`pipelineRunFanout.ts:70`).
  - On a stored `panel` restore D2/D3 seed no `outputMeta`, so `getOutputMetaCached` is `undefined`.
- Consequence: under D2-D4 as written, every shared card mounted after a warm restore (memory or stored) dispatches
  `fetchPanelPage` and hits the per-panel rows route. The spec scenarios "Warm switch on a shared dashboard makes no
  panel requests" and "Reload within the TTL is warm" for shared dashboards cannot be met. e2e (a) and (d) would stay
  red after implementation.
- Neither design.md, tasks.md nor proposal.md mentions `panelRowsReuse`, `isReusable` or `hasRunBaseline` (grep: zero
  hits outside skeptic-design-1.md, which cited only the `isRetained` and generation clauses).
- The D5 jest restore case asserts only "no `fetchPanels`" and "scope set". It would pass while the rows are still
  re-read, and only the e2e would catch it, late. The design has to decide the reuse rule for panel-scope windows,
  because its safety argument changes. The run baseline is what guarantees a run that finished while away has bumped
  the generation. For a scoped Output that guarantee must come from D1 (`isWindowFresh` at restore) plus D4 (a seeded
  panel-status advance leads to a refresh). This also changes remount behaviour on an ACTIVE shared dashboard (today
  every remount re-reads), and the design must say so.

**Plan and mutations**
- tasks.md 4.2 says "Mutations m1-m6 (design D5)", but design D5 defines m7 (the round-1 CR1 sanitizer mutation). An
  executor working from the task list skips the one mutation that proves the sanitizer fix (CR2).
- The visibility trigger (`tabsBrowserTriggers.ts`) is confirmed: a `visibilitychange` to visible calls `refresh()` only
  if `Date.now() - lastRefreshAt >= SIGNALS_VISIBLE_MIN_GAP_MS` (30 s). The hidden half also runs `handlePageHidden`
  (capture plus a tabs PATCH). A second toggle within 30 s in the e2e is silently a no-op (see notes).
- AC coverage: AC1 (D1 + `helio_app` spec and transcript), AC2 (e2e a-d), AC3 (`TwoUserRlsApiFixture` + transcript) and
  the owner-ruling warm scope (D2-D4) are all planned. With finding 1 open, AC2's warm half is not achievable as
  designed.

### Verdict: REFUTE

D1 is sound, and D2-D4 are now unambiguous on the sanitizer, the memory-entry scope and the seed timing. But the
design leaves the client's single row-reuse gate (`isReusable`) requiring an owner-only pipeline run baseline. A
restored shared window therefore can never be reused, and the warm-cache half of the ticket cannot work as planned.
That is a design decision (what makes a panel-scope window safe to reuse), not an implementation detail, so it has to
be settled in the artifacts.

### Change Requests

1. **Define panel-scope row reuse (D3/D4 + D5), `frontend/src/features/panels/state/panelRowsReuse.ts:51-59`.**
   - Add a decision stating the reuse rule for an Output that has a panel read scope (`getOutputPanelScope(outputId)`
     defined). Suggested rule: reusable iff the window is settled and OK, the query matches, the Output is retained, and
     the generation matches. Do NOT require Output metadata or `hasRunBaseline`.
   - State why that is safe: staleness at restore is covered by D1 + `isWindowFresh` (which invalidates), and runs after
     the capture are covered by D4's seeded `panel-status` advance, which leads to a refresh.
   - State the effect on remounts on an ACTIVE shared dashboard. Today they always re-read. Under the new rule they
     reuse, and freshness comes from the `panel-status` poll.
   - Keep the owner branch byte-for-byte unchanged.
   - Add jest cases at the `isReusable` level, and at the card level (`usePanelData` or an integration through
     `showDashboardPanels` + mounted card), proving that a `panel` restore makes no rows request. Also prove that an
     unscoped Output with no run baseline is still NOT reusable, so the owner rule did not loosen.
   - Add a mutation (m8): restore the `hasRunBaseline` requirement for scoped Outputs. The card-level jest case and e2e
     (a)/(d) must go red.
2. **tasks.md 4.2: make the mutation list match design D5.** Change "m1-m6" to the full set (m1-m7, plus m8 from CR1).
3. **D3: cover the second stored-copy caller.** `hydrateTabs.boundedRestore` (`hydrateTabs.ts:111`) also calls
   `applyWarmEntry` on a stored copy (the reload target). Choose one of these and state it:
   - Put the scope check INSIDE `applyWarmEntry` (pass the caller's current scope; return false and seed nothing on a
     mismatch or an unknown role).
   - Run the same check at both call sites.

   Extend the "owner-scoped stored copy read while the caller is a viewer seeds nothing" jest case to the hydrate path.

### Non-blocking notes
- D2: name `recordFetchResult` (`warmCache.ts`) as a third list-entry writer. Either it records `readScope` from the
  same `nonOwned` decision `fetchPanels` makes, or the fail-safe "absent reads as `output`" (so a shared entry goes
  cold) is the stated intent.
- D4: state explicitly that seeds (and pending advances) are kept in a map keyed by dashboard id, independent of the
  ref-counted `entries` record. On the phone shell no consumer may be subscribed when the restore seeds.
- e2e (b): any second `visibilitychange` refresh must be at least 30 s after the previous one (`SIGNALS_VISIBLE_MIN_GAP_MS`),
  or the test must use Playwright's clock. Otherwise it silently does not refresh.
- Pre-existing, not introduced here: `capturedAt` is the rows request's start and `captured_at` is stamped by the run.
  A run whose `captured_at` precedes its commit by more than the gap to the rows read would compare as "not newer". The
  D4 seed inherits the same comparison as `isWindowFresh`. No action needed for this ticket.
