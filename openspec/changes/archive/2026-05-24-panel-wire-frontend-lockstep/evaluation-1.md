# Evaluation Report — Cycle 2 (HEL-236 CS2c-3c)

Evaluator independently verified cycle-1 (backend wire + schemas, separate executor session)
and cycle-2 (frontend lockstep) shipped on branch `task/panel-wire-frontend/HEL-236`.

## Verdict

**PASS** — all acceptance criteria met, all gates green, Phase 3 smoke clean.
Ready for PR. No change requests; one minor non-blocking observation.

## Phase 1 — Spec Review: PASS

All ticket-acceptance criteria verified:

1. AC1 — `PanelResponse.fromDomain` emits discriminated wire — verified live
   via `/api/dashboards/:id/panels`: every panel root has `{ id, dashboardId,
   title, type, meta, appearance, ownerId, config }`; no flat `typeId` /
   `content` / `imageUrl` / `dividerOrientation` leaks. `PanelConfigCodec`
   centralises encode/decode/patch dispatch in one file.
2. AC2 — Snapshot version bumped to **2**; Image / Divider data-loss bug
   closed (live test export → import preserves `{imageFit, imageUrl}` and
   `{color, orientation, weight}` byte-for-byte).
3. AC3 — Frontend `Panel` is a discriminated union over 7 subtypes; ~21
   consumer sites all migrated via narrowing helpers
   (`getDataTypeId`/`getFieldMapping`/…) in `panelNarrowing.ts`.
4. AC4 — `schemas/panel.schema.json`, `create-panel-request.schema.json`,
   `update-panels-batch-request.schema.json` all evolved in place to
   discriminated-union shape (verified by `npm run check:schemas` →
   6/6 in sync).
