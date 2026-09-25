## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence)

- Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, and
  `specs/panel-manual-refresh/spec.md` fresh from the worktree (all current as of
  this round's revision).
- Read the live, unmodified `frontend/src/features/panels/hooks/usePanelData.ts` —
  confirmed design.md's Context claims about `refresh()`'s current body
  (`prevFetchKey.current = null; setErrorForKey(null); setRefreshToken((t) => t + 1)`),
  the fetch effect's key-dedup guard, and `isLoading`'s current definition all
  match the actual file (lines 56-60, 62-86, 123-124).
- Read `frontend/src/hooks/useInFlightGuard.ts` and its test
  (`useInFlightGuard.test.ts`) — the precedent Decision 2 claims to mirror.
- Read the live `frontend/src/features/panels/ui/PanelCard.tsx` in full —
  confirmed the actual `PanelCard`/`PanelCardBody` component split and where
  `usePanelData` is currently called.
- Read `frontend/src/shared/ui/IconButton.tsx` — confirmed `icon: ReactNode`
  accepts a lucide icon or a `<Spinner/>` swap (task 2.2's icon-swap claim is
  fine).
- Confirmed React/RTL versions (`react@^19.3.0`, `@testing-library/react@^16.3.2`)
  to ground the batching analysis in Change Request 1.
- Grepped `dataAsOf` across `frontend/src` and `backend/src` and read
  `openspec/specs/panel-data-freshness/spec.md` — confirmed Decision 4's claim
  that `dataAsOf` is absent from the frontend `PanelBase` type and lives only on
  `PublicDashboardRoutes`'s wire shape is accurate; no defect there.

The round-1 defect itself (mirroring Redux state into a ref via a second
`useEffect`, lagging a render-plus-effect-flush cycle) is genuinely gone from
this round's design.md/tasks.md text — Decision 2 now describes `inFlightRef`
mutated synchronously inline in `refresh()`'s own call body, matching
`useInFlightGuard.guardedRun`'s ordering. But two new, independently-verified
problems make this round's plan not implementable/provable as written — one
that reopens the exact "is the guard actually proven closed" question round 1
was REFUTEd for, and one that undermines Decision 2's central premise from a
different angle.

### Verdict: REFUTE

### Change Requests

1. **Task 1.2's same-tick double-`refresh()` test will not actually be
   red-first against today's unguarded code — it will pass either way, due to
   React 19's automatic batching.** `usePanelData`'s actual
   `dispatch(fetchPanelPage(...))` call lives inside a `useEffect` gated on the
   `refreshToken` dependency (`usePanelData.ts:74`), not inline inside
   `refresh()` itself — unlike `useInFlightGuard.guardedRun`, which invokes its
   guarded `fn()` synchronously and inline (`useInFlightGuard.ts:28-42`), which
   is exactly why `guardedRun`'s own "two synchronous calls in one `act()`"
   test (`useInFlightGuard.test.ts:18-28`) is a valid, discriminating proof.
   For `usePanelData`, calling `refresh()` twice synchronously inside one
   `act()` callback (task 1.2's prescribed pattern: "same test statement / same
   `act()` callback, with no `await`/render flush between the two calls")
   produces two `setRefreshToken((t) => t + 1)` calls that React batches into a
   *single* render; the effect's dependency-array diff only sees one
   transition (old `refreshToken` → new), so the effect — and hence
   `dispatch` — fires exactly once *regardless of whether `inFlightRef` exists
   at all*. Verify: today's live `usePanelData.ts` has zero in-flight guard of
   any kind, yet the same batching argument already applies to it. This means
   task 1.2's test, run against a build with 1.1 reverted (i.e. today's actual
   code — there is no other "1.1-reverted" baseline to revert to, since no
   execution round has happened yet), will show `dispatch` called exactly
   once, not twice — the test will not fail pre-fix, directly contradicting
   its own instruction ("Show this test FAILING against a build with 1.1
   reverted") and the Standing Constraint ("Proof is red-first: task 1.2's
   in-flight-guard test must be shown failing before the fix, not just passing
   after it"). Required revision: replace or supplement task 1.2 with a
   genuinely discriminating test — e.g., call `refresh()` once in a first
   `act()` with the fetch's promise deliberately left unresolved (deferred
   mock), let that render/effect flush, THEN call `refresh()` again in a
   *separate*, later `act()` while the first fetch is still pending, and
   assert the dispatch spy's total call count is exactly 1. This scenario
   genuinely discriminates: without any guard, every `refresh()` call
   unconditionally resets `prevFetchKey.current = null`
   (`usePanelData.ts:57`), which defeats the effect's own
   `prevFetchKey.current === currentFetchKey` dedup check even when a prior
   fetch is still in flight — so an unguarded build genuinely dispatches
   twice here, and a build with `inFlightRef` persisting `true` across the
   render boundary genuinely dispatches once. If a same-tick-specific
   assertion is still wanted, it needs to target something not collapsible by
   React's batching (not a `dispatch`-call-count read on the exported
   `refresh` closure), or design.md/tasks.md should explicitly state that the
   literal same-tick multi-call case is already inherently safe via React's
   own batching for this architecture, and that `inFlightRef`'s real,
   provable protection is for cross-render races (poll/fan-out/repeat-click
   while a prior fetch, from any trigger, is still pending).

