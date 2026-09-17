## Why

Every Helio panel today is a read-only projection of a materialized Output. The v0.8 milestone
inverts that arrow: a **form panel** writes rows into a `dataset` source. The `dataset` primitive
shipped (HEL-1072); nothing can address it from a dashboard yet. This change lands the foundation
the rest of the HEL-1082 epic builds on — the panel kind itself, its persisted config shape, and
proof that both survive a round trip.

## What Changes

- A new `form` panel kind, registered in `Panel.Registry`, with a typed `FormPanelConfig`
  carrying the bound `dataSourceId`, an ordered field list, and submit behaviour.
- `form` binds to a **source**, not an Output — the second kind after `divider` needing no
  Output binding. `PanelType.Default` stays `Divider`, untouched.
- A Flyway migration (V108) widening the `panels_kind_check` CHECK constraint and adding the
  config's storage column. **Without this a `form` panel cannot be inserted at all** — the
  ticket, epic, and design spec all omit it; see `ticket.md`'s corrections.
- The full enumeration surface the ticket's "registration is the only enumeration to change"
  claim misses: `PanelType.fromString`/`asString`, four `PanelConfigCodec` dispatch sites,
  `PanelRowMapper` row↔domain mapping and its config-column tuples, five JSON schemas, and the
  frontend `PanelKind` union with its two exhaustive switches.

## Capabilities

### New Capabilities
- `form-panel-type`: the `form` panel kind — its discriminator, persisted config contract
  (bound `dataSourceId`, ordered field list, submit behaviour), create/patch validation, and
  round-trip through `POST /api/panels` and dashboard export/import.

### Modified Capabilities
- `output-panel-placement`: its "Panel kind discriminates placement from content" requirement
  enumerates `panels.kind` as exactly `output | text | markdown | image | divider`; `form`
  joins that set, and the content-vs-placement dichotomy gains a third category (a panel that
  binds to a source).

## Impact

Backend: `domain/model/Panel.scala`, `domain/model/model.scala`, new `domain/panels/FormPanel.scala`,
`domain/panels/PanelConfigCodec.scala`, `services/panels/{PanelServiceHelpers,PanelService}.scala`,
`infrastructure/persistence/panels/{PanelRowMapper,PanelRepository}.scala`,
`infrastructure/persistence/dashboards/DashboardSnapshotRepository.scala` (the dashboard-import panel
reconstruction match — mutation-proven load-bearing for AC2, see design.md's Context correction), `api/ApiRoutes.scala`
(one-line DI: wires the real `dataSourceRepo` into `panelService`, without which task 1.10/D6's ownership check would
silently no-op in production), one new Flyway migration. `domain/panels/package.scala` was evaluated (task 1.3) and
found NOT needed — `FormPanel.scala` hand-writes its own JSON formats rather than deriving one via a macro that would
need a `DataSourceId` format in scope — so it is correctly absent from this list, not a phantom omission (round-1
evaluation CR1). Contracts: the four kind-enum-bearing files under `schemas/panels/`, plus the agent-facing surfaces
(`schemas/dashboards/dashboard-proposal.schema.json`, `backend/.../ai/AssistantProposalToolSchemas.scala`,
`helio-mcp/src/tools/proposal.ts`, `helio-mcp/src/tools/write.ts`). `AssistantProposalToolSchemas` is compared
set-equal in BOTH directions against the proposal JSON schema by `check-schema-drift.mjs`, so omitting it fails
`check:schemas`. `scripts/check-schema-drift.mjs` itself is deliberately NOT touched. Frontend:
`features/panels/types/panel.ts`, `state/panelNarrowing.ts`, `ui/grid/mobilePanelHeights.ts`, and
`ui/PanelContent.tsx` (types plus one renderer-dispatch branch — no new components; see design.md D10 for why that
branch is in scope rather than deferred). Test support (round-1 evaluation CR1): `frontend/src/test/panelFixtures.ts`,
`frontend/src/features/panels/ui/PanelContent.test.tsx`,
`frontend/src/features/panels/ui/grid/mobilePanelHeights.test.ts`, and
`backend/src/test/scala/com/helio/api/routes/proposals/ApplyProposalSpecBase.scala` (adds two exposed fixtures and
one seeded row; changes no existing fixture's behavior).

## Non-goals

No field-type builder UI (HEL-1084), no field renderers (HEL-1085), no file field (HEL-1086), no
submit wiring (HEL-1087), no counter chrome (HEL-1088/1089), no a11y audit (HEL-1090). No entry in the
interactive panel picker — a `form` panel is creatable via the API in this change, not yet
authorable in the UI. Row-write validation stays with the existing dataset write API; this
change validates config shape only.

**The agent-facing path is knowingly incomplete.** `form` IS accepted by the proposal surfaces,
but the proposal wire has no **first-class** data-source field, so a proposal supplying no config
produces an unbound form rejected with a 400 by `FormPanel.validateConfig`. A proposal that
supplies `config.dataSourceId` through the generic `config` passthrough **is** created
successfully, and stays subject to the same cross-owner ownership rejection as any other create
path — so the gap is the missing first-class field and the absent agent guidance, not an
impossibility. Agent prompt/tool copy is deliberately NOT updated here, so in practice `form`
is proposable but never suggested. All of this is a deliberate, tracked decision (coordinator
ruling on this change's Planning escalation: "file a ticket to fix the gap, add to surfaces for
now"), not an oversight, and is tracked by a coordinator-filed follow-up ticket. No guard
silently drops or auto-repairs either shape.
