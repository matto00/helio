## Context

CS2c-3b merged the backend Panel typed ADT (`backend/src/main/scala/com/helio/domain/panels/*.scala`,
7 subtypes) but preserved the legacy wide-flat wire shape via two pattern-matching adapters
(`PanelResponse.fromDomain` at `PanelProtocol.scala:78` and `DashboardSnapshotPanelEntry.fromDomain`)
and three flat-field write-path types (`CreatePanelRequest` at `PanelProtocol.scala:40`,
`UpdatePanelRequest` at `:48`, `PanelBatchItem` at `:61`). The wire-shape rewrite was intentionally
deferred so the typed-ADT diff could merge in isolation.

CS2c-3c is the final HEL-236 sub-PR. It collapses both halves of the wire to the
`type` + typed `config` shape that CS2c-2 (DataSource) and CS2c-3a (PipelineStep) already use,
migrates the frontend in lockstep to a discriminated union, evolves the JSON Schemas in place,
bumps the snapshot version, and closes the pre-existing Image / Divider snapshot data-loss bug.

**File-size pressure (entered before any new code is written):**

- `frontend/src/components/PanelDetailModal.tsx` — 1021L (well over 400L BLOCKER cap)
- `frontend/src/components/PanelGrid.tsx` — 597L (over cap)
- `frontend/src/types/models.ts` — 587L (over cap)
- `frontend/src/features/panels/panelsSlice.ts` — 439L (over cap)
- `backend/src/main/scala/com/helio/api/protocols/PanelProtocol.scala` — 248L (approaching soft cap;
  adding per-subtype typed-config formats here will push it over without extraction)

Per-subtype dispatch in CS2c-3c MUST land via extraction, not by appending to these files.

## Goals / Non-Goals

**Goals:**

- Read-path wire shape: `type` + typed `config`, removing all seven per-subtype nullable flat fields
  from the `PanelResponse` and `DashboardSnapshotPanelEntry` roots.
- Write-path wire shape: `type` + typed `config` for create/update/batch, preserving absent-vs-null
  semantics per config field.
- Snapshot version bump + Image / Divider data-loss bug fix in the same change.
- Frontend `Panel` discriminated union over 7 subtypes; all consumer sites migrated to narrowing.
- JSON Schemas evolved in place to discriminated-union shape.
- Stay within file-size budgets by extracting per-subtype editor / renderer files alongside the
  wire-shape change.

**Non-Goals:**

- HEL-242 P0 panel-binding bug (deferred; CS2c-3c must not regress it).
- Removal of `useLegacyBoundPanel` hook (CS3 cleanup).
- `appearance.chart` migration into `ChartPanelConfig` (spinoff).
- AuthService touch points (security-sensitive).
- Backward wire compatibility for the prior snapshot version — see Decisions.

## Decisions

### D1 — Schemas evolve in place, not split into `schemas/panel/`

The existing flat layout (`schemas/panel.schema.json`, `schemas/create-panel-request.schema.json`,
`schemas/update-panels-batch-request.schema.json`, `schemas/update-panels-batch-response.schema.json`)
stays flat. `panel.schema.json` becomes a `oneOf` over `type` + `config`. Per-subtype config sub-schemas
live as inline `$defs` inside `panel.schema.json` and are `$ref`'d from the create/batch schemas.
Splitting into a `schemas/panel/` folder was rejected because the flat layout matches the existing
convention and minimizes diff surface.

### D2 — Write path uses a custom `RootJsonFormat` keyed on `type`

`CreatePanelRequest` and `UpdatePanelRequest` become sealed-trait-style request types: each subtype's
config has its own request decoder (defined per-subtype under `backend/src/main/scala/com/helio/domain/panels/`),
and a top-level custom `RootJsonFormat` dispatches on the `type` field. This mirrors the
CS2c-2 / CS2c-3a pattern. Absent-vs-null on individual config fields is preserved per-field (the
existing `Option[Option[_]]` trick) — `UpdatePanelRequest`'s config payload is itself optional, and
within each typed config, fields with PATCH semantics (e.g. `typeId`, `fieldMapping`) keep
`Option[Option[_]]`.

### D3 — Snapshot version bumps and the prior version is rejected

The importer SHALL reject snapshots whose `version` does not match the new constant with a 400
documenting the break. Reasoning: (a) the prior version drops Image / Divider config fields entirely
— a snapshot exported pre-fix cannot be losslessly imported anyway; (b) supporting both shapes in the
importer would double the test matrix and re-introduce the per-subtype flat enumeration we are
removing. Users with prior snapshots can re-export after upgrade. This is called out in proposal.md
under BREAKING and in the spec deltas.

### D4 — Frontend file-size extractions (mandatory)

