# HEL-321 — Timeline panel: flat-binding support in proposal path

Ticket URL: https://linear.app/helioapp/issue/HEL-321
Priority: Medium
Project: Helio v2.0 — Agentic Dashboard Creation

## Context

Follow-up flagged by the final-gate skeptic during HEL-317 (Add Timeline panel type, PR #253). The new `timeline` panel kind ships with direct `create_panel`/`bind_panel` support (the ticket's stretch scope), but the **proposal path** does not yet give `timeline` the flat-binding treatment that `collection`/`metric` get:

* `backend/.../services/DashboardProposalService.scala` — `timeline` was added to `DataPanelKinds` (so it's recognized as a data panel), but the flat-field → `config` derivation that lets a proposal express a binding without a nested `config` block isn't wired for `timeline`'s `(time, event)` field mapping + `sort`.
* helio-mcp `src/tools/proposal.ts` — `timeline` isn't surfaced in the proposal tool's flat-binding guidance the way `collection`/`metric` are.

Net effect: an agent using `propose_dashboard` → `apply_proposal` can't cleanly derive a Timeline panel binding the way it can for the other data panel kinds — it would have to fall back to the generic `config` passthrough added in HEL-316.

## Task

Give `timeline` the same flat-binding treatment `collection`/`metric` have in the proposal path:

* Extend `DashboardProposalService` to derive a `timeline` `config` (dataTypeId + time/event field mapping + sort) from the proposal's flat fields.
* Update helio-mcp `proposal.ts` enums/descriptions so `propose_dashboard` advertises timeline binding accurately.
* Verify `apply_proposal` end-to-end produces a bound, rendering Timeline panel (live round-trip), and the in-app Proposal Review UI round-trips it.

## Acceptance criteria

1. A proposal expressing a timeline panel with a bound DataType + time/event mapping applies to a working, bound Timeline panel — without requiring the generic `config` passthrough.
2. helio-mcp proposal tool docs/enums accurately describe timeline binding.
3. Backward-compatible; `sbt test` + schema-drift + mcp build green.

## Notes

Same agentic-parity family as HEL-316 (which brought the proposal flow to v1.5 config parity). Deferred from HEL-317 as outside its stretch wording.