2. **Decision 1's placement of the Refresh `IconButton` in `PanelCard`'s
   header is not reachable from the `usePanelData` instance the design relies
   on, and the design never resolves this.** `usePanelData` (and therefore
   `refresh`/the new `isRefreshing`) is currently called only inside
   `PanelCardBody` (`PanelCard.tsx:80`) — a separate, `React.memo`-wrapped
   *child* component rendered by `PanelCard` (`PanelCard.tsx:371`). `PanelCard`
   itself never calls `usePanelData` and has no existing mechanism (ref,
   imperative handle, lifted state) for a child to expose a value back up to
   its parent. Task 2.2 literally asks for `refresh()` "passed down from
   PanelCardBody" into `PanelCard`'s header — backwards; props only flow
   parent→child in React, and `PanelCardBody` is the child here. As specified,
   this cannot be implemented. The likely fix — lifting the `usePanelData`
   call up into `PanelCard` and passing `refresh`/`isRefreshing`/etc. down into
   `PanelCardBody` as props — is a real, undecided architectural change design.md
   never states or weighs: `PanelCardBody`'s own doc comment says its
   `React.memo` boundary exists specifically "so expensive chart/table
   repaints are suppressed during drag operations," and `PanelCard`'s memo
   boundary exists "so only the actively dragged panel (and the grid wrapper)
   re-renders during a drag operation — not all N panels." Lifting the hook
   changes what re-renders `PanelCard` on every poll tick / SSE fan-out /
   fetch-state change, not just `PanelCardBody` — a trade-off nobody decided.
   Worse, if the executor instead gives `PanelCard` its *own*, second
   `usePanelData(panel)` call (rather than lifting/sharing the one
   `PanelCardBody` already calls), that creates two independent hook
   instances with two independent `inFlightRef`/`prevFetchKey`/`refreshToken`
   state trees for the same panel — which completely defeats Decision 2's
   central claim that "a guard placed inside `usePanelData` covers all three
   [triggers] uniformly with no per-caller coordination" (design.md Context).
   The manual-refresh trigger (in `PanelCard`'s hypothetical second instance)
   and the poll/SSE-fan-out triggers (still in `PanelCardBody`'s instance)
   would then hold disjoint guard state, so a manual click could freely race a
   poll- or fan-out-driven fetch — reintroducing exactly the double-fetch bug
   this design round exists to close, silently, since nothing in the current
   plan would catch it (task 1.2/1.4's tests only exercise a single hook
   instance in isolation). Required revision: design.md needs an explicit
   Decision stating where `usePanelData` is called and how ONE shared
   `refresh`/`isRefreshing` reaches both the new header button and the
   existing poll/fan-out/body call sites — most likely, move the
   `usePanelData` call up into `PanelCard` and thread its result down into
   `PanelCardBody` as props (with the re-render/memo trade-off explicitly
   acknowledged and accepted), or revise D1 to place the Refresh control
   inside `PanelCardBody` itself instead of `PanelCard`'s header (restructuring
   `panel-grid-card__actions`'s JSX accordingly, since that markup currently
   lives in `PanelCard`, not `PanelCardBody`). Either resolution needs
   corresponding updates to tasks 2.1/2.2 and to the Context section's
   currently-inaccurate claim that all three triggers "ultimately call the SAME
   closure returned by one `usePanelData` instance per panel."

### Non-blocking notes

- Decision 4's factual premise (that `dataAsOf` is absent from the frontend
  `PanelBase`/panel types and lives only on `PublicDashboardRoutes`'s wire
  shape) checked out against a fresh grep of `frontend/src` — no issue there.
- `IconButton`'s `icon: ReactNode` prop accepts either a lucide icon component
  or a `<Spinner/>` swap without any type gymnastics — task 2.2's icon-swap
  plan is sound on that front.
- Once Change Request 2 is resolved, re-verify that `PanelCardBody`'s
  `React.memo` comparison (currently relying on referential stability of the
  `panel` prop) still behaves as intended if `refresh`/`isRefreshing` become
  new props passed down — a `useCallback`-stable `refresh` (already
  `useCallback` with `[]`) should be fine, but `isRefreshing` is a plain
  boolean that will legitimately change and correctly trigger a
  `PanelCardBody` re-render when a fetch starts/settles; this is expected
  and not itself a defect, just worth the executor confirming once the hook
  location is settled.
