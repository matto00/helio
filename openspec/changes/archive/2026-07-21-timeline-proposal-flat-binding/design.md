## Context

`DashboardProposalService.buildDataConfig` builds a create-side typed `config` from a proposal
panel's flat fields. For any `DataPanelKinds` panel it emits `{ dataTypeId, fieldMapping }` (plus
`aggregation` when present, plus `label`/`unit` for `metric`). HEL-317 already added `timeline` to
`DataPanelKinds` and to the helio-mcp proposal enums/description, so a timeline binding via
`dataTypeId` + `{time, event}` `fieldMapping` already applies. The only remaining gap: timeline's
sole display option, `sort` (`asc`/`desc`, persisted under `config.timelineOptions.sort`), has no
flat field — it is only reachable via the HEL-316 generic `config` passthrough.

The timeline config shape (`TimelinePanelConfig`) is `{ dataTypeId, fieldMapping, timelineOptions:
{ sort } }`; `TimelineOptions.ValidSorts = {"asc","desc"}`, default `"asc"`. `decodeCreate` rejects an
invalid `sort` strictly. The schema-drift check (`scripts/check-schema-drift.mjs`) pairs the
`ProposalPanel` case-class fields with `dashboard-proposal.schema.json` properties, so a new flat
field must appear in BOTH.

## Goals / Non-Goals

**Goals:**
- Add an optional flat `sort` field to the proposal-panel contract and derive it into a timeline
  panel's `config.timelineOptions.sort`.
- Reject an invalid flat `sort` up front (no partial dashboard), matching existing `chartType` /
  `orientation` handling.
- Keep the `config` passthrough authoritative on conflict; keep flat-field-only and config-only
  proposals byte-for-byte unchanged.

**Non-Goals:**
- No frontend UI, renderer, or Proposal Review UI field changes (sort is derived server-side).
- No changes to `create_panel`/`bind_panel` (already at parity).

## Decisions

### D1 — Flat `sort` field on `ProposalPanel`, nested into `timelineOptions` at derive time

Add `sort: Option[String]` to `ProposalPanel` (with read/write in `DashboardProposalProtocol`) and
`sort` to `dashboard-proposal.schema.json` (keeps schema-drift green). In `buildDataConfig`, when
`panel.type == "timeline"` and `sort` is defined, add `"timelineOptions" -> JsObject("sort" ->
JsString(sort))` to the derived config — NOT a flat `sort` key, because `TimelinePanelConfig`
decodes `sort` from the nested `timelineOptions`. Mirrors the `metric`-only `label`/`unit` branch
already in `buildDataConfig` (per-type flat fields folded into the derived config).

*Alternative rejected:* reuse the existing generic `config` passthrough only (status quo). Rejected
because the ticket's parity goal is precisely to express `sort` as a flat field, and AC2 calls for
the proposal tool "enums" to describe it.

### D2 — Up-front validation via a new `RequestValidation.validateTimelineSort`

Add `validateTimelineSort(sort: Option[String]): Either[String, Option[String]]` next to
`validateChartType`/`validateDividerOrientation`, backed by `TimelineOptions.ValidSorts` (reference
the existing set, do not duplicate the literal). Call it in `validatePanel` guarded by
`panel.type == "timeline"`, so a bad `sort` fails `validateStructure` before `createAll` — no partial
dashboard. `decodeCreate`'s strict check remains a backstop for the `config` passthrough path.

*Alternative rejected:* rely solely on `decodeCreate`'s create-time rejection. Rejected because the
service's contract is to reject structurally-bad panels before ANY creation (existing invariant);
relying on mid-create rejection would depend on rollback and lose parity with `chartType`.

### D3 — `mergeConfig` interaction is unchanged; explicit `config` still wins

`buildCreateRequest` already merges the passthrough `config` OVER the derived config, so a proposal
supplying both flat `sort` and `config.timelineOptions.sort` keeps the explicit `config` value — the
established D2/HEL-316 contract. No change to `mergeConfig`. The flat `sort` only contributes to the
`derived` object.

### D4 — helio-mcp surface

Add `sort: z.enum(["asc","desc"]).optional()` to `panelSchema` in `proposal.ts`, add `sort` to the
`ProposalPanel` interface in `types.ts`, and update the `timeline` bullet in the `propose_dashboard`
description to present `sort` as a flat field (retaining the note that `config.timelineOptions`
overrides). These are advisory (not field-checked by schema-drift) but must stay accurate per AC2.

## Risks / Trade-offs

- [A stray flat `sort` on a non-timeline panel is silently ignored] → Matches existing behavior for
  other per-type flat fields (`chartType` on a table, `content` on a chart). Validation only fires
  for `timeline`; derivation only nests it for `timeline`. Documented in the schema/tool description.
- [Schema-drift breakage if `sort` is added to only one of case-class/schema] → Add to both in the
  same change; `npm run check:schemas` is a required gate.

## Migration Plan

Additive, backward-compatible; no data migration. `sort` is optional — existing proposals and the
Proposal Review UI round-trip unchanged. Rollback = revert; no persisted shape change (timeline
already persists `timeline_options` via V58).

## Planner Notes (self-approved)

- Scope is additive and within-ticket (no new deps, no breaking API, no architectural change) — no
  human escalation required.
- Verification (executor/evaluator/skeptic) must include a live `apply_proposal` round-trip producing
  a bound, rendering Timeline panel, plus an in-app Proposal Review round-trip, per the ticket's
  verification clause and AC1.
