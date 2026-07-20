## Context

The proposal flow (`POST /api/dashboards/apply-proposal`) is a shared write path used by both the MCP
`apply_proposal` tool and the in-app Proposal Review UI. Its contract is the backend `ProposalPanel`
(`backend/.../protocols/DashboardProposalProtocol.scala`), a flat HEL-293 shape.
`DashboardProposalService.buildCreateRequest` translates each proposal panel into a
`CreatePanelRequest` whose `config` is built ONLY from flat fields:
- `buildDataConfig` → `{dataTypeId, fieldMapping, aggregation?, (metric: label/unit)}`
- `buildNonDataConfig` → `{content}` | `{imageUrl, imageFit}` | `{orientation}`

That `CreatePanelRequest` is handed to `PanelService.create`, which routes through
`PanelConfigCodec.decodeCreateConfig` — the same decoder that already accepts every v1.5 config
surface (collection `baseType`/`layout`, chart `chartOptions`, table `density`/`columnOrder`,
text/markdown binding). So the ONLY missing link is the proposal boundary silently dropping those
fields; the create machinery below it is fully v1.5-capable.

## Goals / Non-Goals

**Goals:**
- Make every v1.5 panel config surface expressible through a proposal, additively.
- Keep existing flat-field proposals byte-for-byte unchanged (backward compatible).
- Drop `divider` from the proposal type surface for agent/UI parity.
- Keep the schema, backend protocol, and MCP client in lockstep.

**Non-Goals:**
- No change to `create_panel`/`bind_panel`, no NL authoring, no new panel types.
- No removal of the flat convenience fields.

## Decisions

### D1: Generic `config` passthrough on `ProposalPanel` (vs. per-field expansion)
Add an optional `config: Option[JsObject]` to `ProposalPanel` rather than adding explicit
`chartOptions`/`density`/`columnOrder`/`baseType`/`layout` fields. Rationale: it mirrors
`create_panel`'s existing `config` record passthrough (HEL-315), reuses the create decoder verbatim,
and is future-proof against further panel-config growth without another contract change. Alternative
(explicit fields) rejected: duplicates the panel-config schema into the proposal contract and needs a
new field per future surface.

### D2: Merge precedence — derived flat config UNDER `config`
In `buildCreateRequest`, compute the derived config from flat fields exactly as today, then merge the
passthrough `config` on top (`derived ++ config`). Rationale: an explicit `config` is the richer,
more intentional channel, so it wins on key conflict; but flat fields still populate `dataTypeId`/
`fieldMapping`/`aggregation` when `config` omits them. Because existing proposals carry no `config`,
the merged result is identical to today for them. For a `DataPanelKinds` panel (metric/chart/table/
collection), `config` must NOT be allowed to clobber the server-resolved `dataTypeId`/`fieldMapping`
binding semantics silently — so the merge keeps `dataTypeId` from the flat field authoritative
(re-apply it after the merge) to preserve the V41 pipeline-only binding guarantee for those types.

**Round-1 skeptic finding (fixed, see D3a):** the above only protects `DataPanelKinds`. Text/markdown
panels have no flat `dataTypeId` field to re-apply (HEL-244 gave them an optional `dataTypeId` binding
that lives ONLY inside `config`/the typed panel config), so a text/markdown `config.dataTypeId` was
reaching `PanelService.create` with no V41 check at all — live-reproduced as a 201 that persisted a
source-companion binding on a `text` panel. D3a below is the fix.

### D3: `config` merges into whichever base `buildCreateRequest` produces
`buildCreateRequest` branches: `dataTypeId.isDefined ? buildDataConfig : buildNonDataConfig`. The
passthrough merges into whichever base is produced:
- **Data panels** (metric/chart/table/collection) always carry a flat `dataTypeId` — `validatePanel`/
  `DataPanelKinds` reject a data panel without one BEFORE the merge runs — so the derived base is
  never empty here; `config` only augments it (e.g. chart `chartOptions`, table `density`/
  `columnOrder`, collection `baseType`/`layout`) alongside the flat binding.
- **Non-data panels** (text/markdown/image) may produce an empty/small base from
  `buildNonDataConfig`; when such a panel supplies only `config`, `config` alone forms the payload.
