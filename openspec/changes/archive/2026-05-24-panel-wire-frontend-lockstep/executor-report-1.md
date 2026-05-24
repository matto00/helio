# Executor Report — CS2c-3c cycle 1

**Status:** BLOCKER — partial completion. Backend + schemas done; frontend
lockstep deferred per the escalation policy.

## Scope completed (tasks 1, 2, 3, 6.1–6.5)

### Backend read path (task 1)

- `PanelResponse` now `{ id, dashboardId, title, type, meta, appearance,
  ownerId, config: JsValue }`. Per-subtype flat nullable fields gone.
- `PanelResponse.fromDomain` delegates to `PanelConfigCodec.encodeConfig`,
  which dispatches on the typed `Panel` ADT subtype to emit the typed
  config payload via the per-subtype `RootJsonFormat`.
- `DashboardSnapshotPanelEntry` collapsed to the same shape, with
  `DashboardSnapshotPayload.CurrentVersion = 2`. Image / Divider config
  fields now survive export → import round-trips (closes the pre-existing
  data-loss bug).

### Backend write path (task 2)

- `CreatePanelRequest` and `UpdatePanelRequest` and `PanelBatchItem`
  collapsed to `{ ..., type?, config? }` with `config` carried as a raw
  `JsValue` and resolved at the service layer.
- Per-subtype `*Config.Patch` decoders under
  `backend/src/main/scala/com/helio/domain/panels/*Panel.scala` preserve
  absent-vs-null per field (`Option[Option[_]]` for binding fields,
  divider weight/color; `Option[String]` with `JsNull` → default for
  content / orientation / imageFit).
- `PanelConfigCodec.applyConfigPatch(existing, json)` is the single
  point that pattern-matches the stored `Panel` and applies the matching
  `Patch.decode` → `applyPatch` chain.
- `PanelService.resolvePatch` enforces the cross-type 400 lock by
  comparing `request.type` to `existing.kind` (regression test in
  ApiRoutesSpec).
- `PanelService.batchUpdate` enforces the cross-type lock per entry and
  routes typed `config` patches through `PanelRepository.batchUpdate`,
  which uses `PanelConfigCodec.applyConfigPatch` per row inside the
  transaction.
- `PanelPatchApplier` rewritten — old steps (binding / image / divider /
  content) all collapse into one `applyConfig` step.
- `PanelRepository.replace(panel, lastUpdated)` is the new write
  primitive used after typed-config application; it writes every
  config column derived from `domainToRow(panel)` in one statement.

### Backend snapshot import / export

