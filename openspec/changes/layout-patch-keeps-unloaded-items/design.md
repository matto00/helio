## Context

See proposal.md (Why). Current code (origin/main 67cf9e0e0):

- `frontend/src/features/dashboards/state/layoutPatch.ts` `buildLayoutPatch(next, baseline, resolved)`: for each
  breakpoint that differs from `baseline`, sends `resolved[bp]` when `next[bp]` is invalid, else `next[bp]`.
  `resolved` is `resolveDashboardLayout(livePanels, next)` (`useLayoutSave.ts` ~L257), which returns exactly one item
  per LOADED panel (`panels.map(...)`, `dashboardLayout.ts` L139-174) — items of unloaded panels are absent.
- `DesktopPanelGrid.tsx` ~L342 (HEL-1457): `kept = layout[bp].filter(item => !loaded.has(item.panelId))`, appended
  after the rebuilt items.
- `dashboardsSlice.ts` `updateDashboardLayout`: a non-409 failure re-syncs (`showServerLayout(null)`) and rejects with
  `extractErrorMessage(err, "Failed to save dashboard layout.")`, i.e. the server's
  `Layout rejected: breakpoint 'lg': panels '<uuid>' and '<uuid>' overlap`; `toastListeners.ts` shows the payload.
  The retry-after-rebase branch does the same for a non-conflict retry failure.
- Server message comes from `LayoutPolicy.message` and is shared with proposals/MCP (`ProposalLayoutSupport`).

## Goals / Non-Goals

**Goals:** substitution never drops an unloaded panel's item; no rejected layout save toasts raw ids; I1 preserved.
**Non-Goals:** backend/message changes; changing `resolveDashboardLayout`; changing refetch/loaded semantics.

## Decisions

**D1 — kept items come from `next[bp]`, loaded set from `resolved[bp]`.** `resolved[bp]` holds exactly the loaded
panels' ids, so `kept = next[bp].filter(i => !resolvedIds.has(i.panelId))` needs no signature change and mirrors
`DesktopPanelGrid` (authored layout, resolved items first then kept). Alternative: pass a loaded-id set — redundant
with `resolved`. Alternative: kept from `baseline[bp]` — wrong: the authored layout is what this tab displays/authors
and is what `DesktopPanelGrid` keeps.

**D2 — the substituted breakpoint is `resolved + kept`, sent as is; the server decides what `kept` is.** The client
cannot tell an unloaded LIVE panel's item from a GHOST (the item of a panel deleted here or elsewhere: `PanelRepository
.delete` leaves the stored item until the next layout write, and `deletePanel.fulfilled` only filters `panels.items`,
so the authored layout and baseline keep it; skeptic-design-2). So `buildLayoutPatch` does no client-side validity
check on the combination and never declares a save unsendable. The server already filters ghosts before validating
(`LayoutPolicy.resolveOnLive` → `onlyPanels`): a ghost is dropped and the save succeeds (delete-then-fill keeps
working exactly as today); an overlap with a live unloaded panel is a `400`, handled by D3. This removes the round-2
unsendable path and its `persistLayout` seam entirely, so pending/baseline/undo/I1 behaviour stays exactly today's.
The narrowed client guarantee: the client never sends a changed breakpoint that is invalid AMONG THE PANELS IT HAS
LOADED, and never drops an item it cannot see. Rejected alternatives: client-side "unsendable" (round 2) — false
"changed elsewhere" refusal on delete-then-fill; refetch panels before deciding — adds latency and a new async seam for
a case the server already adjudicates; omit the breakpoint (round 1) — silent partial revert.

**D3 — rejection copy is chosen client-side from existing strings; the server text never reaches the toast.**
In `updateDashboardLayout`'s non-conflict failure paths (initial and retry), after the re-sync, read `getState()` and
reject with `LAYOUT_CONFLICT_MESSAGE` ("This dashboard's layout was changed elsewhere; your last layout change was not
saved.") only when ALL hold: the failure is an HTTP `400` (skeptic-design-2 CR2: re-synced layouts routinely hold
ghosts, so a 403/404/5xx must never earn this copy); the re-sync succeeded; the panels slice is loaded for THIS
dashboard (`loadedDashboardId === dashboardId`, which `fetchPanels.pending` preserves during the refetch gap) and has
not failed (`status !== "failed"`: `fetchPanels.rejected` empties `items` but keeps `loadedDashboardId`); and the
re-synced server layout holds a panel id absent from `items`. In every other state — non-400, re-sync failed, panel
list marked stale (`loadedDashboardId` null), `fetchPanels` failed, a different dashboard loaded, no unloaded id —
reject with the generic `"Failed to save dashboard layout."` (skeptic-design-1 CR3); each state gets a slice test.
Both strings already ship, so no new wording is introduced — DESIGN.md §7 requires "human-readable" errors and this
satisfies it without an assumed copy call. Alternatives: parse UUIDs out of the server message (couples to a developer
string); change the server message (breaks agent/MCP consumers, overlaps open PR #994's `ServiceError` work); new
bespoke copy (assumed product call).

**D4 — I1.** Neither change touches `persistedVersionRef`/`baseVersion`. The baseline still follows the response
(`dashboard.layout` + `dashboard.layoutVersion` from the same response). No change to HEL-1525's consecutive-adoption logic.

**D5 — reachability of part 1 is established, not assumed.** Executor traces whether `panelsLoaded` can be true while
the authored layout holds an item for a panel absent from `panels` (e.g. 409 rebase / `dashboardUpserted` adopting
another writer's layout before `refetchPanelsIfLayoutNamesUnknown` flips loaded; a panel deleted elsewhere; create
flows). Record the finding with file:line evidence in `reachability.md`. Reachable → add a hook-level jest test for
that sequence too; not reachable → the `buildLayoutPatch` unit test pins it, no invented live repro.

## Risks / Trade-offs

- [A `400` for an unrelated reason, with a ghost in the re-synced layout, shows "changed elsewhere"] → the web client
  never sends a breakpoint invalid among its loaded panels, so a `400` from it is in practice caused by items it could
  not see; accepted and noted.
- [Conflict copy shown for a 400 not caused by another writer] → see above.
- [Server message no longer visible to the user] → it was developer-facing; tests assert it is not shown.

## Planner Notes

- Self-approved: reuse existing copy (no new user-facing wording, so no assumed product call is needed); send `resolved + kept` and let the server
  adjudicate (D2, revised after skeptic-design-1 and -2); no backend change.
- Existing scenario "Rejected save is visible … the server's message" is modified by owner direction (ticket part 2).