`decodeCreateConfig` tolerates absent fields (yields the subtype `Empty`), so a merged-or-`config`-only
payload decodes correctly for every kind. The data-panel `dataTypeId` requirement is unchanged — this
change never loosens `DataPanelKinds`.

### D3a: V41 enforcement for text/markdown `config.dataTypeId` (round-2 fix)
Fixed at the shared root rather than only in the proposal layer, per systematic-debugging (fix the
cause, not the symptom) — this also happened to close a pre-existing, ticket-independent hole in the
direct `POST /api/panels`/`create_panel` path (same root cause, since HEL-244):
- `PanelServiceHelpers.dataTypeIdFromCreateConfig` now also extracts `dataTypeId` for `TextCreate`/
  `MarkdownCreate` (previously only the bound trio + collection). `PanelService.create`'s
  `rejectCompanionBinding` — already called for every create, on every path — now sees and validates
  their binding target exactly like any other panel type: a companion (non-pipeline-output) DataType
  400s, a valid pipeline-output DataType succeeds (201), matching the intended v1.5 "text/markdown
  DataType binding" surface this ticket documents.
- `DashboardProposalService.preValidateBindings` gained a `bindingCandidate`/`nonFlatConfigDataTypeId`
  helper so the proposal's up-front atomicity guarantee ("nothing is created on a bad binding") also
  covers a non-`DataPanelKinds` panel's `config.dataTypeId`, rather than relying solely on
  `PanelService.create`'s mid-create rejection + `createAll`'s rollback-the-whole-dashboard fallback.
With both in place, the V41 guarantee is universal again for every panel type and every create path
(direct API, `create_panel`, `apply_proposal`) — enforced via two different mechanisms depending on
whether the panel type has a flat `dataTypeId` field, but equally strict either way.

### D4: Drop `divider` from the schema enum + MCP; keep backend `PanelType.fromString` tolerant
`schemas/dashboard-proposal.schema.json` enum and the MCP `PANEL_TYPES` drop `divider`. The backend
`validatePanel` still calls `PanelType.fromString` (which accepts `divider` on the wire for other
paths) and `validateDividerOrientation`; we leave that tolerant so the contract does not hard-break
any existing caller — the enum removal is the agent-facing surface, matching how HEL-315 handled
`create_panel`. The `buildNonDataConfig` `divider` branch stays for wire compatibility.

### D5: MCP client shape
`types.ts` `ProposalPanel` gains `config?: Record<string, unknown>`. `proposal.ts` `panelSchema` gains
`config: z.record(z.unknown()).optional()`, drops `divider` from `PANEL_TYPES`, and the tool
descriptions are refreshed to document the `config` passthrough and per-type v1.5 shapes (reusing the
accurate guidance already written for `create_panel`).

## Risks / Trade-offs

- [Shared write path — Proposal Review UI regression] → Change is strictly additive (new optional
  field, one enum value removed from agent surface only); verify the in-app Proposal Review flow
  still round-trips a proposal end-to-end during evaluation.
- [`config` clobbering binding fields] → D2 keeps flat `dataTypeId` authoritative after merge for
  `DataPanelKinds`; add a backend test asserting a `config` that tries to override `dataTypeId` cannot
  break the V41 binding. **Round-1 skeptic finding**: this did NOT originally cover text/markdown,
  whose `dataTypeId` lives only in `config` (HEL-244) — live-reproduced bypass, fixed at the shared
  root by D3a (`PanelServiceHelpers.dataTypeIdFromCreateConfig` + `preValidateBindings`); regression
  tests added for both the bypass-rejected and valid-binding-succeeds cases.
- [Schema/backend/MCP drift] → All three updated in one change; `openspec validate` + a backend
  round-trip test covering a `config`-carrying proposal guard against drift.
- [`divider` enum removal breaking an existing proposal fixture] → backend `fromString` stays
  tolerant; only the JSON-schema enum and MCP surface tighten. Non-breaking on the wire.

## Migration Plan

Additive; no data migration. Deploy backend + schema + MCP together. Rollback = revert the change;
no persisted state depends on the new field.

## Planner Notes

- Self-approved: `config`-passthrough design (D1) and flat-under-config precedence (D2) — both follow
  the established `create_panel` passthrough pattern; no new external dependency.
