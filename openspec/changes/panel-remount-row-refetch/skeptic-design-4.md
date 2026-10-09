## Skeptic Report — design gate (round 4, skeptic-design-4.md)

Reviewed tree: HEAD 7ee3f8e36a71c7ee1027cb4d1481ddb7f9bfddf2. Only the untracked change dir differs from main
(`git status --short`). I reviewed cold against the live source and the installed react-dom build.

### What I verified (with evidence)

**Round-3 CR1 is resolved structurally, not just re-worded.**

- There is no global `panelId` registry any more. The token is a per-card `useRef` passed only by `PanelCard` and
  `MobileStackPanelBody` (D2; tasks 2.2a/2.2b).
- Caller enumeration (`grep usePanelData( / <PanelCardBody / usePanelSortFilter(` in `frontend/src`, tests excluded):
  - `usePanelData` has exactly three callers: `PanelCard.tsx:105`, `MobilePanelStack.tsx:49` and
    `PanelDetailModal.tsx:213`.
  - `PanelCardBody` has exactly two hosts: `PanelCard.tsx:216` and `MobilePanelStack.tsx:65`.
  - `usePanelSortFilter` has one caller, `PanelCardBody.tsx:132`.
- So the token reaches every child owner, and the modal can never see it.
- The token is consulted only on the first mount dispatch, never on `refresh()` and never on a later key change.
  Tests 3(f2) (modal over an owned card) and 3(f3) (Output change on a mounted card) are specified with mutations.
- `PanelCardBody` is `React.memo`, and a ref object prop is identity-stable, so memoization is unaffected. The body
  renders unconditionally in both hosts; its `frozen` early return comes after its hooks.

**Round-3 non-blocking notes: all folded in.**

- TTL and cross-filter remainder: D2 (ii).
- `retain`/`release` in an effect with cleanup.
- `pipelineId` read from the D3 metadata cache, with no cache meaning not reusable.
- Session-sort refetch disclosed: D2 (i).
- Load-more carries the reuse fields forward.
- V1 runs under `<React.StrictMode>`.
- Spec wording of "A failed load is not reused" fixed.
- `tasks.md` 1.2 now cites Verification 4.
- Proposal Impact lists `usePanelSortFilter.ts` and the card hosts.
- The pre-existing race is stated in D5.

**Mechanics I re-checked.**

- `fetchPanelPage.pending` writes `lastQuery` for page 0 (`panelsSlice.ts:289-320`), so `isPendingFor`
  (`isLoadingMore` plus `lastQuery`) really describes the in-flight request.
- `latestFetchRequestId` is set unconditionally at pending and gates `fulfilled` (`panelsSlice.ts:295`, `:332`), so
  the last-dispatched page-0 request always wins.
- The child's correction effect is one-shot via `appliedPersistedDefaultRef` (`usePanelSortFilter.ts:226-243`).
  Under StrictMode its second run returns early, but the token ref keeps the value set in the first run. The token is
  never reset (no cleanup is specified), which is correct.
- The parent's mount effect has no cleanup and depends on `paginationEntry` (`usePanelData.ts:122-210`). The early
  return at `:130` needs both `prevFetchKey === key` and the render-closure `paginationEntry != null`.
- StrictMode's re-invoke runs synchronously at the end of `flushPassiveEffects`:
  `commitPassiveMountOnFiber(...)` and then `commitDoubleInvokeEffectsInDEV(priority)`
  (`node_modules/react-dom/cjs/react-dom-client.development.js:18432-18439`). No store-driven re-render can commit
  between the two runs, so the parent's second run sees the same closure `paginationEntry` as its first.

### Verdict: REFUTE

### Change Requests