- Importer rejects prior versions with a 400 + descriptive message
  ("snapshot version N is no longer supported (current version: 2); please
  re-export …"); reused by both the route and the unit-spec.
- Importer reconstructs each panel's typed config via
  `PanelConfigCodec.decodeCreateConfig` (tolerant — `{}` falls back to
  per-subtype defaults), then builds the domain `Panel` and persists
  through `PanelRowMapper.domainToRow`. The pre-CS2c-3c "flat entry
  fields → row columns" path is gone.

### Schemas (task 3)

- `schemas/panel.schema.json` — gained `$defs` for `MetricConfig`,
  `ChartConfig`, `TableConfig`, `TextConfig`, `MarkdownConfig`,
  `ImageConfig`, `DividerConfig` plus a top-level `oneOf` over `type`.
  `additionalProperties: false` on every config sub-schema.
- `schemas/create-panel-request.schema.json` — `allOf` + `if/then` to
  select the right `$ref` based on the `type` discriminator.
- `schemas/update-panels-batch-request.schema.json` — entry shape gains
  optional `config: { type: "object" }`.
- `schemas/update-panels-batch-response.schema.json` — unchanged; already
  references `panel.schema.json` so it inherits the new shape.

### Tests (tasks 6.1–6.5 covered by `ApiRoutesSpec` + ScalaTest)

- `decode("{}")` defaults are covered by the existing per-subtype unit
  spec (`PanelSpec`) and by the route-level "POST … type: markdown with
  no content" cases.
- PATCH absent-vs-null per config field is covered by the (rewritten)
  "PATCH /api/panels/:id updating divider fields" and "unbind a data
  type from a panel by setting typeId to null" cases.
- Cross-type PATCH 400 lock is exercised by the route tests.
- Snapshot export → import round-trip preserving Image / Divider fields
  is covered structurally by the new
  `DashboardSnapshotValidationSpec` + route export/import tests; an
  explicit "export Image + Divider → import → values match" case is
  TODO for cycle 2 alongside the frontend work (the lone gap from
  task 6.4).
- Prior-version snapshot rejection is covered by the unit spec.

## Scope DEFERRED — BLOCKER

### Frontend lockstep (tasks 4 + 5 + 6.6–6.8)

I attempted the frontend wire migration and stopped after `tsc --noEmit`
surfaced >40 errors across `PanelDetailModal.tsx` (18), `PanelGrid.tsx`,
`panelsSlice.ts`, `panelService.ts`, `useLegacyBoundPanel.ts`,
`usePanelData.ts`, `DataSourceList.tsx`, plus ~25 test files. The model-
side change alone (introducing the `Panel` discriminated union in
`types/panel.ts` and re-exporting from `models.ts`) is sound, but every
consumer of flat fields (`panel.typeId`, `panel.content`,
`panel.imageUrl`, `panel.dividerOrientation`, etc.) needs to migrate to
narrowing — and design D4 mandates extracting per-subtype editor /
renderer files BEFORE wiring dispatch because `PanelDetailModal.tsx`
(1021L), `PanelGrid.tsx` (597L), `panelsSlice.ts` (439L), and
`models.ts` (587L) are all over the 400-line BLOCKER cap.

The realistic surface in cycle 1:

1. 4 extractions (D4) — 14 new files (7 editors + 7 renderers) plus
   `panelNarrowing.ts` + `panelPayloads.ts` + `types/panel.ts`.
2. Migration of ~40 flat-field references across ~9 source files.
3. Migration of ~50+ test-file uses (every test that constructs a
   `Panel` literal).
4. New Jest cases for narrowing helpers + thunk payload builders
   (tasks 6.6 + 6.7).
5. Playwright Phase 3 smoke (task 6.8) — outside the worktree's
   pre-commit hook surface.

That is a 1500–2000-line diff on top of the ~900-line backend +
schemas diff already shipped. Per the escalation policy in ticket.md
and the planner's pre-cycle Flag 1 warning, I am surfacing this as a
**BLOCKER for a split decision** rather than pushing partial frontend
work.

### Proposed split

**This PR (cycle-1 scope as committed):** backend wire shape collapse +
JSON Schemas + snapshot version bump + Image/Divider data-loss bug fix.
Self-contained, all 591 backend tests green, no schema drift, no inline
FQN violations, file sizes all under cap.

**Follow-up PR (cycle-2 / new sub-PR):** frontend lockstep — extractions
first (D4), then `Panel` discriminated union, then consumer migrations,
then Playwright smoke. Sized around the same as the backend cycle on its
own; tractable as a focused PR with its own evaluator pass.

The downside: this PR's backend ships a wire shape the frontend cannot
consume (every `panel.typeId` read, etc. yields `undefined`). The
frontend will appear broken in dev until the follow-up lands. This is
inherent to any split that doesn't ship both halves together — the only
alternative is a wider cycle window for the executor + evaluator to do
the full lockstep in one go.

## Gates run

| Gate                                       | Result |
| ------------------------------------------ | ------ |
| `sbt test` (backend)                       | 591/591 pass |
| `npm run lint`                             | clean (zero warnings) |
| `npm run format:check`                     | clean (after `prettier --write` on `schemas/panel.schema.json`) |
| `npm run check:schemas`                    | 6/6 in sync |
| `npm run check:openspec`                   | clean |
| `npm run check:scala-quality`              | clean (18 informational soft-budget warnings on pre-existing files) |
| `npm test` (frontend)                      | 664/664 pass (frontend unchanged on this branch) |
| `npm run build` (frontend)                 | green |
| `openspec validate panel-wire-frontend-lockstep` | valid |

## File sizes (after this cycle)

| File                                                         | Lines |
| ------------------------------------------------------------ | ----- |
| `backend/.../api/protocols/PanelProtocol.scala`              | 217   |
| `backend/.../api/protocols/DashboardProtocol.scala`          | 195   |
| `backend/.../services/PanelService.scala`                    | 313   |
| `backend/.../services/PanelPatchApplier.scala`               | 73    |
| `backend/.../domain/panels/PanelConfigCodec.scala`           | 90    |
| `backend/.../domain/panels/MetricPanel.scala`                | 124   |
| `backend/.../domain/panels/ChartPanel.scala`                 | 112   |
| `backend/.../domain/panels/TablePanel.scala`                 | 111   |
| `backend/.../domain/panels/TextPanel.scala`                  | 80    |
| `backend/.../domain/panels/MarkdownPanel.scala`              | 79    |
| `backend/.../domain/panels/ImagePanel.scala`                 | 104   |
| `backend/.../domain/panels/DividerPanel.scala`               | 127   |
| `backend/.../infrastructure/PanelRepository.scala`           | 227   |
| `backend/.../infrastructure/DashboardRepository.scala`       | 281   |

`PanelService.scala` is 13 lines over the 300L soft cap but well under
the 400L hard cap — extracting per-subtype create / update helpers per
design D6 is a viable cycle-2 follow-up if the evaluator wants it; the
rest of the file is mostly the public service surface, not per-subtype
dispatch. The dispatch surface that exists (`buildNewPanel`) is small
and grouped.

## Tolerance-rule edge cases worth flagging to the evaluator

1. **`MetricPanelConfig.Patch.decode({ "dataTypeId": null })`** yields
   `Patch(Some(None), None)` → `applyPatch` clears `dataTypeId` to
   `DataTypeId("")` (the empty-string convention). On read the response
   emits `config.dataTypeId: ""`. The test that previously asserted
   `response.typeId shouldBe None` now asserts
   `config("dataTypeId") shouldBe JsString("")` — verify that's the
   contract the evaluator wants. Alternative: keep the legacy `None`
   serialization by encoding empty strings as `null` on the wire; I did
   not do that because it diverges from the typed-config shape used by
   CS2c-2 / CS2c-3a.

2. **DividerPanelConfig.Patch.decode validates `orientation` against the
   allow-list at decode time** — surfaces 400 rather than 500 for
   `"diagonal"`. I added a `recover` on `PanelService.update` to map
   `IllegalArgumentException` from `applyConfigPatch` to a
   `BadRequest`. The recover catches anything subsequent; if a future
   service-layer exception should not become a 400, we'll need to
   narrow the catch.

3. **Snapshot import rejects version != CurrentVersion** — not just
   `< 1`. The error message is descriptive enough to drive an "upgrade
   your snapshot" UX. The test for this is in
   `DashboardSnapshotValidationSpec` ("reject a prior wire version").

4. **`PanelRepository.replace` writes every config column from
   `domainToRow(panel)` in one statement** — this means a partial
   `Patch` that only touches `dataTypeId` still rewrites `fieldMapping`
   (to its current value, because `applyPatch` reconstitutes the typed
   `Config`). Correct semantically; worth noting if a future audit
   trail wants column-level diffs.

5. **PanelPatchApplier no longer dispatches `applyType`** — the cross-
   type 400 lock means `request.type` is always either absent or equal
   to the stored kind, so the row's `type` column never changes through
   PATCH. The applier is shorter and clearer for it.

## Acceptance-criteria nuance for the evaluator

- AC #6 (all gates) passes for the scope I shipped. Cycle 2 will
  re-verify after frontend changes land.
- AC #7 (Playwright Phase 3 smoke) is outside cycle 1 by escalation —
  the frontend isn't migrated. Cycle 2.

## Commits

1. `c61aca5` — `HEL-236 CS2c-3c cycle 1: OpenSpec change folder`
2. `54adf07` — `HEL-236 CS2c-3c cycle 1: Backend wire shape collapse to type + typed config`
3. `75b55a3` — `HEL-236 CS2c-3c cycle 1: JSON Schemas evolved in-place to discriminated wire`

(plus a follow-up commit for this report + files-modified.md)
