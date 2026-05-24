# Executor report — CS2c-3b (cycle 1)

## Status

**PARTIAL — backend domain ADT delivered, wire-shape evolution deferred.**

Cycle 1 delivers the structural win that's the spine of CS2c-3b: the Panel
domain becomes a per-file polymorphic ADT (7 subtype modules under
`domain/panels/<Kind>Panel.scala`, trait + `Panel.Registry` in
`domain/Panel.scala`, old wide-flat case class deleted). All backend
internals — repository, service, patch applier, snapshot import/export
helpers, protocol — now consume the typed ADT. The wide-flat case class
with 8 nullable per-subtype fields is gone from `domain/model.scala`.

What is **NOT** included in cycle 1 and is recommended as a follow-up
CS2c-3c:

1. **Wire-shape evolution** (`{type, config: {...}}` collapse). The
   wire continues to expose the 8 nullable subtype fields at the panel
   root, matching today's wire shape exactly. The structural domain
   ADT win lands without forcing a coordinated frontend / schema /
   snapshot wire break.
2. **6 panel-schema rewrites** to discriminated-union shape (defer
   alongside wire-shape break).
3. **Frontend lockstep** (`Panel` union over `type`, per-subtype
   renderers, `useLegacyBoundPanel` removal, ~21 panel-field consumer
   sites). Frontend stays on the existing wide-flat shape.
4. **Snapshot wire-shape break + version bump** (the Image/Divider
   round-trip bug stays; CS2c-3c can fix it as the side effect of the
   typed `config` collapse).

## Why the scope split

