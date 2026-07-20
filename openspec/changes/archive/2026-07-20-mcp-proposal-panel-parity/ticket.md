# HEL-316 — Bring helio-mcp propose_dashboard/apply_proposal flow to v1.5 panel type parity

URL: https://linear.app/helioapp/issue/HEL-316
Type: Task (tooling / MCP server)
Priority: Medium
Project: Helio v2.0 — Agentic Dashboard Creation

## Context

HEL-315 brought the helio-mcp **write/composition** tools (`create_panel`/`bind_panel` in `src/tools/write.ts`) up to v1.5 panel parity, but scoped out the separate **proposal** flow. The `propose_dashboard`/`apply_proposal` path (`helio-mcp/src/tools/proposal.ts` + `helio-mcp/src/types.ts`) still carries a stale panel type list:

- `proposal.ts` (`PANEL_TYPES`) still lists `divider` and **omits** `collection`.
- `types.ts` panel-proposal shapes likely need the same v1.5 updates (collection base type/layout, per-chart-type `chartOptions`, table density/columnOrder, text/markdown DataType binding).

Effect: an agent building a dashboard via `propose_dashboard` still can't express `collection` and gets incorrect `divider` guidance — the same gap HEL-315 closed for the direct create/bind tools.

## Scope

- Update `proposal.ts` `PANEL_TYPES` (add `collection`, drop `divider` for agent/UI parity — see HEL-315/HEL-249).
- Reconcile `types.ts` proposal panel-config shapes with the v1.5 wire shapes documented in HEL-315 / `schemas/panel.schema.json`.
- Verify `apply_proposal` round-trips the new types against a live backend (build `dist`, mint a PAT, apply a proposal containing a collection + a chart with `chartOptions`).

## Definition of done

- [ ] `propose_dashboard` panel type set matches `create_panel`'s (collection in, divider out)
- [ ] Proposal panel-config shapes support collection/chart-options/table-config/text-markdown binding
- [ ] `apply_proposal` verified end-to-end against a live backend for the new types
- [ ] No stale type lists remain in the proposal flow

## Origin

Spinoff from HEL-315 (flagged by the executor and the final-gate skeptic during that ticket's review).
