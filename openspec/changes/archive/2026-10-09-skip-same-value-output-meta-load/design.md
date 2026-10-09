## Context

See proposal.md — Why. Current hook (origin/main ecaa1a53, post-HEL-1392):

- `isLoading` initial state = `outputId !== null && getOutputMetaCached(outputId) === undefined`.
- Effect, `outputId` non-null and cache miss: `Promise.resolve().then(() => setIsLoading(true))`,
  then `fetchOutputMeta(...).then(set output, isLoading false)`.
- Effect, `outputId === null`: microtask `setOutput(null); setIsLoading(false)`.

On first mount with a cache miss the queued `setIsLoading(true)` is same-value. It is NOT
same-value when `outputId` changes after mount from a resolved Output (isLoading false) to an
uncached one — that transition must keep showing loading. Likewise the null branch is same-value
on a null mount but not when switching away from a loaded Output.

## Goals / Non-Goals

**Goals:** no state update queued whose value equals current state at mount; identical observable
loading-state sequence for every transition; deterministic red/green render-count proof.

**Non-Goals:** changing `useOutputMeta`'s public signature/return shape (HEL-1394's parked branch
consumes it); changing `outputMetaCache` semantics or HEL-1392's cache/staleness behaviour;
deduping the hook's multiple consumers per card; the cache-hit path (already queues nothing).

## Decisions

**D1 — Gate the queued sets on current state, read via a lint-clean ref mirror (or option (c)),
not by adding state to effect deps.** Keep a ref that mirrors the latest committed `isLoading`/`output`
(or track "the outputId this state was last resolved/initialised for"). In the effect, queue
`setIsLoading(true)` only if not already loading; in the null branch queue the reset only if
`output !== null || isLoading`. Alternatives: (a) functional updater `setIsLoading(prev => prev ||
true)` — rejected: an update is still enqueued, so it does not remove the
mechanism HEL-1215 probe-confirmed (an enqueued same-value update that React only bails out of
after re-invoking the component); (b) add `isLoading` to effect deps — rejected: re-runs the fetch
effect on every loading flip; (c) derive `isLoading` from `{resolvedForId}` state — acceptable
alternative if the executor finds it simpler, provided return shape is unchanged. The executor
picks (D1 ref-mirror) or (c) and records which. **A render-time ref write is NOT allowed** — the
repo's active `react-hooks/refs` lint rule reports "Cannot update ref during render" as an error
(design skeptic, round 1). Lint-clean ways to keep a ref in step: (i) update the ref next to every
setter call (initialise it from the same lazy initial values as the state); or (ii) sync it in a
`useEffect` declared BEFORE the fetch effect (effects run in declaration order, so the fetch
effect reads the committed value). Whichever is used, the ref must never be stale across an id
change; option (c) avoids the ref entirely.

**D2 — Proof is a red/green render-count test, deterministic under act, at a level where the
redundant render actually exists.** A bare `renderHook` of `useOutputMeta` CANNOT go red: with
nothing else pending on the fiber, React's eager-state bailout drops the same-value update without
re-invoking the component (design-skeptic probe, React 19.2.8: 1 render before and after). The
extra render appears only when the component has another update pending during mount — which is
PanelCardBody's real situation (probe with one other mount-time update: 3 renders before, 2 after).
So: (1) the RED/GREEN proof is the PanelCardBody render-count test with an exact before/after
count; (2) the null-branch change gets its own red/green render-count test using a wrapper
component that calls `useOutputMeta(null)` plus one other mount-time state update (or the
equivalent real consumer), exact counts stated; (3) any bare-`renderHook` loading-transition tests
are labelled GUARD tests (behaviour pins, not red/green proofs), and each must be shown failable
by a stated mutation. Mount `PanelCardBody`
(or `PanelCard`) for an output panel with a never-resolving `getOutputById`/rows mock inside
`act`, flush microtasks inside `act`, then count `PanelCardBody` function invocations (existing
pattern: `usePanelPolling` mock call count, or a dedicated counter). Assert the exact count after
the fix; demonstrate the same test is red on the pre-fix hook (executor records the red run in
its report — e.g. by temporarily reverting the hook). Plus hook-level GUARD tests pinning the loading
transitions listed in proposal.md (see the paragraph above for why they cannot be the red proof).

**D3 — HEL-1215 absorption.** Leave the identical-props `rerender` absorption in
`PanelCard.test.tsx` (harmless, still guards against any other deferred mount work) but correct
its comments, which would otherwise describe a redundant update that no longer exists.

## Risks / Trade-offs

- [Ref mirror goes stale → loading never shown on id change] → hook test for loaded→uncached id
  change asserting `isLoading` becomes true before resolve.
- [Test cache leakage between tests via module-level `outputMetaCache`] → reset the cache/freshness
  between tests using the existing reset hook HEL-1392 tests use.
- [React 19 eager-bailout nuance makes the "red" not reproduce in-test] → if red cannot be
  demonstrated deterministically, the executor must escalate rather than ship an unproven test.
