## Skeptic Report — design gate (round 3, skeptic-design-3.md)

Reviewed tree: HEAD 7ee3f8e36a71c7ee1027cb4d1481ddb7f9bfddf2. Only the untracked change dir differs from main.
I reviewed cold against the live source and the installed React build. I did not rely on the orchestrator's summary.

### What I verified (with evidence)

**Round-2 change requests, re-checked:**

- **CR1 (two derivations of the settled query): resolved.**
  - `computeSettledPanelQuery` is gone.
  - When the child (`usePanelSortFilter`'s correction effect, `usePanelSortFilter.ts:220-240`) has terms, it is the
    only dispatcher, using its existing `dispatchFetch` inputs (`controlFilterOps` from `PanelCardBody.tsx:112-115`
    and `crossFilterEq` from `PanelCardBody.tsx:130`).
  - Nothing re-derives the cross-filter term.
- **CR2 (error surfacing regressing sort/filter): resolved.**
  - `lastError` is written only for `origin === 'mount'`.
  - Interaction refetches keep the toast-only path (`usePanelSortFilter.ts:148-157`).
  - Jest guard 3(g) is specified.
- **CR3 (no run baseline): resolved.** `hasRunBaseline` gates reuse. I confirmed the baseline is unset in exactly
  the cases round 2 named:
  - `reconcile` returns early on a non-ok response, on a non-terminal status, and on any thrown failure
    (`pipelineRunFanout.ts` `reconcile`);
  - `lastObservedRunId` starts `undefined`.

  So those pipelines simply refetch.

- **CR4 (fetch-anchored clock): resolved.** The fetch-anchored clock is replaced by a card-on-screen retention
  refcount plus a 30s grace, so the ticket's literal AC no longer needs a scope reading. Case 3(b3) and the burst
  spec's "read > 30s, then cross" case cover it.
- **Round-2 non-blocking notes: all addressed in D2/D5.** These were: pending resets `lastFetchOk`; `meta.arg` as
  the single source; `prevFetchKey`/`inFlightRef` bookkeeping after a skip; the `terminalListeners` behaviour change
  stated; and double rows reported.

**New-model checks (as asked):**

- **Child-first ordering on a normal mount: holds.**
  - `PanelCardBody` is a direct, unconditional child of `PanelCard` (`PanelCard.tsx` render, ~line 235). Its
    `frozen` early return comes after all hooks.
  - It is also the direct child of `MobileStackPanelBody` (`MobilePanelStack.tsx:47-77`). Each of these calls
    `usePanelData(panel)`.
  - React runs passive mount effects child-first within a commit.
- **Child-first ordering under StrictMode: holds on the installed React** (`react-dom` 19.2.8).
  - `doubleInvokeEffectsOnFiber` calls `disconnectPassiveEffect(fiber)` on the whole placed subtree, then
    `reconnectPassiveEffects`. Reconnect recurses into children before running the fiber's own effects
    (`react-dom-client.development.js:18697-18706`, `15768-15830`).
  - So the child's ownership is re-added before the parent's second effect run.
  - Also, on a remount the parent's second run returns early at `usePanelData.ts:130`, because `prevFetchKey` is
    set and `paginationEntry` is non-null.
- **Crossing commit order: safe.** Deletion cleanups (old tree: `release`, `mountOwner.delete`, unsubscribe) run in
  the passive-unmount phase, before the new tree's passive mounts. So a `panelId`-keyed `mountOwner` and the
  retention refcount cannot be clobbered by the outgoing tree.
  - `release` → 0 with `releasedAt = now` → still retained by the grace window. Then `retain` → 1.
  - Under StrictMode the sequence is 1 → 0 → 1. This is fine provided retain/release live in an effect (see notes).
- **Is "has terms" stable at the parent's effect time?** Yes on a cached-metadata mount, with one carve-out.
  - With D3's synchronous initial state, `output` is non-null on the first render. The render-phase seed
    (`usePanelSortFilter.ts:113-119`) sets `seededOutputId`/`activeSort`/`activeFilter` before the first commit.
  - URL controls are synchronous.
  - `crossFilterEq` is synchronous only while the capabilities entry is unexpired
    (`filterCapabilitiesStore.ts:37-41`, 5-minute TTL, read through `useSyncExternalStore`). See the non-blocking
    note on the TTL.
  - On a cold load `output` is null at the first commit. There is no ownership, the parent dispatches, and the later
    correction behaves as today. This is consistent with D2.
- **`PanelDetailModal` explicit-args path: defective as specified.** See CR1.
  - The modal is a sibling of a still-mounted card on both shells (`DesktopPanelGrid.tsx:415`,
    `MobilePanelStack.tsx:181-189`).
  - It calls `usePanelData(panel, controlFilterOps, crossFilterEq)` on the same `paginationState[panel.id]`
    (`PanelDetailModal.tsx:200-213`).
- **In-place output swap:** `swapPanelOutput` (`panelThunks.ts:138-153`) dispatches `markDashboardPanelsStale` and
  then `fetchPanels`. The card most likely remounts, so the "key change while owned" path is narrower than the modal
  path. CR1 still requires the skip to be scoped so that path is correct by construction.

### Verdict: REFUTE

### Change Requests

1. **D2's mount-ownership skip is keyed only by `panelId` and is applied to "`usePanelData`'s mount path" with no
   host scoping. This silently suppresses `PanelDetailModal`'s own fetch, and it contradicts D2's own final
   bullet.**
   - **Where the registration lives.** The child that registers `mountOwner.add(panelId)` is the grid card's
     `PanelCardBody`. Its registration lasts the card's whole lifetime (cleanup runs only on unmount).
   - **What goes wrong.** While the card is mounted, the user opens the detail modal for that panel. The modal's
     `usePanelData` mount effect sees `mountOwner.has(panel.id) === true` and skips, but the modal has no child
     owner of its own. Note that when the modal has no controls and no cross-filter, `explicit` is false
     (`usePanelData.ts:141`), so its instance is indistinguishable from a host's.
   - **Effect on what the modal shows.** It renders the card's window instead of its own query. Concretely: a card
     that mounted with terms (a persisted `columnSort`, or a URL control) whose user then types a session column
     filter (an interaction refetch narrows the shared entry). Opening the modal now shows the narrowed subset and
     its server `total`. The modal's `TableRenderer` seeds only from the persisted defaults, so it shows no filter
     UI, and the rows read as the full Output.
   - **The contradiction.** D2's last bullet says the modal "will reuse the card's window when the queries match".
     That implies it fetches when they don't, which the ownership skip as written prevents.
   - **The same unscoped skip also covers any later key change** of an owned host instance (an in-place `outputId`
     change). Nothing would then fetch: the child's correction is one-shot (`appliedPersistedDefaultRef`), and the
     control-change effect does not fire on an Output change.

   **Required:**
   - (a) Scope ownership to the specific host/child pair, never to `panelId` globally. For example, the host
     passes an explicit opt-in (`usePanelData(panel, [], null, { childOwnsMount: true })`) only from `PanelCard`
     and `MobileStackPanelBody`. Or the host creates an ownership token that it hands to `PanelCardBody` as a
     prop. `PanelDetailModal` must never consult it.
   - (b) Apply the skip only to the initial mount dispatch of that host instance. That means
     `prevFetchKey.current === null` and not a `refresh()` (`replayFullQueryRef`). It must not apply to a later
     `currentFetchKey` change, such as an Output change.
   - (c) Add jest guards, each with a recorded red-turning mutation:
     - with a card mounted whose body owns its mount, mounting `PanelDetailModal` for the same panel dispatches the
       modal's own query whenever it differs from `lastQuery`;
     - an owned host whose `outputId` changes while mounted dispatches page 0 for the new Output.

### Non-blocking notes

- **Cross-filter plus capabilities TTL.** With an active cross-filter and a dwell over 5 minutes, the remounted cards
  read an expired capabilities entry. This produces `status: "loading"`, `crossFilterEq: null` and client-fallback
  at the first commit.
  - The parent replays `lastQuery.crossFilterEq` and reuses the window.
  - Then `ensureCapabilitiesLoaded` resolves, `crossFilterEq` appears, and the control-change effect
    (`usePanelSortFilter.ts:250-260`) dispatches one rows request per cross-filtered panel. That effect is a third
    page-0 fetcher, not covered by D2's checks.
  - The result is a fallback-to-server flicker plus a capabilities request.
  - This is outside V1's fixture set, so the "0 rows per crossing" claim does not cover it. Either state it as a
    known remainder in D7 and the burst report, or measure it.
- **Retention mechanism.** Specify that `retain`/`release` run in a passive effect with cleanup. A render-time
  `useMemo`/initializer would double-count under StrictMode's double render. Also specify where `isReusable` gets the
  bound `pipelineId` for `hasRunBaseline`; presumably `getOutputMetaCached(outputId)?.pipelineId`, with no cached
  metadata meaning not reusable.
- **Remount after a session sort.** A card whose user changed sort or filter this session re-seeds from persisted
  defaults on remount, so its query differs from `lastQuery` and it refetches on every crossing. This is correct (the
  rows must match the reset controls), but state it in D2 and the burst report so it is not mistaken for a
  regression.
- **Load-more reducer.** The page>0 `fulfilled` reducer rebuilds the entry object (`panelsSlice.ts` around line
  330). The executor must carry `lastFetchOk`/`generation`/`lastError` forward there, or reuse quietly stops working
  after "Load more". That outcome is safe, but it is a missed win.
- **Run V1 under StrictMode.** The design's ordering argument rests on StrictMode's reconnect order, so V1 should
  also render inside `<React.StrictMode>`. Case 3(f) covers only the cold mount.
- **Spec wording.** The spec scenario "A failed load is not reused" says the card "while it is pending ... shows an
  error". While the retry is pending, the entry has `isLoadingMore: true` and no rows, which is the loading skeleton.
  Reword to "if the request it skipped onto, or its own request, fails, the card shows an error, not an empty
  state".
- **Numbering and Impact.** `tasks.md` 1.2 cites "Verification 3" for the Playwright spec; it is Verification 4.
  Proposal Impact omits `usePanelSortFilter.ts` and the card hosts (`PanelCard.tsx`/`MobilePanelStack.tsx`, for
  retain/release and ownership).
- **Pre-existing race.** A run that completes between the initial rows response and the first `reconcile` is
  recorded as a silent first-observation baseline, and the pre-run rows become reusable. Mounted cards miss it today
  too. Mention it in D5's bound for honesty; no fix needed.

### Gate defects

None. No mtime-ordering evidence was involved.
