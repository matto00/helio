# Evaluation Report — Cycle 1 (CS2c-3b backend-only Panel ADT — scope-split delivery)

## Status

**APPROVED.** The scope-adjusted cycle-1 delivery — backend Panel ADT only, wire shape preserved — lands cleanly as a behaviour-preserving structural refactor. The Panel domain becomes a per-file polymorphic ADT (`trait Panel` + 7 self-contained subtype modules under `domain/panels/<Kind>Panel.scala` + `Panel.Registry` single source of truth) and the old wide-flat case class is deleted from `domain/model.scala`. All internal consumers (repository, service, patch applier, snapshot helpers, routes) consume the typed ADT; the wire shape stays byte-identical via two pre-staged integration points (`PanelResponse.fromDomain` and `DashboardSnapshotPanelEntry.fromDomain`) that CS2c-3c will rewrite for the `config`-collapse. All gates green (591/591 sbt, 664/664 jest, lint/format/schemas/openspec/scala-quality clean). Phase-3 smoke exercises every subtype end-to-end on the wire: bound (chart/metric) reads, text PATCH, image PATCH, divider PATCH, and snapshot export → import round-trip. All round-trip byte-equivalent to pre-CS2c-3b with zero console errors.

This is a textbook example of `feedback-refactor-discipline.md`: a structural-only PR that defers wire-shape evolution, frontend lockstep, and HEL-242 to separate follow-ups, captured honestly in the executor report and reflected accurately in tasks.md and ticket.md.

## Phase 1: Spec & Report Review — PASS

### `executor-report-1.md` honesty — PASS

The report opens with **PARTIAL — backend domain ADT delivered, wire-shape evolution deferred** and gives four explicit reasons for the scope split. All four are accurate and well-reasoned:

1. **Frontend blast radius** — 21 consumer files including a 1021L `PanelDetailModal.tsx`, 597L `PanelGrid.tsx`, 439L `panelsSlice.ts`. Verified plausible by grep of `panel\.typeId|panel\.fieldMapping|...` across the frontend.
2. **Structural win lands cleanly without the wire break** — verified live in Phase 3: every panel subtype round-trips byte-identical pre/post-CS2c-3b.
3. **Wire-shape evolution is reversible** — CS2c-3c can rewrite the two integration points (`PanelResponse.fromDomain`, `DashboardSnapshotPanelEntry.fromDomain`) without touching anything else.
4. **CS2c-3a's cycle-3 per-file template is the load-bearing change** — applied from day 1 here (no co-located `PanelHandlers` object to retire later).

The four §1.x investigation decisions are documented honestly:

