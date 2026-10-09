## Skeptic Report — design gate (round 5, skeptic-design-5.md)

Reviewed tree: HEAD 7ee3f8e36a71c7ee1027cb4d1481ddb7f9bfddf2. The only difference from main is the untracked change dir.
I reviewed it cold against the live source and the installed react-dom 19.2.8 dev build.

### What I verified (with evidence)

**Round-4 CR1 is resolved, by tracing the live code and React.**

- **The mechanics in the live code:**
  - The parent mount effect is `usePanelData.ts:122-210`. It has no cleanup. Its deps are `[currentFetchKey, outputId,
panel.id, dispatch, refreshToken, paginationEntry]`, and its early return at `:130` uses the closure value of
    `paginationEntry`.
  - The child correction effect is `usePanelSortFilter.ts:221-240`. It is one-shot through
    `appliedPersistedDefaultRef`, and it dispatches synchronously through `dispatchFetch`.
  - `fetchPanelPage` has no `condition` (grep), so its `pending` action always writes the entry, including `lastQuery`
    (`panelsSlice.ts:289-320`).
- **How React re-runs effects under StrictMode.** In `react-dom-client.development.js`, `doubleInvokeEffectsOnFiber`
  calls `disconnectPassiveEffect` and then `reconnectPassiveEffects` on the newly placed subtree root. The reconnect
  recurses into the children before the fiber's own effects. It runs synchronously from
  `commitDoubleInvokeEffectsInDEV`, so no store-driven render can commit in between.
- **The hosts.** Both hosts render the child body inside the same component that calls `usePanelData`:
  - `PanelCard.tsx:105` and `:216`;
  - `MobilePanelStack.tsx:49` and `:65` (`MobileStackPanelBody`).
- **Trace of the round-4 scenario.** Metadata is cached, the panel has no rows entry, and a persisted sort is set.
  1. Child run 1: sets the token and dispatches the sorted page 0. The pending action writes the entry.
  2. Parent run 1: sees the token, skips, and records `prevFetchKey = ownershipSkippedKey = K`.
  3. StrictMode reconnect, child run 2: returns early at `appliedPersistedDefaultRef`. The token persists, because no
     cleanup resets it (D2 now says this).
  4. Parent run 2: K matches `ownershipSkippedKey` and `refreshToken` is unchanged, so it returns early. The closure's
     `paginationEntry` (still null) is no longer consulted.
  5. Next render: the closure entry is non-null, so `ownershipSkippedKey` clears. The ordinary `:130` path then
     returns, and so does every later settle of that entry.

  Result: one page-0 request, and the sorted `lastQuery` wins. Verification 3(f5) pins exactly this shape under
  StrictMode, with a red-turning mutation.

- **The round-4 non-blocking notes are folded in:**
  - D2 "`dispatchFetch` origin" says the correction effect uses `'mount'` and interaction refetches use `'interaction'`.
  - D2 says the token is never reset in a cleanup.

**Clearing conditions: I looked for new paths where a needed fetch never happens.**

- **The child sets the token, then reuse-skips.** The entry already holds the window for the child's own (sorted)
  query, so nothing is missing.
- **The child sets the token, then its own fetch fails.**
  - The reducer marks `lastFetchOk: false` and `lastError` with `origin: 'mount'`, which the parent surfaces (D2
    "child owner's mount fetch failed").
  - The parent does not retry. Neither does today's code after a failed mount fetch, and the user can still refresh.
  - `refresh()` clears `ownershipSkippedKey` and resets `prevFetchKey`, so it always dispatches, provided
    `inFlightRef` is not left set (note N2).
- **The child sets the token, then pending-skips on an in-flight request for the same panel id.** The request
  settles, so rows or an error arrive. That is not a lost fetch, but it has an error-surfacing gap (note N3).
- **The token is set without a child dispatch.** Not reachable: `dispatchFetch` returns early only on a null
  `outputId`, and then the parent has no fetch key either.
- **A key change, or a later Output rebind.** These clear `ownershipSkippedKey`, and the token is not consulted, so
  the hook fetches as it does today.
- **The detail modal.** It never receives the token.

**Conclusion.** I found no reachable path where an owned mount ends with neither a request nor usable data, provided
the "entry present" clearing rule is evaluated as in N1. Verification 3(f5) fails any implementation that gets N1
wrong.

### Verdict: CONFIRM

### Non-blocking notes (for execution)

- **N1 (important, enforced by 3(f5)): evaluate "entry present" against the rendered closure `paginationEntry` (the
  value `usePanelData.ts:130` uses), not `store.getState()`. Alternatively, put the `ownershipSkippedKey` early return
  before any clearing check.**
  - Elsewhere in D2, "live state" means `useStore().getState()`.
  - In the StrictMode re-run, the live store already holds the child's pending entry, because the child dispatched
    synchronously in run 1.
  - So if the clearing check reads the store and runs first, it clears the key in run 2. The ordinary `:130` path then
    falls through on a null closure entry, and the stripped query is dispatched. That is round-4 CR1 again.
  - Word the code comment and task 2.2b this way.
- **N2: say what an ownership skip does to `inFlightRef`.**
  - If it sets the flag, clear it when the live entry settles, the same as the pending-skip bookkeeping. Otherwise
    `refresh()` (`:112`) is wedged forever, because the only clear is the `.finally` of the hook's own dispatch.
  - If it leaves the flag false, accept that a `refresh()` during the child's in-flight request sends one duplicate.
  - Add a jest assertion that `refresh()` dispatches after an owned mount's request has settled, including after a
    failure.
- **N3: in an owned mount whose child pending-skipped on a request it did not issue, a failure can show the empty
  state instead of an error.** The in-flight request may come from the outgoing tree's card for the same panel id.
  - If that request was `origin: 'interaction'`, or was the old tree's own mount request, D2's scoped surfacing does
    not obviously cover it. D2 covers "this hook pending-skipped on the requestId" or "the child owner's mount fetch
    failed", and here neither hook fetched.
  - Suggestion: also surface `entry.lastError` when this mount was owned and the child pending-skipped on that
    requestId. Record the skipped id on the token object.
  - This is a narrow timing window (crossing during an in-flight first load). Interaction failures do not set
    `lastError` at all, so with no rows the result is the empty state, not an error.

### Gate defects

None. No mtime-ordering evidence was involved.