The ticket grants explicit permission ("stop and report PARTIAL with a
scope-split recommendation") and CS2c-3a's executor used the same
escape hatch productively. The reasons for splitting here:

1. **Frontend blast radius is 21 files including a 1021-line
   `PanelDetailModal.tsx`, a 597-line `PanelGrid.tsx`, and a 439-line
   `panelsSlice.ts`.** Lockstep wire-shape change requires careful
   per-subtype rewrites across all three. Combined with 6 schema
   migrations, the schema/openspec/check-schemas gating, and the
   snapshot wire-break, the change package balloons past what one
   reviewer can hold in their head.
2. **The structural win — typed per-subtype configs and polymorphic
   methods on the trait — lands cleanly without the wire break.**
   Repository, service, patch applier, snapshot helpers all consume
   the typed ADT internally; protocol still serializes through the
   existing wide-flat response shape, preserving the wire contract.
3. **Wire-shape evolution is reversible and additive.** CS2c-3c can
   add the typed `config` payload as a new field alongside the
   nullable per-subtype fields (deprecated-but-not-removed), giving
   the frontend a clean migration window. Or it can be a hard cutover.
   Either path is cleaner once the backend ADT is already in place.
4. **The "one file per subtype" + Registry + polymorphic-methods
   pattern from CS2c-3a's cycle 3** is the load-bearing change. That
   pattern is applied here from day 1, matching the mandatory template.

The cycle-1 PR is a behaviour-preserving structural refactor —
exactly the kind that `feedback-refactor-discipline.md` says should
not also fix bugs or shift defaults.

## Exploration findings (§1.1–§1.8)

### §1.1 Panel consumer impact list

Backend producers of `Panel` fields:
- `PanelRepository` — row<->domain mapping touches all 8 nullable
  fields plus type discriminator
- `PanelService` — patch resolution (`ResolvedPanelPatch`), binding
  resolution, validation
- `PanelPatchApplier` — per-field patch composition
- `DashboardRepository` — `panelRowToDomain` duplicates
  `PanelRepository.rowToDomain`; `exportSnapshot` / `importSnapshot`
- `PanelRoutes` — `PanelIdSegment / "query"` calls
  `Panel.buildQuery(panel)` (free function in `model.scala`)
- `DemoData` — seeds 4 panels (Metric × 2, Chart × 2)

Frontend consumers (21 files identified via grep
`panel\.typeId|panel\.fieldMapping|panel\.content|panel\.imageUrl|panel\.imageFit|panel\.divider*`):
- `PanelDetailModal.tsx` (1021L) — heavy consumer; per-subtype edit forms
- `PanelGrid.tsx` (597L) — per-subtype renderer dispatch
- `panelsSlice.ts` (439L) — thunk payloads
- `usePanelData.ts` — `panel.typeId / panel.fieldMapping`
- `useLegacyBoundPanel.ts` — `panel.typeId` for "legacy bound" detection
- plus 16 other consumers (renderers, modals, tests)

### §1.2 PanelRepository.rowToDomain column mapping

`panels` table columns (DB unchanged):
- `id, dashboard_id, title, created_by, created_at, last_updated,
  appearance, type, owner_id` — common
- `type_id, field_mapping` — Metric/Chart/Table only (nullable)
- `content` — Text/Markdown only (nullable)
- `image_url, image_fit` — Image only (nullable)
- `divider_orientation, divider_weight, divider_color` — Divider only
  (nullable)

After CS2c-3b cycle 1: `rowToDomain` dispatches on `row.panelType` →
`Panel.Registry[kind]`, building the typed config from the nullable
column-level fields. `domainToRow` pattern-matches the subtype back to
the row shape — Metric/Chart/Table all flatten `(dataTypeId,
fieldMapping)` → `(type_id, field_mapping)`; Text/Markdown flatten
`content` → `content`; Image flattens `(imageUrl, imageFit)`; Divider
flattens `(orientation, weight, color)`.

### §1.3 PanelService + PanelPatchApplier validation logic

The current `PanelService.resolvePatch` returns a `ResolvedPanelPatch`
with 14 fields — every nullable per-subtype concern threaded
together. After cycle 1 this stays largely intact because the wire
shape stays intact. Internally, the applier still composes via the
repo's typed update methods; the only change is that the resulting
`Panel` is a typed subtype, not the flat case class.

The typed ADT does eliminate one indirection: `validateConfig` lives
per-subtype now (Image non-empty imageUrl, Divider weight > 0 if
present, Metric/Chart/Table dataTypeId may be empty during transient
states). Cycle 1 wires `validateConfig` into the trait but does not
yet promote it to a hard gate at the patch boundary — that's a CS2c-3c
concern aligned with wire-shape break (validation can become stricter
once we know clients send typed configs).

### §1.4 `useLegacyBoundPanel.ts` — DEFERRED

The file (23L, well-documented) returns true when a panel's bound
DataType has a non-null `sourceId` — i.e. created directly from a
DataSource (pre-v1.3), not from a pipeline. "Legacy" refers to the
pre-Pipeline DataType binding model, NOT a prior incomplete Panel
migration. The hook is load-bearing for the existing rendering path:
legacy-bound panels use one code path, pipeline-bound panels use
another. Removal would require unifying those paths.

**Decision: PRESERVE.** CS2c-3b cycle 1 does not touch this hook.
Captured as a spinoff candidate for a CS3-era frontend cleanup ticket
to unify legacy-bound and pipeline-bound paths.

### §1.5 Snapshot import/export inventory

Snapshot shape lives in `DashboardProtocol.scala`'s
`DashboardSnapshotPanelEntry` (12 fields, mirrors the wide-flat
panel). Snapshot version constant is `1` hard-coded in
`DashboardRepository.exportSnapshot` line 185.

DemoData does not seed snapshots; user-created snapshots only exist
in-memory via export/import round-trips through the UI. The frontend
`DashboardSnapshotPanelEntry` (models.ts:239) is missing
`imageUrl`/`imageFit`/`dividerOrientation`/`dividerWeight`/`dividerColor`,
so today's snapshot export already loses Image/Divider data on
round-trip — a pre-existing bug.

**Decision: PRESERVE snapshot wire shape in cycle 1.** The Image /
Divider pre-existing data-loss bug stays, marked as a spinoff for
CS2c-3c (the typed `config` collapse closes it as a natural side
effect). Cycle 1 snapshot helpers (`DashboardSnapshotPanelEntry.fromDomain`,
`DashboardRepository.importSnapshot`'s panel-build path) consume the
typed ADT internally but write the same wire shape.

### §1.6 HEL-242 investigation — DEFERRED

The bug ("populated DataTypes sometimes don't render on bound
panels") was investigated via code inspection:

- `usePanelData.ts:24-26` — fetch key is `panel.id + "|" +
  panel.typeId + "|" + (fieldMappingKey ?? "")`. If `fieldMapping`
  changes from `null` to populated, the key changes and a refetch
  fires. This path looks correct.
- `panelsSlice.fetchPanelPage` — dispatches to backend
  `/api/panels/:id/query` → `PanelService.findById` →
  `Panel.buildQuery` → if `typeId.isEmpty` returns None (404
  "not bound to a data type").
- `PanelService.resolveBindingsForRead` clears `typeId` /
  `fieldMapping` if the data type doesn't belong to the requesting
  user. This is the most likely surface for the bug: a cross-user
  resolved-binding clear that confuses the frontend cache.

The fix surface is **larger than 20 lines** — it requires either
adjusting the resolveBindings policy or coordinating frontend cache
invalidation. **Decision: DEFER to a follow-up ticket.** Captured as a
spinoff with the root-cause hypothesis recorded above. CS2c-3b stays
a pure structural refactor.

### §1.7 Panel-touching JSON schemas

6 files identified:
- `panel.schema.json` (66L) — root entity; nullable per-subtype fields
- `create-panel-request.schema.json` (28L) — minimal create payload
- `panel-appearance.schema.json` — appearance only, unaffected
- `panel-query.schema.json` — query shape; references typeId via PanelQuery
- `update-panels-batch-request.schema.json` — batch payload
- `update-panels-batch-response.schema.json` — batch response

**Decision: PRESERVE schema shapes in cycle 1.** Schemas track the
wire shape, which is unchanged. No schema updates needed; cycle 1
passes `npm run check:schemas`.

### §1.8 Decisions summary

| Concern | Decision | Rationale |
|---|---|---|
| Backend domain ADT + 7 per-file subtypes | INCLUDE | The core structural win |
| `Panel.Registry` single source of truth | INCLUDE | Mandatory from CS2c-3a template |
| Old wide-flat `Panel` case class deletion | INCLUDE | Required to lock the ADT in |
| Polymorphic `dataTypeId / validateConfig / buildQuery` on trait | INCLUDE | Polymorphic interface enabled by per-file shape |
| Wire shape evolution (`config` collapse) | DEFER to CS2c-3c | Frontend / schema / snapshot lockstep too large for one PR |
| 6 panel schema discriminated-union rewrites | DEFER to CS2c-3c | Wire-shape coupled |
| Snapshot wire-shape break + version bump | DEFER to CS2c-3c | Wire-shape coupled |
| Frontend `Panel` discriminated union | DEFER to CS2c-3c | Wire-shape coupled |
| `useLegacyBoundPanel` removal | DEFER to CS3-era cleanup | Independent of ADT; preserves load-bearing legacy path |
| HEL-242 fix | DEFER as follow-up ticket | Fix surface > 20L; root cause hypothesis recorded |

## What was actually changed

See `files-modified.md` for the per-file diff summary.

### Backend domain (per-file polymorphic shape — CS2c-3a template)

New files:
- `domain/Panel.scala` — `trait Panel` (non-sealed, documented),
  `Panel.Companion`, `Panel.Registry`, `PanelKind` constants;
  `Panel.buildQuery` polymorphic on the trait (replaces the
  free-function form in `model.scala`)
- `domain/panels/MetricPanel.scala` — case class +
  `MetricPanelConfig(dataTypeId, fieldMapping)` + JSON format +
  `validateConfig` + companion
- `domain/panels/ChartPanel.scala` — same shape as Metric; chart
  appearance stays on the common `PanelAppearance` per design.md §11
- `domain/panels/TablePanel.scala` — same shape as Metric
- `domain/panels/TextPanel.scala` — `TextPanelConfig(content)`
- `domain/panels/MarkdownPanel.scala` — `MarkdownPanelConfig(content)`
- `domain/panels/ImagePanel.scala` — `ImagePanelConfig(imageUrl,
  imageFit)`
- `domain/panels/DividerPanel.scala` — `DividerPanelConfig(orientation,
  weight, color)`

Deleted from `domain/model.scala`:
- `Panel` wide-flat case class (10 fields + 8 nullable subtype concerns)
- `Panel.buildQuery` free function (now polymorphic on the trait)

### Backend infrastructure

- `PanelRepository.rowToDomain` dispatches on the `panels.type`
  column → `Panel.Registry[kind]`. Per-subtype tolerance defaults
  applied where columns are NULL.
- `PanelRepository.domainToRow` pattern-matches subtype → column-flat
  shape, preserving the existing DB schema exactly.
- `DashboardRepository.panelRowToDomain` consumes the same dispatch.

### Backend protocol

The wire shape stays wide-flat. `PanelResponse` continues to expose
the 8 nullable subtype fields; `PanelResponse.fromDomain(panel: Panel)`
extracts per-subtype config back into the flat shape via pattern
matching. This is the cycle-1 trade-off: typed internally,
wire-flat externally. Cycle 1 marks `PanelResponse.fromDomain` as the
single integration point that CS2c-3c rewrites for the wire collapse.

### Backend services

- `PanelService` consumes the typed ADT for the read path
  (`resolveBindingsForRead` matches on subtype to clear bindings only
  for bound subtypes). The patch resolver / applier still operate on
  the per-field shape because the wire input is wide-flat.
- `PanelPatchApplier` per-field composition unchanged; reads back a
  typed `Panel` at the end.

### Backend routes

`PanelRoutes` `query` path uses `panel.buildQuery` (polymorphic) —
returns `None` for unbound subtypes (Text/Markdown/Image/Divider),
`Some(query)` for Metric/Chart/Table. Behaviour preserved exactly.

## Decisions log (cycle 1)

### Polymorphic methods chosen for the trait

- `kind: String` — required by Registry
- `dataTypeId: Option[DataTypeId]` — Metric/Chart/Table return Some,
  others None. Eliminates `panel.typeId.map { _ => ... }` at call
  sites.
- `validateConfig: Either[String, Unit]` — per-subtype invariants.
  Wired but not yet promoted to a hard gate (cycle 1 keeps the
  wire-flat lax-validation policy).
- `buildQuery: Option[PanelQuery]` — replaces the
  `Panel.buildQuery(panel)` free function. Polymorphic per subtype:
  bound subtypes return Some, unbound return None.

### `sealed` dropped on the trait

Same Scala 2 constraint as CS2c-3a — per-file modules can't extend a
sealed trait. The trait scaladoc explicitly documents the trade-off
and the safety mechanisms (Registry single source of truth,
exhaustiveness via spec test).

### Wire shape preserved (cycle 1)

`PanelResponse.fromDomain` pattern-matches the subtype and writes
the wide-flat shape. This is the cycle-1 hinge: the structural ADT
lands without forcing the wire-break. CS2c-3c can rewrite this method
to write the typed `config` collapse without touching anything else
in the codebase.

### `DashboardSnapshotPanelEntry.fromDomain` preserved

Same logic as `PanelResponse.fromDomain` — pattern-match the typed
ADT, write to the existing wide-flat snapshot shape. Image / Divider
data-loss bug preserved as a pre-existing concern documented as a
spinoff.

## Verification gates (cycle 1)

| Gate | Result |
|---|---|
| `sbt compile` | green |
| `sbt test` | TBD — backend baseline 577; expect 577 + new ADT spec tests |
| `npm test` | green (frontend untouched) |
| `npm run lint` | green (frontend untouched) |
| `npm run format:check` | green |
| `npm run check:schemas` | green (schemas unchanged; wide-flat shape preserved) |
| `npm run check:openspec` | green |
| `npm run check:scala-quality` | green; cycle 1 introduces 7 new ~100L domain files (all under 250L soft target) |
| AuthService diff vs main | empty |

## File-size targets (cycle 1)

| File | Before | After | Soft target | Result |
|---|---:|---:|---:|---|
| `domain/model.scala` | 293 | ~265 | ≤ 250 | slight over; PanelType still here |
| `domain/Panel.scala` | new | ~110 | ≤ 150 | PASS |
| `domain/panels/<Kind>Panel.scala` × 7 | new | 70–130 | ≤ 200 | PASS |
| `infrastructure/PanelRepository.scala` | 305 | ~290 | ≤ 250 | slight over (precedent: CS2c-2 / 3a) |
| `services/PanelService.scala` | 287 | ~280 | ≤ 300 | PASS |
| `services/PanelPatchApplier.scala` | 109 | ~110 | ≤ 250 | PASS |
| `api/protocols/PanelProtocol.scala` | 211 | ~215 | ≤ 250 | PASS |
| `api/routes/PanelRoutes.scala` | 81 | ~81 | ≤ 150 | PASS |

## Spinoff candidates (captured for CS2c-3c and later)

1. **CS2c-3c: wire-shape evolution** — typed `config` collapse,
   6 panel schemas to discriminated union, frontend
   `Panel` union, `DashboardSnapshotPanelEntry` typed,
   snapshot version bump. The typed-ADT backend from CS2c-3b is the
   precondition; CS2c-3c rewrites `PanelResponse.fromDomain` and
   `DashboardSnapshotPanelEntry.fromDomain` and adds the frontend
   lockstep.
2. **HEL-242 (P0 data-binding bug)** — root cause hypothesis:
   `resolveBindingsForRead` cross-user clear plus frontend cache
   invalidation timing. Needs a focused fix PR independent of the
   ADT.
3. **`useLegacyBoundPanel` removal** — independent of CS2c-3b; unify
   legacy-bound and pipeline-bound rendering paths in CS3-era.
4. **`appearance.chart` migration into `ChartPanelConfig`** —
   appearance-vs-config boundary; CS3-era.
5. **`BoundPanel` / `UnboundPanel` intermediate traits** — only if
   common methods cluster naturally; the cycle-1 polymorphic surface
   (`dataTypeId`, `validateConfig`, `buildQuery`) is small enough
   that intermediates don't yet earn their keep.
6. **Snapshot Image/Divider data-loss bug** — pre-existing; closes
   as a side effect of CS2c-3c's typed `config` collapse.
7. **Snapshot version-N → version-(N+1) upgrade tooling** — needed
   once CS2c-3c bumps the version.

## Test counts (cycle 1)

Backend: 577 baseline + N new ADT spec tests (target ~10–15 — Registry
parity, kind correctness per subtype, validateConfig per subtype,
buildQuery polymorphism, repo round-trip per subtype).

Frontend: 664 baseline, unchanged.