- `PanelDetailModal.tsx` (1021L) → per-subtype editor files under
  `frontend/src/components/panels/editors/<Subtype>Editor.tsx` (one per subtype). The modal becomes
  a discriminator-dispatched shell.
- `PanelGrid.tsx` (597L) → per-subtype renderer files under
  `frontend/src/components/panels/renderers/<Subtype>Renderer.tsx`. The grid becomes a
  discriminator-dispatched shell.
- `panelsSlice.ts` (439L) → narrowing helpers extracted to
  `frontend/src/features/panels/panelNarrowing.ts`; thunk payload builders extracted to
  `frontend/src/features/panels/panelPayloads.ts`.
- `models.ts` (587L) → `Panel` union and per-subtype config types extracted to
  `frontend/src/types/panel.ts`, re-exported from `models.ts` for backwards-compat imports.

Every file touched MUST end under 400L; files over 400L that are not touched by this change stay
out of scope.

### D5 — Backend per-subtype request decoders live with the domain type

Following the CS2c-3b polymorphism pattern, each `domain/panels/<Subtype>Panel.scala` companion
defines its `CreateConfig` / `UpdateConfig` decoders. `PanelProtocol.scala` imports them and only
holds the top-level dispatching `RootJsonFormat`. This caps protocol-layer growth and keeps the
seven-subtype enumeration in a single place (the dispatcher) for both directions.

### D6 — `PanelService.create` / `update` / batch-update dispatch on the discriminator

The service consumes the new typed request shapes, dispatches on `type`, constructs the typed
domain ADT subtype, and persists via the existing repository layer (unchanged). Cross-type PATCH
(client sends a different `type` than the stored panel) continues to reject at 400. The
`PanelService` file size must be checked after the change — if it crosses the 300L soft cap,
per-subtype `create` / `update` helpers extract to private `PanelService<Subtype>Ops` files.

## Risks / Trade-offs

- **[Snapshot import breaks for prior exports]** → Documented as BREAKING in proposal.md and in
  the `dashboard-export-import` spec delta. Users re-export after upgrade. Mitigation: Phase 3
  Playwright smoke covers export → import round-trip on the new version end-to-end.
- **[Frontend extraction surface is large alongside a wire change]** → If extraction + wire change
  together push cycle 1 past the BLOCKER size threshold, surface as ESCALATION with the split
  option (backend wire + schemas first, frontend lockstep second). This is the documented escalation
  policy in ticket.md.
- **[HEL-242 regression risk]** → Phase 3 Playwright smoke includes the bound-panel-renders-DataType
  regression check. `useLegacyBoundPanel` preserved as-is.
- **[Absent-vs-null PATCH semantics regress on typed config]** → Cycle-1 tests MUST cover
  `decode("{}")` defaults per subtype AND a PATCH that nulls a config field, AND a PATCH that omits
  a config field, AND a PATCH that updates a config field. These are the codec read-path tolerance
  rule from CS2c-2/3a/3b and the gate for cycle exit.
- **[Cross-type PATCH lock]** → existing 400-on-type-mismatch behavior preserved in
  `PanelService.update`; regression test required.

## Planner Notes

Self-approved decisions:

- **D1** chosen over a `schemas/panel/` folder because the flat convention is established and
  adding a directory move on top of a wire-shape change inflates review surface for no architectural
  win.
- **D3** rejects backward-compat snapshot import — the prior version is data-lossy for Image /
  Divider, so "preserve" semantics aren't well-defined anyway; a clean break is simpler than a
  half-faithful migrator.
- **D4** extractions are scoped to files this change is already touching. Files over 400L that the
  change does not touch (none in the surface beyond what's listed) stay out of scope per
  refactor-discipline rules.

## Migration Plan

1. Backend read path first (`PanelResponse.fromDomain` + `DashboardSnapshotPanelEntry.fromDomain`
   + snapshot version bump + Image/Divider fix + per-subtype response config formats).
2. Backend write path next (typed `CreatePanelRequest` / `UpdatePanelRequest` / `PanelBatchItem`,
   per-subtype request decoders, `PanelService` dispatch).
3. JSON Schemas evolved in place.
4. Frontend extractions land before subtype dispatch is added (file-size budgets).
5. Frontend `Panel` discriminated union + consumer-site migration + thunk payload builders.
6. Playwright Phase 3 smoke: CRUD all 7 subtypes, snapshot round-trip, HEL-242 regression.

Rollback: revert the CS2c-3c commit; the backend domain ADT (CS2c-3b) keeps working with the
prior wide-flat wire because the adapters being rewritten in CS2c-3c are the only integration
point with the wire shape.

## Open Questions

None blocking — all decisions self-approved under planner authority. ESCALATION reserved for the
case where cycle 1 hits the BLOCKER size threshold and a backend / frontend split is needed.