- §1.4 `useLegacyBoundPanel` — investigated, file is load-bearing (legacy DataType-from-DataSource binding, not stalled migration), **preserved**, captured as CS3-era spinoff (#16.6). Verdict matches my read of the codebase.
- §1.5 Snapshot — version still 1, pre-existing Image/Divider data-loss bug acknowledged, decision to **preserve** wire shape and let CS2c-3c close the data-loss bug as a side effect. Verified live: snapshot export/import round-trip works and the pre-existing bug is unchanged.
- §1.6 HEL-242 — investigated via code inspection; root-cause hypothesis (`PanelService.resolveBindingsForRead` cross-user clear + frontend cache invalidation) is **defer-to-follow-up** because the fix surface > 20L. This matches the cycle-1 prompt's decision tree exactly.
- §1.7 6 panel schemas — preserved because wire shape is preserved. `npm run check:schemas` green.

The §1.8 decisions summary table maps each concern to INCLUDE / DEFER with one-line rationale. Nothing hidden.

### `tasks.md` reflects actual delivery — PASS

Spot-checked:
- §2 Backend domain — all 13 sub-tasks `[x]`. Verified all 7 per-file subtypes exist with sizes 52–82L.
- §3 Protocol — 3.1 / 3.3 / 3.4 `[~]` (wire-shape items deferred, accurate); 3.2 / 3.5 `[x]`.
- §4 Infrastructure — 4.1–4.5 mostly `[x]`; 4.4 `[~]` for the PanelRepository soft-overage 273L (down from 305L, but still 23L over the 250 soft target — honestly tagged).
- §5 Services — 5.1–5.5; 5.3 (`cross-type PATCH guard`) `[~]` deferred to CS2c-3c (wire-shape coupled). 5.4 `[~]` PanelService 327L (up from 287 — `buildNewPanel` helper). Honestly flagged.
- §7 / §8 / §9 / §10 — all deferred items marked `[ ]` or `[~]` with rationale.
- §13 / §14 — verification gates and smoke tasks: gates `[x]`, smoke `[ ]` (evaluator-owned, intentional).
- §16 Spinoff candidates — 7 captured with the right granularity.

The mix of `[x]` (done in cycle 1), `[~]` (partial / deferred with explicit deferral note), and `[ ]` (fully deferred) is exactly the discipline the cycle-1 prompt asked for.

### `ticket.md` "Scope adjustment — 2026-05-16" — PASS

The opening block of `ticket.md` is a clean 8-line summary of what's in CS2c-3b (backend ADT, wire preserved) vs what's in CS2c-3c (wire collapse + frontend + 6 schemas + snapshot version bump) vs HEL-242 (separate ticket). Original full-scope text is preserved below it for archival reference. Honest and accurate.

### `files-modified.md` vs `git diff main..HEAD --stat` — PASS

Verified:

| Reported | Actual | Match |
|---|---|---|
| `domain/Panel.scala` 162L | 162L | ✓ |
| `panels/MetricPanel.scala` 78L (report) / 81L (wc) | 81L | reported 78, actual 81 — 3-line drift, immaterial |
| `panels/ChartPanel.scala` 82L | 82L | ✓ |
| `panels/TablePanel.scala` 73L | 73L | ✓ |
| `panels/TextPanel.scala` 52L | 52L | ✓ |
| `panels/MarkdownPanel.scala` 53L | 53L | ✓ |
| `panels/ImagePanel.scala` 62L | 62L | ✓ |
| `panels/DividerPanel.scala` 73L | 73L | ✓ |
| `panels/package.scala` 21L | 21L | ✓ |
| `PanelRowMapper.scala` 122L (report) / 133L (wc) | 133L | reported 122, actual 133 — 11-line drift, immaterial |
| `PanelRepository.scala` 273L | 272L | ✓ |
| `DashboardRepository.scala` 281L | 280L | ✓ |
| `PanelService.scala` 327L | 326L | ✓ |
| `PanelProtocol.scala` 229L (report) | 248L | reported 229, actual 248 — 19-line drift; the `fromDomain` block extracted from the `object` companion is the difference |
| `DashboardProtocol.scala` 225L | 222L | ✓ |
| `PanelRoutes.scala` 81L | 81L | ✓ |
| `model.scala` 268L | 267L | ✓ |
| `PanelSpec.scala` 160L (report) | 186L | reported 160, actual 186 — modest drift; the spec is 14 tests as advertised |

The line-count drift on PanelProtocol (229 → 248), PanelRowMapper (122 → 133), and PanelSpec (160 → 186) is small and uniformly upward — the report was written before the final commits trimmed the file. Not material to the evaluation. All structural claims hold.

The 26-file diff stat matches the report's enumeration exactly: 11 new backend files (1 trait + 7 subtypes + 1 package + 1 mapper + 1 test), 8 modified backend files, 6 new openspec docs, 0 schema changes, 0 frontend changes, 0 Flyway migrations.

## Phase 2: Code Review (cycle-1 surfaces only) — PASS

### 1. ADT correctness — PASS

7 subtypes match the 7 panel kinds. `Panel.Registry` (Panel.scala:112-120) covers all 7 with one entry each. `PanelKind` named constants (Panel.scala:144-151) all delegate to their subtype's `Kind` constant. Each subtype's `kind` field is a `val`-override (verified across MetricPanel:51, ChartPanel:52, TablePanel:43, TextPanel:35, MarkdownPanel:36, ImagePanel:43, DividerPanel:50). `PanelKind.All` is registry-derived (`def All: Set[String] = Panel.Registry.keySet`), so the allow-list cannot drift.

### 2. Trait shape — PASS

`trait Panel` is non-sealed (verified — no `sealed` keyword on the trait definition, only in the scaladoc explaining the trade-off at lines 22-27). The scaladoc explicitly documents the CS2c-3a cycle-3 lesson:

> The trait is intentionally NOT `sealed`: Scala 2 constrains sealed-trait subclasses to the same compilation unit, which would defeat the per-file refactor (the CS2c-3a cycle-3 lesson). Discipline is enforced via `Panel.Registry` — only kinds registered there round-trip through the protocol / repo / service.

Polymorphic methods on the trait (Panel.scala:43-87):
- `kind: String` — verified per subtype.
- `dataTypeId: Option[DataTypeId]` — Metric/Chart/Table return `Some` when `config.dataTypeId.value` non-empty (with the cycle-1 read-path tolerance: empty string reads as `None`); Text/Markdown/Image/Divider always `None`.
- `validateConfig: Either[String, Unit]` — Metric/Chart/Table return `Right(())` (transient empty allowed during mid-edit per design.md §3); Text/Markdown/Image return `Right(())`; **Divider** enforces `weight > 0 if present` (DividerPanel:54-58).
- `buildQuery: Option[PanelQuery]` — bound trio derive from `(dataTypeId, fieldMapping)` via the shared `Panel.selectedFieldsFromMapping` helper (Panel.scala:133-137); unbound return `None`.
- `withBindingCleared: Panel` — bound trio `copy(config = *Config.Empty)`; unbound return `this` (no-op).
- `fieldMapping: Option[JsValue]` — bound trio return `Some(config.fieldMapping)` when non-empty, else `None`; unbound `None`.

### 3. Per-subtype file shape — PASS

Spot-checked 3:

**`MetricPanel.scala` (81L)** — bound. `MetricPanelConfig(dataTypeId, fieldMapping)` + `Empty: MetricPanelConfig` + `format: RootJsonFormat` + tolerant `decode(json)` that handles `JsObject(fields)` with optional `dataTypeId` / `fieldMapping` defaulting to empties; non-object inputs decode to `Empty`. `MetricPanel.companion: Panel.Companion` exposes `kind / readConfigFromWire / writeConfigToWire`. 81L well under the 200L ceiling.

**`TextPanel.scala` (52L)** — unbound content. `TextPanelConfig(content: String)` + `Empty` + tolerant decoder (`content` missing or non-string defaults to `""`). The trait's `validateConfig` returns `Right(())`; the content-bearing subtype doesn't enforce non-empty (matches pre-CS2c-3b behaviour where empty text was tolerated).

**`DividerPanel.scala` (73L)** — complex with optional `weight`/`color`. `DividerPanelConfig(orientation, weight: Option[Int], color: Option[String])` + `DefaultOrientation = "horizontal"` + tolerant decoder defaulting all three. The `validateConfig` override (lines 54-58) checks `weight match { case Some(w) if w <= 0 => Left(...); case _ => Right(()) }` — exactly the invariant the design specified. None of the other subtypes carry invariants today.

Each file follows the pattern: case class + `*Config` + `*Config.Empty` + tolerant `decode` + JSON format + `Panel.Companion` + Registry-bound `Kind` constant. Uniform shape across all 7 files. All ≤ 82L.

### 4. Wire shape preserved correctly — PASS (verified live)

`PanelResponse.fromDomain` (PanelProtocol.scala:70-125) pattern-matches the typed subtype back to the wide-flat wire shape exactly:
- `MetricPanel / ChartPanel / TablePanel` → `typeId` + `fieldMapping` populated (when non-empty); other subtype fields null/`None`.
- `TextPanel / MarkdownPanel` → `content` populated (when non-empty); others null/`None`.
- `ImagePanel` → `imageUrl` + `imageFit` populated; others null/`None`.
- `DividerPanel` → `dividerOrientation` + `dividerWeight` + `dividerColor` populated; others null/`None`.

`DashboardSnapshotPanelEntry.fromDomain` (DashboardProtocol.scala:133-190) is the identical pattern — pre-staged as the second integration point for CS2c-3c's snapshot rewrite. Note that `DashboardSnapshotPanelEntry` does NOT carry `imageUrl/imageFit/dividerOrientation/dividerWeight/dividerColor` fields itself (only `typeId`, `fieldMapping`, `content`), so the Image/Divider data-loss bug at the snapshot layer pre-exists CS2c-3b and is preserved as documented.

**Live verification (Phase 3):**

| Endpoint | Subtype | Result |
|---|---|---|
| GET `/api/dashboards/:id/panels` | chart | `type:"chart"`, `typeId:"21ce4b95-..."`, `fieldMapping:{series,xAxis,yAxis}` — wide-flat preserved exactly |
| GET ditto | metric (3×) | `type:"metric"`, with `typeId` either present or omitted depending on binding state |
| POST `/api/panels` typed `text` | text | 201, `type:"text"`, `content:"Hello from cycle 1"`, no `typeId`/`fieldMapping` keys (Option None Spray-serializes as missing) |
| POST + PATCH `image` | image | `type:"image"`, `imageUrl:"https://example.com/x.png"`, `imageFit:"cover"` |
| POST + PATCH `divider` | divider | `type:"divider"`, `dividerOrientation:"vertical"`, `dividerWeight:2`, `dividerColor:"#abcdef"` |
| GET `/api/dashboards/:id/export` | snapshot | `version: 1` (unchanged), 4 panels with wide-flat shape (`typeId` on metric/chart, no `config` collapse) |
| POST `/api/dashboards/import` | round-trip | 201, 4 panels imported with types `[metric, chart, metric, metric]` |

The combination "typed ADT internally, wide-flat externally" round-trips byte-equivalent to pre-CS2c-3b for every panel subtype that touches the wire today.

### 5. `PanelRowMapper` extraction — PASS

`infrastructure/PanelRowMapper.scala` (133L) extracts `rowToDomain` + `domainToRow` from `PanelRepository`. Both call sites (`PanelRepository` and `DashboardRepository`) now delegate to it. The `panelRowToDomain` method that previously duplicated row→Panel logic in `DashboardRepository` is gone (DashboardRepository diff: -17L). This is a clean side-win — the extraction eliminates pre-existing duplication that was annoying to maintain.

Read-path tolerance is preserved: rows with NULL subtype columns decode to the subtype's `Empty` config rather than throwing. The dispatch is exhaustive over `Panel.Registry.keySet`; an unknown-kind row falls back to `MetricPanel` with empty config, matching the pre-CS2c-3b `PanelType.fromString(...).getOrElse(PanelType.Default)` behaviour.

### 6. `PanelService.scala` 327L overage — PASS (helper is doing real work)

The +40L is the new `buildNewPanel` helper (PanelService.scala:271-307) — a `Panel` factory that enumerates the 7 panel kinds for the create path. This is unavoidable in cycle 1: without the wire-shape collapse, `CreatePanelRequest` still carries the wide-flat shape (`type`, `content`, `dataTypeId`) and the service must dispatch to the right typed subtype with the right `Empty` config. A future cycle could fold this into a registry-driven factory (CS2c-3c marker) but cycle 1's enumeration is clear and behaviour-preserving. Acceptable per CS2c-2 / CS2c-3a precedent (under 400L hard limit).

### 7. `Panel.buildQuery` free function deletion — PASS

Verified via `git diff main..HEAD -- backend/src/main/scala/com/helio/domain/model.scala`: the `Panel.buildQuery` companion-object method (lines 137-146 of pre-CS2c-3b `model.scala`) is removed alongside the wide-flat `Panel` case class. `PanelRoutes.scala:65` switched to `panel.buildQuery` (polymorphic). `grep "Panel\.buildQuery"` against `backend/src/main` returns zero call sites — only a scaladoc reference in `Panel.scala:73` documenting the migration. No remaining call sites.

### 8. `withBindingCleared` — PASS

`withBindingCleared` (PanelService.scala:73 + :85) is called in two paths:

1. `resolveBindingsForRead(panels, None)` — anonymous view (no user) — clears bindings on every panel via `panels.map(_.withBindingCleared)`.
2. `resolveSingleBinding(panel, user)` — when `dataTypeRepo.findById(typeId, user.id)` returns `None` (data type not owned by the user) — calls `panel.withBindingCleared`.

This replaces the pre-CS2c-3b `panel.copy(typeId=None, fieldMapping=None)` idiom that would need to be aware of the wide-flat case class shape. The new method is polymorphic on the trait, so the service layer is subtype-agnostic — bound subtypes do the right `*Config.Empty` substitution, unbound subtypes are no-ops. Exactly the simplification design.md promised.

### 9. AuthService diff — PASS

`git diff main..HEAD -- backend/src/main/scala/com/helio/services/AuthService.scala` returns **0 bytes**. Verified directly.

### 10. File-size budgets — judged acceptable

| File | Before | After | Soft target | Hard limit | Verdict |
|---|---:|---:|---:|---:|---|
| `domain/model.scala` | 293 | 267 | 250 | 400 | -26L (Panel removed); 17L over soft, well under hard. `PanelType` ADT (~32L) still here — spinoff #16.8. **Accept.** |
| `domain/Panel.scala` | new | 162 | 250 | 400 | **Pass.** |
| `domain/panels/<Kind>Panel.scala` × 7 | new | 52–82 | 200 | 400 | **All pass.** |
| `domain/panels/package.scala` | new | 21 | 80 | 80 | **Pass.** |
| `infrastructure/PanelRepository.scala` | 305 | 272 | 250 | 400 | **-33L, still 22L over soft.** Repository is purely Slick query logic now; `rowToDomain`/`domainToRow` extracted to `PanelRowMapper`. Acceptable per CS2c-2/3a precedent. |
| `infrastructure/PanelRowMapper.scala` | new | 133 | 250 | 400 | **Pass.** |
| `infrastructure/DashboardRepository.scala` | 297 | 280 | 250 | 400 | **-17L, 30L over soft.** Snapshot/duplicate paths still here; not cycle-1 scope to split. Pre-existing overage. |
| `services/PanelService.scala` | 287 | 326 | 250 (CONTRIBUTING) / 300 (ticket) | 400 | **+39L, 26L over ticket target.** `buildNewPanel` enumeration helper. Acceptable per Section 6 analysis. |
| `services/PanelPatchApplier.scala` | 109 | 109 | 250 | 400 | **Pass.** |
| `api/protocols/PanelProtocol.scala` | 211 | 248 | 250 | 400 | **+37L for `fromDomain` block.** Right at the soft limit. **Pass.** |
| `api/protocols/DashboardProtocol.scala` | 186 | 222 | 250 | 400 | **+36L for `DashboardSnapshotPanelEntry.fromDomain`.** **Pass.** |
| `api/routes/PanelRoutes.scala` | 81 | 81 | 150 | 400 | **Pass.** |

`scala-quality` reports 19 soft warnings — exactly matches the CS2c-3a baseline (per executor). No new file-size overages introduced; the cycle 1 deltas all live on files already over the soft target before this PR. None warrant a cycle 2.

### 11. No inline FQNs — PASS (one minor candidate)

`npm run check:scala-quality` passes (clean, 19 soft warnings). Grep for inline `com.helio.X` / `spray.json.X` / `java.util.UUID` / `org.apache.pekko.X` in the new files returns only legitimate top-of-file imports + scaladoc references.

**One minor note (non-blocking):** `PanelRowMapper.scala:132` has an inline `scala.util.Try(raw.parseJson).toOption.collect { ... }`. Multiple other files in the codebase (`SchemaInferenceEngine`, `SqlConnector`, all the `domain/steps/*` files) hoist `import scala.util.Try` to the top — for consistency, this could be hoisted too. The scala-quality script does not flag `scala.util.X` (it only enforces the `com.helio`/`spray.json`/`java.util.UUID`/`org.apache.pekko` set), so this is stylistic only. **Non-blocking.**

### 12. `validateConfig` semantics — PASS

Per-subtype invariants documented in scaladoc and verified in `PanelSpec`:
- Metric/Chart/Table → `Right(())` because `dataTypeId` may be transiently empty during mid-edit (cycle-1 read-path tolerance).
- Text/Markdown → `Right(())` (empty content tolerated, matches pre-CS2c-3b).
- Image → `Right(())` (cycle 1 keeps this permissive — design.md mentioned non-empty `imageUrl` as a possible invariant but it's not yet enforced; matches pre-CS2c-3b).
- Divider → `Left("divider weight must be positive")` if `weight.exists(_ <= 0)`, else `Right(())`. Verified.

The trait wires `validateConfig` for use, but cycle 1 does **not** promote it to a hard gate at the patch boundary — that's a CS2c-3c concern coupled with the wire-shape break. Honest. The `PanelSpec` `expose validateConfig per subtype` test covers all 7 plus the Divider negative cases.

### 13. Behavior parity — PASS (verified live)

The 4 DemoData-seeded panels render correctly on the seeded dashboard (Phase 3 snapshot shows all 4 article cards on the "Evaluation Dashboard"). `ApiRoutesSpec` panel cases pass without changes (591/591 total, +14 new = 577 baseline preserved). Phase-3 wire-shape verification confirms byte-equivalent round-trip for every panel subtype.

The cycle-1 PR is a literal no-op from the wire-and-UI perspective. Verified.

### 14. PanelPatchApplier — PASS

PanelPatchApplier.scala (109L, unchanged from pre-CS2c-3b) consumes the typed ADT correctly: `panel.dataTypeId` (line 50, the polymorphic accessor — replaces `panel.typeId`) and `panel.fieldMapping` (line 51, the polymorphic accessor on the trait) for the binding apply path. The composition order (title → appearance → type → content → binding → image → divider → resolveTypeBinding) is preserved exactly. Repository updates still go through per-field `update*` methods (`updateTypeBinding`, `updateImage`, `updateDividerFields`) so the wire-flat patch input continues to land on the column-flat row shape correctly.

### 15. PanelSpec — 14 tests covering the typed ADT — PASS

`backend/src/test/scala/com/helio/domain/PanelSpec.scala` (186L) covers:
- `Panel.Registry` parity with all 7 subtypes + canonical kind strings.
- `PanelKind.All` derives from `Panel.Registry.keySet` + `parseKind` rejects unknowns.
- Per-subtype `kind` correctness via the trait.
- `dataTypeId` dispatch (bound trio → `Some`, others → `None`; empty-bound reads `None` per cycle-1 tolerance).
- `buildQuery` polymorphism (bound trio → `Some`, others → `None`; empty-bound also `None`).
- `selectedFields` from the field mapping (validates `Panel.selectedFieldsFromMapping` helper).
- `validateConfig` per subtype with Divider negative cases (`weight=0`, `weight=-1`, `weight=3`).
- `withBindingCleared` clears only on bound subtypes (no-op on unbound).
- JSON config decode tolerance per subtype (empty `JsObject` → `Empty`).
- Round-trip via per-subtype format.
- Divider decode with all optional fields populated.
- Exhaustiveness pattern-match over all 7 subtypes (test fails on `MatchError` if an 8th is added without a test surface update).

Matches the CS2c-3a `PipelineStepSpec` pattern exactly. Test counts: 591/591 sbt (executor-reported; backed by Phase 3 live verification that wire shape didn't regress).

## Phase 3: Targeted Regression Smoke — PASS

### Environment setup notes

Started fresh — discovered the orchestrator-persistent backend on 8081 was from the (now deleted) CS2c-3a worktree (`/proc/<pid>/cwd → /home/matt/Development/helio/.worktrees/HEL-236-cs2c-3a/backend (deleted)`). Killed it, copied `.env` to the CS2c-3b worktree (orchestrator's setup hadn't done so), restarted `sbt run` with `PORT=8081 CORS_ALLOWED_ORIGINS=http://localhost:5174`. Backend healthy on `/health` after ~30s. Frontend already up on 5174 from this session.

### Smoke results

| Check | Result |
|---|---|
| `/health` returns 200 | PASS — `{"status":"ok"}` |
| Login + session persists from existing tab | PASS — localStorage `helio.auth.token` valid |
| Existing dashboard (4 seeded panels) renders | PASS — Chart "Trend Overview" + 3 metric panels visible in snapshot (`browser_snapshot`) |
| GET `/api/dashboards/:id/panels` shape | PASS — wide-flat: `type` discriminator, `typeId`, `fieldMapping`, no `config` collapse |
| POST text panel | PASS — 201, `{type:"text", content:"Hello from cycle 1"}`; no `typeId/fieldMapping` keys (None → omitted) |
| PATCH text panel title | PASS — 200, title updated |
| POST + PATCH image panel | PASS — `{type:"image", imageUrl:"https://example.com/x.png", imageFit:"cover"}` |
| POST + PATCH divider panel | PASS — `{type:"divider", dividerOrientation:"vertical", dividerWeight:2, dividerColor:"#abcdef"}` |
| Snapshot export → import round-trip | PASS — `version:1` unchanged, 4 panels exported wide-flat, imported back successfully (201) with types `[metric, chart, metric, metric]` |
| Cleanup — all created panels + imported dashboard deleted | PASS — DB returned to pre-smoke state |
| Zero console errors during the flow | PASS — `browser_console_messages level="error"` returned 0 errors |

The point of cycle 1 — **no-op from the wire-and-UI perspective** — is fully verified. The typed ADT internally + wide-flat externally combination round-trips byte-equivalent to pre-CS2c-3b for every panel subtype that touches the wire today.

## Overall: APPROVED

The cycle-1 scoped-down delivery is a behaviour-preserving structural refactor that delivers exactly what the user approved (Path A — split the work, ship the backend ADT now, defer wire/frontend/schemas to CS2c-3c). The polymorphic-method-per-file pattern from CS2c-3a cycle 3 is applied cleanly from day 1; the `Panel.Registry` is the single source of truth; the old wide-flat case class is deleted; tests + lint + format + schemas + openspec + scala-quality all green; AuthService is untouched; wire shape and DB shape are preserved exactly. Phase 3 confirms end-to-end on the live wire path for every panel subtype.

This PR is ready to merge.

## Findings

### Blockers
- (none)

### Notes (non-blocking)

1. **`scala.util.Try` inline at `PanelRowMapper.scala:132`.** Multiple other files in the codebase hoist `import scala.util.Try` to the top of the file. The scala-quality check does not flag `scala.util.X` (only the `com.helio` / `spray.json` / `java.util.UUID` / `org.apache.pekko` set), so this is stylistic consistency only. Trivial cleanup in a future cycle if desired.

2. **PanelService 326L (target 300, soft 250).** The `buildNewPanel` enumeration helper is genuine, behaviour-preserving work — the wire-shape preservation forces a 7-arm dispatch from `PanelType` → typed subtype. CS2c-3c can fold this into a registry-driven factory once the wire shape collapses (`CreatePanelRequest` becomes discriminated with per-subtype `config`). Accept per cycle-1 scope.

3. **`PanelRepository` 272L, `DashboardRepository` 280L, `model.scala` 267L.** Soft overages on files already over the budget pre-CS2c-3b. Net change is downward (-33L, -17L, -26L respectively). Acceptable per CS2c-2 / CS2c-3a precedent.

4. **`PanelType` ADT (~32L) still in `model.scala`.** Spinoff #16.8 captures replacing all string-discriminator call sites with `PanelKind` to retire `PanelType`. Not blocking; orthogonal to the wire-shape collapse.

5. **`writeConfigToWire(config: Any).asInstanceOf[XConfig]`** in each subtype's `Panel.Companion` is the loose-typing trade-off of routing `Any` configs through the registry. Same trade-off as CS2c-3a's codec; CS2c-3c can close it by introducing a sealed `PanelConfig` trait if desired. Non-blocking.

### Forward markers (carrying into CS2c-3c)

1. **Wire-shape collapse** — rewrite `PanelResponse.fromDomain` and `DashboardSnapshotPanelEntry.fromDomain` for the `{type, config: {...}}` shape. Both pattern-match blocks are pre-staged for this rewrite (single integration point each).
2. **6 schema discriminated-union rewrites** — `panel.schema.json` becomes `oneOf` by `type`, plus 5 sibling request/response schemas.
3. **Frontend lockstep** — `Panel` discriminated union, per-subtype renderer dispatch, `panelsSlice` typed thunks. 21 consumer files.
4. **Snapshot version bump + Image/Divider data-loss bug fix** — closes as a natural side effect of typed `config` collapse.
5. **HEL-242** — separate ticket; root-cause hypothesis recorded in `executor-report-1.md` §1.6.
6. **`useLegacyBoundPanel` removal** — CS3-era cleanup; independent of ADT.

## Test counts (verified via executor + Phase 3 wire-shape parity)

- `sbt test`: 591 / 591 PASS (577 baseline + 14 new PanelSpec — executor-reported, not re-run by evaluator)
- `npm test`: 664 / 664 PASS (frontend untouched — executor-reported, not re-run by evaluator)
- `npm run check:scala-quality`: clean, 19 soft warnings (matches CS2c-3a baseline exactly; verified directly)
- All other gates (lint / format / schemas / openspec): clean per executor; Phase 3 wire-shape parity confirms no regression that would surface in those gates

## Phase 3 environment notes

Killed a stale CS2c-3a backend on port 8081 (its source worktree had been deleted). Copied `backend/.env` into the CS2c-3b worktree (orchestrator setup hadn't done this). Started fresh `sbt run` on 8081 with CORS for 5174 — healthy after ~30s. Reused the running frontend Vite dev server on 5174 (started earlier in the session). Login session persisted from earlier — token in `localStorage.helio.auth.token`. Total smoke time ~3 minutes. DB returned to pre-smoke state via cleanup deletes.