1. **The StrictMode re-run of an owned host's mount effect falls outside the "first mount dispatch" scope. In dev it
   re-introduces the CR2 ordering bug (the stripped query wins over the owner's query) whenever the metadata is cached
   but the panel has no pagination entry yet.**

   The design rules this out: D2 says "When metadata is cached there is exactly one dispatcher per card mount, so the
   CR2 ordering bug cannot occur". It also says `firstMountDispatchDone` limits the token to the first dispatch. Trace
   it on the live tree:
   - **Starting state.** Metadata for Output O is cached and retained, because another card bound to O is on screen,
     or was within the last 30s. The new panel P has no `paginationState[P]`.
   - **Realistic triggers:**
     - duplicating a table panel (`duplicatePanel`, new panel id, same Output);
     - a second panel on the same Output;
     - navigating between dashboards that share an Output within 30s.

     The Output has a persisted `columnSort` default (or there is a URL control op).

   - **Commit 1, passive mounts, child first.** The child seeds on the first render, because D3 makes the cached
     metadata synchronous. Its correction effect sets the token and dispatches the sorted page 0. Pending writes
     `lastQuery = sorted` and `isLoadingMore: true`.
   - **Parent run 1.** It sees the token and skips. It sets `prevFetchKey = key` (per D2 bookkeeping) and
     `firstMountDispatchDone = true`.
   - **StrictMode re-invoke, same commit.**
     - The child's run 2 returns early because of `appliedPersistedDefaultRef`.
     - The parent's run 2 sees `prevFetchKey === key`, but its closure `paginationEntry` is still `null`, so the
       `:130` early return does not fire.
     - `firstMountDispatchDone` is already true, so the token is not consulted.
     - The remaining check is "reusable/pending for its own (stripped) query". The live entry is pending for the
       sorted query, so the check fails and the parent dispatches the stripped page 0.
   - **Result.** That stripped request is now the latest request id, so it wins. The table shows unsorted rows and the
     unfiltered `total` under an active sort indicator (or with the control filter dropped), deterministically, in the
     dev build. Production is unaffected, because there is no double-invoke.
   - **Why this matters even though it is dev-only:**
     - The dev build is where V1 (StrictMode), V4 (burst spec) and V5 (live/visual checks) all run.
     - HEL-1027 already shipped and then fixed this exact class of StrictMode ordering bug (see the comment at
       `panelsSlice.ts:322-331`).
   - **None of the specified tests reach this state:**
     - V1 and 3(b3) have a pre-existing entry, so `:130` returns early.
     - 3(f) is a cold mount with no cached metadata, so there is no ownership.
     - V2 uses "a window that is NOT reusable", meaning an entry exists.

   **Required:**
   - (a) Define the ownership skip so it also covers the StrictMode re-run of the same mount. For example:
     - set `firstMountDispatchDone` only when this instance actually dispatches (not on an ownership skip); or
     - record "ownership-skipped for key K", and on a re-run where `prevFetchKey === K` with no refresh pending,
       return early whatever the closure `paginationEntry` is.

     It must still never apply to `refresh()` or to a later key change. Round-3 CR1 (b) stays intact.

   - (b) State the rule in D2 and task 2.2b in those terms.
   - (c) Add a jest guard under `<React.StrictMode>` with a recorded red-turning mutation: cached and retained
     metadata, no pagination entry, and a persisted-sort table on the same Output (the duplicate-panel shape). Assert
     exactly one page-0 dispatch and that the settled `lastQuery` is the sorted one. Do the same for a URL control op
     if cheap.

### Non-blocking notes

- **Correction effect origin.** D2's "the child owner's mount fetch failed" implies that the correction effect
  dispatches with `origin: 'mount'`, while user-driven `debouncedRefetch` and the control-change effect use
  `'interaction'`. `dispatchFetch` is shared by all three, so say explicitly that it takes an `origin` parameter.
  Otherwise an implementer may tag them all the same, which would either lose the error surfacing or regress 3(g).
- **Do not reset the token.** State that the token is never reset in a cleanup. A "StrictMode-safe" reset would not
  be re-armed, because the child's run 2 returns early at `appliedPersistedDefaultRef`.

### Gate defects

None. No mtime-ordering evidence was involved.
