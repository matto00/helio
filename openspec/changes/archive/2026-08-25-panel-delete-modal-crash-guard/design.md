## Context

`DesktopPanelGrid.tsx` renders the panel detail modal (`PanelDetailModal`) whenever
`detailPanelId !== null`, looking the panel up by non-null-asserted `.find()`:

```tsx
panel={panels.find((p) => p.id === detailPanelId)!}
```

`panels` is the live `panels` prop for the current dashboard (sourced from `panelsSlice` upstream).
Any code path that removes a panel from that array while `detailPanelId` still points at it — the
panel's own delete action, another browser tab/agent deleting it, or the parent dashboard itself
being removed — makes `.find()` return `undefined`, the `!` lies about it to TypeScript, and the
modal renders with `panel === undefined`. `usePanelData(panel)` (called inside `PanelDetailModal`'s
subtree) then dereferences `panel.id` and throws, caught only by the top-level `ErrorBoundary`.

## Goals / Non-Goals

**Goals:**
- Detect, on every render where `detailPanelId` is set, whether the backing panel still exists in
  `panels`.
- When it does not, close the modal (`setDetailPanelId(null)`) instead of rendering it — no crash,
  no error boundary trip, no dangling non-null assertion.
- Cover every path that can remove the backing panel while the modal is open, not just the literal
  "delete via this modal's own surface" recipe (widened in Execution's trigger-path probe).

**Non-Goals:**
- No change to the modal's existing Escape/backdrop/close-button/Cancel semantics for the ordinary
  case (panel still exists).
- No optimistic "are you sure" UI for this case — the panel is already gone; there is nothing left
  to confirm. A silent close is the correct UX (matches how the app already treats any other
  vanished-resource read).
- No attempt to keep the modal open with a "this panel was deleted" message — Non-Goal per ticket
  scope ("close the detail modal automatically ... or render a graceful empty/closed state"); we
  choose auto-close because there is no actionable state left for the user in a modal about a panel
  that isn't there, and it needs no new shared UI primitive.

## Decisions

**Decision: `useEffect` guard, not a render-time conditional swap.**
Add a `useEffect` keyed on `[detailPanelId, detailPanel]` that closes the modal
(`setDetailPanelId(null)`) when `detailPanelId !== null` and `panels.find((p) => p.id ===
detailPanelId)` is `undefined`. Guard the render itself with the same lookup so the modal is never
even mounted with an undefined panel on the same tick the panel disappears (an effect fires after
render, so a bare effect-only fix would still crash once, on the render where the panel first goes
missing). Concretely:

```tsx
const detailPanel = detailPanelId !== null ? panels.find((p) => p.id === detailPanelId) : undefined;

useEffect(() => {
  // Gate on the panels-list load state (panelsSlice.status), not just `panels`
  // itself — `fetchPanels.rejected` sets `state.items = []` (panelsSlice.ts:149-152)
  // on a *transient refetch failure*, which is indistinguishable from a real
  // deletion by list contents alone. Only auto-close (clear detailPanelId) once the
  // list is known-loaded ("succeeded") and still doesn't contain this panel; never on
  // "loading"/"failed", so a transient window doesn't permanently dismiss the modal.
  // NOTE: this gate does NOT preserve unsaved edit-mode state — the render guard
  // below unmounts PanelDetailModal (destroying its local useState) on ANY
  // unmount, gated or not. See Risks below for the accepted scope of what this
  // gate actually buys.
  if (detailPanelId !== null && detailPanel === undefined && panelsStatus === "succeeded") {
    setDetailPanelId(null);
  }
}, [detailPanelId, detailPanel, panelsStatus]);

// render: the render guard is unconditional (not gated on panelsStatus) — it exists
// purely to prevent ever mounting PanelDetailModal with panel=undefined, regardless
// of *why* detailPanel is momentarily undefined (loading, failed, or truly deleted).
// The effect above is what decides whether to actually clear detailPanelId; the
// render guard alone does not close the modal.
{detailPanel ? (
  <PanelDetailModal key={detailPanelId} panel={detailPanel} onClose={() => setDetailPanelId(null)} initialMode={detailPanelMode} />
) : null}
```

This removes the `!` entirely — `detailPanel` is genuinely `Panel | undefined`, and the render guard
(`detailPanel ?`) is what actually prevents the crash; the effect exists to also clear
`detailPanelId` back to `null` so the component doesn't keep re-deriving `detailPanel === undefined`
every render once the panel is gone (state hygiene, not the crash fix itself).

**Correction (design-gate round 2): the render guard unmounts `PanelDetailModal`, it does not
render it "blank".** `{detailPanel ? <PanelDetailModal .../> : null}` removes the component from the
tree entirely whenever `detailPanel` is `undefined` — including during a transient
"loading"/"failed" `panelsStatus` window, before the effect below has a chance to run. Every piece of
the modal's edit-mode state (`modalMode`, `title`, `background`, `color`, `transparency`,
`chartAppearance`, `subtypeDirty`, `showDiscardWarning`) is local `useState` inside
`PanelDetailModal.tsx` (`:81, 97-101, 126-127, 132`), and the modal is additionally `key`ed by
`detailPanelId` (`DesktopPanelGrid.tsx:307`) — so **any** unmount, transient or permanent, discards
that local state; when the component remounts (panel resolves again), every field re-seeds from
`initial*` rather than resuming where the user left off. Gating the *effect* on
`panelsStatus === "succeeded"` does **not** prevent this — it was never able to, since the effect
only controls whether `detailPanelId` is cleared, and the render guard (unconditional, and
necessarily so — it is what prevents ever rendering `panel=undefined`) is what actually unmounts.