5. AC5 — Snapshot wire break versioned; prior-version (`1`) snapshot
   rejected at the importer with HTTP 400 and descriptive message
   ("snapshot version 1 is no longer supported (current version: 2);
   please re-export the dashboard from the current app version").
6. AC6 — All gates pass; file-size budgets enforced (no over-cap files
   introduced; four previously-over-cap files all now < 400L).
7. AC7 — Playwright smoke green (see Phase 3).

All `tasks.md` items marked `[x]` (62 of 63; the 63rd, 6.8, is the
evaluator-scope Playwright smoke executed here). No scope creep observed:
three drive-by extractions (`models.ts` → `panel.ts` / `dataSource.ts` /
`pipelineStep.ts`) are justified as the only path to bringing models.ts
under the 400L hard cap that the spec D4 mandates.

OpenSpec artifacts validate (`openspec validate panel-wire-frontend-lockstep` →
"Change 'panel-wire-frontend-lockstep' is valid").

## Phase 2 — Code Review: PASS

### Static gates (re-run independently)

| Gate | Result |
| --- | --- |
| `sbt test` (backend) | **591/591 pass** in 28s |
| `npm run lint` | **clean** (zero warnings) |
| `npm run format:check` | **clean** |
| `npm test` (frontend Jest) | **664/664 pass** in 5.7s |
| `npm run build` (frontend) | **green** (Vite production build) |
| `npm run check:schemas` | **6/6 in sync** |
| `npm run check:openspec` | **clean** |
| `npm run check:scala-quality` | clean (18 pre-existing soft-budget warnings) |
| `openspec validate panel-wire-frontend-lockstep` | **valid** |

### File-size budgets

All previously-over-cap files now under the 400L hard cap. Verified
independently with `wc -l`:

| File | Cycle-1 baseline | Cycle-2 final | Status |
| --- | --- | --- | --- |
| `frontend/src/components/PanelDetailModal.tsx` | 1021 | 390 | PASS (under 400) |
| `frontend/src/components/PanelGrid.tsx` | 597 | 363 | PASS |
| `frontend/src/types/models.ts` | 587 | 367 | PASS |
| `frontend/src/features/panels/panelsSlice.ts` | 439 | 241 | PASS |
| `frontend/src/components/PanelContent.tsx` | 290 | 107 | PASS |

New files over the 250L soft cap (no hard-cap violations):

| File | Lines | Note |
| --- | --- | --- |
| `frontend/src/features/panels/panelThunks.ts` | 256 | Dense thunk boilerplate; per-domain split would fragment surface |
| `frontend/src/components/panels/editors/BindingEditor.tsx` | 234 | Shared metric/chart/table binding editor |
| `frontend/src/components/panels/editors/ChartAppearanceEditor.tsx` | 217 | Chart-specific appearance subsection |
| `frontend/src/types/pipelineStep.ts` | 216 | Pre-existing ADT extracted to bring models.ts under cap |
| `frontend/src/hooks/usePanelGridSave.ts` | 181 | Auto-save + flush pipeline |

Backend: `PanelService.scala` is 313L (13L over 300L soft cap, well
under 400L hard). Surface is mostly the public service surface, not
per-subtype dispatch — split would not improve readability.

### No-inline-FQN check

Diff scan for blocked prefixes in the `+` lines of `backend/src/**/*.scala`
(excluding `package` and `import` lines): clean. Pre-commit hook is the
authoritative gate and passed on every cycle-2 commit.

### Codec tolerance regression gate

Verified directly in `backend/src/test/scala/com/helio/domain/PanelSpec.scala`
lines 143–149:

```
MetricPanelConfig.decode(JsObject.empty)   shouldBe MetricPanelConfig.Empty
ChartPanelConfig.decode(JsObject.empty)    shouldBe ChartPanelConfig.Empty
TablePanelConfig.decode(JsObject.empty)    shouldBe TablePanelConfig.Empty
TextPanelConfig.decode(JsObject.empty)     shouldBe TextPanelConfig.Empty
MarkdownPanelConfig.decode(JsObject.empty) shouldBe MarkdownPanelConfig.Empty
ImagePanelConfig.decode(JsObject.empty)    shouldBe ImagePanelConfig.Empty
DividerPanelConfig.decode(JsObject.empty)  shouldBe DividerPanelConfig.Empty
```

All seven subtypes' decoder returns `Empty` (default) on `{}` — the codec
read-path tolerance rule from CS2c-2/3a/3b is preserved. Repo round-trip
test for partial configs is part of the 591 backend tests that pass.

### Code quality spot-check

- **`PanelConfigCodec`** (90L): clean single-point dispatcher between wire
  `(type, config: JsValue)` and typed ADT. Three methods (`encodeConfig`,
  `decodeCreateConfig`, `applyConfigPatch`) each pattern-match on the
  seven-subtype Registry — exhaustiveness is enforced via `case other =>
  deserializationError` defaults. Tight, no dead code, no over-engineering.
- **`PanelService.resolvePatch`** (228–252): cross-type 400 lock enforced
  before patch dispatch; `panelTypeOpt` validation precedes the type-mismatch
  check; `at least one field is required` for empty patches. Clean monadic
  for-comprehension; no inline FQNs.
- **`panelNarrowing.ts`** (102L): tight; the `""` → `null` accessor
  boundary collapse is well-documented in module header and accessor
  comments. `isBoundCapablePanel` predicate centralises the metric/chart/table
  trio. Read-only by design.
- **`usePanelData.ts`**: cache-key shape `panelId|typeId|fieldMappingKey`
  PRESERVED via `getDataTypeId(panel)` + `getFieldMapping(panel)`. HEL-242
  non-regression hypothesis holds — `""` accessor collapse means an unbound
  bound-capable panel still produces a `null` cache key (same as pre-CS2c-3c
  behaviour, no fetch attempted).
- **`useLegacyBoundPanel`** preserved per CS3 cleanup guard — only internal
  change is `panel.typeId` → `getDataTypeId(panel)`.
- **`panel.ts`** discriminated union mirrors backend shape exactly;
  `refreshInterval` is documented as frontend-only and dropped at the
  network boundary in `panelService.updatePanelBinding`.
- **Extracted editors and renderers**: each one is tight and narrowed
  on its subtype; props collapsed to `{ panel, ... }` for renderers
  and `{ panel, onDirtyChange, ref }` for editors.

No `any` introductions, no dead code, no leftover TODO/FIXME, no
unnecessary duplication.

## Phase 3 — UI Review (Playwright): PASS

Backend started on port 8316 with `CORS_ALLOWED_ORIGINS=http://localhost:5409`;
frontend started on port 5409 with `BACKEND_PORT=8316`. Logged in as
matt@helio.dev / heliodev123 successfully.

### 1. Panel CRUD round-trip for all 7 subtypes — PASS

Created → typed-PATCH edited → reloaded for each of:

| Subtype | Create | PATCH | Reload preserves edit |
| --- | --- | --- | --- |
| metric | 201 | 200 | YES — dataTypeId + fieldMapping |
| chart | 201 | 200 | YES |
| table | 201 | 200 | YES |
| text | 201 | 200 | YES — `content` |
| markdown | 201 | 200 | YES — `content` |
| image | 201 | 200 | YES — `imageUrl` + `imageFit` |
| divider | 201 | 200 | YES — `orientation` + `weight` + `color` |

Defaults from empty `config: {}` create-side payload: metric/chart/table get
`{ dataTypeId: "", fieldMapping: {} }`. Codec tolerance rule live-confirmed.

### 2. Dashboard snapshot export → import round-trip — PASS

Created image + divider panels with non-default config. Exported via
`/api/dashboards/:id/export` → received snapshot with `version: 2`.
Snapshot panels carry full typed `config` (no data loss):

- image entry: `config: { imageFit: "cover", imageUrl: "https://test/snap.png" }`
- divider entry: `config: { color: "#abcdef", orientation: "vertical", weight: 5 }`

POSTed snapshot back to `/api/dashboards/import` → received 201 with a new
dashboard and the panels reconstructed. Image and divider panels in the
imported dashboard preserve their full config bit-for-bit. **Image / Divider
data-loss bug fixed.**

### 3. Prior-version snapshot rejection — PASS

Set `snap.version = 1` and POSTed to `/api/dashboards/import`. Response:
**HTTP 400** with message:

> "snapshot version 1 is no longer supported (current version: 2); please
> re-export the dashboard from the current app version"

Descriptive and actionable.

### 4. Cross-type PATCH 400 lock — PASS

PATCHed a metric panel with `{ type: "chart", config: { … } }`. Response:
**HTTP 400** with message:

> "cannot change panel type: stored type is 'metric', request type is 'chart'"

Lock preserved from CS2c-3b.

### 5. HEL-242 non-regression — PASS (no regression introduced)

The "Trend Overview" chart panel (bound to a populated DataType) renders a
live ECharts canvas in the dashboard. Verified DOM contains `<canvas>` and
no "No data available" placeholder for that panel.

The three metric panels showing "No data available" are bound to DataTypes
that have no rows for this user — pre-existing state matching the HEL-242
P0 bug surface, NOT a regression from CS2c-3c. The cache-key shape in
`usePanelData.ts` is preserved (`panelId|typeId|fieldMappingKey`) and the
`""` → `null` accessor collapse keeps unbound bound-capable panels producing
a `null` cache key (same as pre-CS2c-3c flat-field behaviour).

### 6. Per-subtype editor dispatch — PASS

Clicked the Trend Overview chart panel → modal opened → clicked "Edit" →
the dispatched chart editor mounted with all expected sections:

- AppearanceEditor (Title, Background, Text colour, Transparency)
- ChartAppearanceEditor (Show legend, Legend position, Tooltip, axis-label
  toggles, chart-type icons Bar/Line/Pie/Scatter)
- BindingEditor (X Axis / Y Axis / Series field mappings, Refresh interval)
- Cancel / Save action buttons

Per-subtype dispatch confirmed working in the live UI.

### Console errors

Zero unexpected console errors. The only error captured during the live
session was `ERR_NAME_NOT_RESOLVED https://test/snap.png` — an intentional
placeholder URL from my evaluator-injected test image panel. The "401",
"404", and "400" entries in the per-page console all trace to my injected
test fetches (unauth probe, cross-type PATCH, prior-version snapshot) and
match the expected error-path 400 responses verified above.

### Wire shape spot-check

Live response from `/api/dashboards/:id/panels` confirms:

- root keys: `appearance, config, dashboardId, id, meta, ownerId, title, type`
- no flat `typeId`, `content`, `imageUrl`, `dividerOrientation` etc.
- per-subtype config keys (e.g. metric: `dataTypeId, fieldMapping`; image:
  `imageFit, imageUrl`; divider: `color, orientation, weight`)

Discriminated wire shape fully delivered.

## Non-blocking Observations (no FAIL impact, useful for follow-up)

1. **`PanelService.scala` 13L over 300L soft cap** — not blocking, well
   under 400L hard. Per design D6 the per-subtype helper extraction is a
   viable spinoff if a future cycle wants to tighten budgets. Executor
   chose not to and the choice is reasonable (most of the file is the
   public service surface, not per-subtype dispatch).
2. **`refreshInterval` is a phantom field** — the frontend `Panel` union
   has `refreshInterval?: number | null` for `usePanelPolling`, but
   `panelService.updatePanelBinding` drops it at the network boundary
   (no backend schema or column). Documented in `panel.ts` with a CS3
   cleanup comment. Clean as-is, but the field's persistence story is
   confusing for a new contributor.
3. **HEL-242 still unresolved** — the three "No data available" metric
   panels on the eval dashboard are the same surface as the deferred
   P0 bug. CS2c-3c is verified non-regressive but the underlying issue
   remains for HEL-242's owner to fix in its own ticket.
4. **`PanelConfigCodec` exhaustiveness defaults to `deserializationError`** —
   on the rare future case of a new subtype being added without updating
   the codec dispatcher, the failure mode is a 500 (deserialization)
   rather than a compile error. Acceptable trade-off for the
   pattern-match-on-sealed-trait style used here; could be tightened
   with `@unchecked` annotation pattern if desired. Not blocking.

## Recommendation to orchestrator-relay

**Ready to open PR**. No change requests; no spinoffs blocking merge.

Suggested PR title: `HEL-236 CS2c-3c: Panel discriminated wire + frontend lockstep`

The PR should be opened against `main` with a thorough description noting:
- BREAKING: Panel wire shape (read + write) collapsed to `{ type, config }`
- BREAKING: Snapshot version bumped to 2; prior versions rejected at import
- Image / Divider snapshot data-loss bug closed
- Frontend `Panel` discriminated union over 7 subtypes
- File-size BLOCKER triage: 4 previously-over-cap files now under 400L
- HEL-236 chain complete (CS1, CS2a, CS2b, CS2c-1, CS2c-2, CS2c-3a, CS2c-3b, CS2c-3c)
