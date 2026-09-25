# HEL-579: Per-panel manual refresh

## Description

Panel data is fetched by `usePanelData` (which already exposes a `refresh()` callback) and auto-refreshed on an interval by `usePanelPolling` (`panel.refreshInterval`). There is no way for a user to force an immediate refresh of a single panel — they must wait for the poll interval. `PanelCard` already renders an `ActionsMenu`. This ticket surfaces a manual refresh control per panel.

## Scope

* Add a "Refresh" action to each panel: a control on `PanelCard` (an icon-button in the card header and/or an `ActionsMenu` item) that calls the existing `usePanelData` `refresh()`.
* Show refresh-in-progress feedback using the established accent border-spinner pattern (§7) — a spinning icon or the panel's existing loading indicator — without a full skeleton (this is a refresh, not first load). Disable/ignore repeat clicks while a refresh is in flight.
* Optionally show a subtle "updated {relative time} ago" affordance (mono, `--text-micro`/`--text-xs`, muted) so users know data freshness; derive from the fetch timestamp if readily available.
* Do not disturb the polling model: a manual refresh resets nothing about the interval other than fetching now; ensure no duplicate concurrent fetches (coordinate with `refreshToken` in `usePanelData`).

## Acceptance criteria

* Each panel exposes a keyboard-accessible Refresh control (accessible name §8) that immediately refetches that panel's data.
* In-flight state uses the accent spinner pattern; repeat activation while loading is a no-op; no duplicate concurrent fetch.
* Manual refresh coexists with interval polling without double-fetching or breaking the interval.
* Optional freshness label (if included) uses mono/muted tokens. Unit tests for the refresh trigger + in-flight guard; `npm run lint` / `npm test` pass, zero new warnings.

## Out of scope

* Changing the polling/interval model or backend refresh semantics.
* Dashboard-wide "refresh all" (could be a follow-up).

## Dependencies

None.

## Premise validation (2026-09-25, orchestrator)

See `.concertino/runs/HEL-579/evidence/premise-validation.md` (persisted in the
main checkout). Verdict: **minor-staleness** — no escalation. Key finding not
in the original ticket text: since filing, HEL-1094/HEL-1174 added a SECOND
refresh trigger (`usePanelRunRefresh` — pipeline-run-succeeded SSE fan-out),
so manual refresh will be a THIRD caller of the same `usePanelData.refresh()`.
The "no duplicate concurrent fetch" AC must hold across all three triggers,
not just poll + manual. `refresh()`/the fetch effect currently have no
in-flight guard at all (pre-existing gap, not introduced by this ticket) —
design.md must decide explicitly whether/how this ticket closes that gap.

"Refresh" re-reads the latest materialized Output snapshot; it does not
re-run the pipeline (HEL-1096's "Run to update" owns that separate
operation). This is unambiguous in the ticket text as written — no escalation
needed on re-read vs re-run.