What the `panelsStatus` gate on the effect genuinely buys, restated accurately: `detailPanelId` is
not cleared during a transient "loading"/"failed" window, so if the panels list subsequently loads
successfully **and the panel is still present**, the modal remounts and is shown again — the user
does not lose the modal outright to a transient hiccup, only its local, unsaved edit-mode state (title
edits, discard-warning armed, etc., which are already lost on ANY unmount, gated or not). The app
never crashes in either case (transient or genuinely-gone), which is the actual scope of this ticket.
Preserving unsaved edit-mode state across an unmount is a materially larger design (state would need
to live above `PanelDetailModal`'s own local `useState`, e.g. lifted to `DesktopPanelGrid` or Redux)
and is explicitly **out of scope** for HEL-651 — recorded here, not silently implied to already be
handled.

Alternatives considered:
- *Render-only guard, no effect* — would stop the crash but leave `detailPanelId` pointing at a
  nonexistent id forever; harmless functionally (render guard keeps working) but leaves stale state
  that would fail a "is this actually closed" assertion in a test that checks internal state, not
  just DOM. The effect is cheap and makes the closed state genuine.
- *Selector/thunk-level guard (auto-clear `detailPanelId` from the delete thunk itself)* — rejected:
  doesn't cover the "another actor deletes it" or "parent dashboard deleted" paths, since those
  don't go through this component's own delete thunk at all. The `useEffect` above is derived
  purely from `panels` (whatever updates it, for whatever reason), so it's the one guard that
  covers every removal path uniformly.

**Decision: this is a `panel-detail-modal` spec delta, not a new capability.**
The existing `panel-detail-modal` spec already governs when/how the modal opens and closes; "closes
when its backing panel disappears" is a new closing trigger for that same capability, not a
different concern.

## Risks / Trade-offs

- [Risk] A future refactor reintroduces a direct `.find()!` elsewhere (e.g. inside
  `PanelDetailModal` itself) bypassing this guard → Mitigation: the **primary, gated regression
  test is a Jest component test** on `DesktopPanelGrid` (render with the modal open, re-render with
  the backing panel removed from `panels`, assert the modal unmounts and nothing throws) — this runs
  in the `npm test` gate and CI, unlike the Playwright suite (see Decision below). A Playwright test
  may additionally capture the real end-to-end interaction as live evidence for the ticket's
  reproduction AC, but is not itself the durable regression guard.
- [Risk] Widened trigger-path probe finds an adjacent case (e.g. DataType/pipeline deletion) that
  crashes via a different code path not fixed by this guard → Mitigation: Execution reports each
  probed path's outcome explicitly; anything found to crash outside this guard's coverage is
  reported, not silently absorbed into "fixed," and triaged as its own follow-up if out of this
  ticket's traced root cause.
- [Risk, accepted] The "second tab / MCP apply / proposal apply" scenario cannot be exercised as a
  literal cross-tab/cross-actor script: `panelsSlice.items` is only replaced by `fetchPanels.fulfilled`
  (`panelsSlice.ts:144`), dispatched from `PanelList.tsx:377` on dashboard (re)selection — there is
  no live/websocket sync, and `panel-polling` (`openspec/specs/panel-polling/spec.md`) polls panel
  *data* only, never the panel list. A tab left open on the dashboard while another actor deletes the
  panel elsewhere will not learn about it until its own next `fetchPanels` dispatch (e.g. dashboard
  re-selection, or any other action that re-triggers the fetch). This is a pre-existing property of
  the panels-list data flow, not something this guard's scope changes. The guard is still correct and
  general: it is derived purely from the `panels` prop, so it fires correctly for *whatever* causes
  that prop to reflect the panel's absence, whenever it does. See the widened Execution/Test
  decisions below for how this scenario is actually simulated and reported instead.
- [Risk, accepted — corrected design-gate round 2] Gating the auto-close *effect* on
  `panelsStatus === "succeeded"` does **not** prevent unsaved edit-mode state from being discarded
  during a transient "loading"/"failed" refetch window — the unconditional render guard unmounts
  `PanelDetailModal` (destroying its local `useState`) regardless of the gate, since the gate only
  controls whether `detailPanelId` itself is cleared. What the gate buys is narrower than originally
  claimed: `detailPanelId` survives a transient window, so the modal reopens (freshly re-seeded, not
  resumed) once the panel is confirmed still present after a successful reload, rather than being
  permanently dismissed. Preserving the actual unsaved edits across that reopen would require lifting
  edit state out of `PanelDetailModal`'s local `useState` — a materially larger design, explicitly out
  of scope for HEL-651. Chosen over two narrower alternatives considered and rejected: (a) closing
  unconditionally on any `items` change with no status gate at all (the original plan) — rejected
  because it discards unsaved state on a transient failure with no chance of the modal ever reopening,
  which is strictly worse than the chosen approach; (b) adding new loading-state UI to bridge the gap
  — rejected as out of this ticket's "don't crash" scope.

### Executor/Test simulation for cross-actor removal (revision — design-gate round 1)

Because a literal two-tab Playwright script cannot reach the "another actor deleted it" case (see
Risk above), the executor must simulate it at two levels instead:
1. **Jest, store/component-level (primary regression coverage):** render `DesktopPanelGrid` with the
   modal open and `panelsStatus: "succeeded"`, then re-render with `panels` no longer containing the
   panel (simulating the *result* of any external removal, regardless of cause) — assert the modal
   unmounts, `detailPanelId` clears, and nothing throws.
2. **In-browser Playwright probe of a real same-tab reachable path (supplementary, live evidence
   only):** trigger a same-tab action that re-dispatches `fetchPanels` while the modal is open and
   the panel has been removed server-side out from under it (e.g. delete via the API directly, then
   force a dashboard re-selection or any other in-app action that re-triggers `fetchPanels`) — assert
   the modal closes with no console error. This exercises the real `fetchPanels.fulfilled` path the
   guard is actually built on, without requiring an unreachable literal cross-tab script.

## Planner Notes

- Self-approved: choosing "auto-close" over "render an empty/closed-state message in place of the
  modal" — the ticket text offers both as options ("e.g. ... or"). Auto-close needs no new shared
  UI primitive and matches existing behavior when `onClose` fires for any other reason (modal simply
  disappears), so it is the minimal, most consistent fix.
- Verified (not assumed): `PanelCard.tsx`'s own inline delete-confirm flow (`handleRequestDelete` /
  `handleCancelDelete` in `DesktopPanelGrid.tsx`, confirmed via `dispatch(deletePanel(...))` in
  `PanelCard.tsx:204`) is entirely independent of `detailPanelId` — confirming a delete from the
  card's own confirm-inline UI never touches `detailPanelId`/`setDetailPanelId`. So the *literal*
  ticket repro (open modal, delete that same panel) is not already handled by some other existing
  close call — this `useEffect` guard is the only thing that closes the modal in that case, same as
  every cross-actor case. Confirmed by reading `PanelCard.tsx` directly, not inferred.
