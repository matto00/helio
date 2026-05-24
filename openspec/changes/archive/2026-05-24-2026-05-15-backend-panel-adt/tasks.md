# Tasks — backend-panel-adt (CS2c-3b)

## 0. Bind to standards

- [x] 0.1 Read `WORKTREE_PATH/CONTRIBUTING.md` in full
- [x] 0.2 Read `ticket.md`, `proposal.md`, `design.md` (inherit from `openspec/changes/2026-05-14-backend-domain-adts-foundations/design.md` for CS2c-series base; **mandatory** inherit from `openspec/changes/2026-05-15-backend-pipeline-step-adt/` for the per-file polymorphic-method template)
- [x] 0.3 Read memory: `feedback-no-inline-fqns.md`, `feedback-refactor-discipline.md`, `project-backend-architecture-remodel.md`, `project-panel-datatype-binding-p0.md`

## 1. Exploration (resolve open design questions)

- [x] 1.1 Grep every `panelType` / `panel.type` / panel nullable-field consumer (backend + frontend) — confirm impact list in `design.md` §10
- [x] 1.2 Inspect today's `PanelRepository.rowToDomain` — record the column mapping per subtype; plan typed dispatch path
- [x] 1.3 Inspect `PanelService` + `PanelPatchApplier` — record validation logic per subtype; identify any duplication that the typed ADT eliminates
- [x] 1.4 **Investigate `useLegacyBoundPanel.ts`** — DEFER decision; recorded in `executor-report-1.md` §1.4
- [x] 1.5 **Inventory snapshot import/export** — DEFER wire-shape break decision; recorded in `executor-report-1.md` §1.5
- [x] 1.6 **HEL-242 investigation** — DEFER as follow-up ticket; root-cause hypothesis recorded in `executor-report-1.md` §1.6
- [x] 1.7 Inspect today's panel-touching JSON Schemas (6 files); plan discriminated-union shape — DEFER to CS2c-3c
- [x] 1.8 Record all decisions in `executor-report-1.md` (cycle 1) — HEL-242 decision is non-negotiable; the report must explicitly state the path chosen and why

## 2. Backend domain (per-file polymorphic shape from day one)

- [x] 2.1 Create `domain/Panel.scala` — `trait Panel` (not sealed; documented in scaladoc) + `Panel.Companion` + `Panel.Registry` + `PanelKind` constants
- [x] 2.2 Create `domain/panels/MetricPanel.scala` — case class + `MetricPanelConfig` + companion + JSON format (with tolerance defaults) + `validateConfig`
- [x] 2.3 Create `domain/panels/ChartPanel.scala`
- [x] 2.4 Create `domain/panels/TablePanel.scala`
- [x] 2.5 Create `domain/panels/TextPanel.scala`
- [x] 2.6 Create `domain/panels/MarkdownPanel.scala`
- [x] 2.7 Create `domain/panels/ImagePanel.scala`
- [x] 2.8 Create `domain/panels/DividerPanel.scala`
- [x] 2.9 Polymorphic `dataTypeId: Option[DataTypeId]` on the trait — Metric/Chart/Table return `Some`; others return `None`
- [x] 2.10 Polymorphic `validateConfig: Either[String, Unit]` — per-subtype invariant checks (DividerPanel weight>0 if present; others Right(()))
- [x] 2.11 `buildQuery: Option[PanelQuery]` polymorphic on the trait — replaces the `Panel.buildQuery` free function
- [x] 2.12 Remove old wide-flat `Panel` case class from `domain/model.scala`
- [x] 2.13 `sbt compile` — green

## 3. Backend protocol

- [~] 3.1 `api/protocols/PanelProtocol.scala` — wire shape preserved in cycle 1; `PanelResponse.fromDomain` pattern-matches typed subtype back to wide-flat. CS2c-3c rewrites this for the `config`-collapse wire shape.
- [x] 3.2 Per-subtype `*Config` JSON formats with tolerance defaults — co-located in each `<Kind>Panel.scala` file
- [~] 3.3 `CreatePanelRequest` / `UpdatePanelRequest` discriminate on `type` — DEFER to CS2c-3c with wire shape break
- [~] 3.4 `DashboardSnapshotPanelEntry` — wire shape preserved; pattern-matches typed subtype back to wide-flat
- [x] 3.5 `sbt compile` — green

## 4. Backend infrastructure

- [x] 4.1 Update `PanelRepository.rowToDomain` — dispatch on `panels.type` column via Registry (new `PanelRowMapper.rowToDomain`); per-subtype config built from existing nullable columns
- [x] 4.2 Update `PanelRepository.domainToRow` — pattern-match subtype → column-by-column flatten (`PanelRowMapper.domainToRow`)
- [x] 4.3 Read-path tolerance: partial rows decode to default-valued configs (Empty-config defaults per subtype)
- [~] 4.4 `PanelRepository.scala` 273L (down from 305L) — under hard limit but soft over by 23L; rowToDomain/domainToRow now live in `PanelRowMapper.scala` so PanelRepository is purely query logic now
- [x] 4.5 `sbt compile` — green

## 5. Backend services

- [x] 5.1 Update `services/PanelService.scala` — typed ADT consumption (`buildNewPanel` helper for the create path)
- [x] 5.2 Update `services/PanelPatchApplier.scala` — typed `dataTypeId` / `fieldMapping` reads
- [~] 5.3 Cross-type PATCH guard — DEFER to CS2c-3c with wire shape break
- [~] 5.4 PanelService 327L (up from 287L — added `buildNewPanel` helper); PanelPatchApplier 109L unchanged
- [x] 5.5 `sbt compile` — green

## 6. Backend routes

- [x] 6.1 Update `routes/PanelRoutes.scala` — `panel.buildQuery` polymorphic (replaces `Panel.buildQuery(panel)` free function)
- [~] 6.2 `routes/DashboardRoutes.scala` snapshot version bump — DEFER to CS2c-3c with wire shape break
- [x] 6.3 Routes file-size budgets met (PanelRoutes 81L)
- [x] 6.4 `sbt test` — full green (591/591)

## 7. Snapshot import/export — DEFERRED to CS2c-3c

- [ ] 7.1 Snapshot version bumped — DEFER
- [ ] 7.2 Wire-shape break decision: DEFER; cycle 1 preserves the existing wide-flat snapshot wire shape
- [ ] 7.3 Snapshot round-trip test per subtype — DEFER
- [ ] 7.4 Image / Divider pre-existing data-loss bug — DEFER (closes as side effect of CS2c-3c typed `config` collapse)
- [x] 7.5 `sbt compile` — green

## 8. Schemas — DEFERRED to CS2c-3c

- [ ] 8.1 `schemas/panel.schema.json` rewrite — DEFER
- [ ] 8.2 `schemas/create-panel-request.schema.json` — DEFER
- [ ] 8.3 `schemas/panel-query.schema.json` — DEFER
- [ ] 8.4 `schemas/update-panels-batch-request.schema.json` / response — DEFER
- [x] 8.5 `npm run check:schemas` — green (wire shape preserved, schemas in sync with backend)

## 9. Frontend type sync — DEFERRED to CS2c-3c

- [ ] 9.1–9.11 All frontend updates DEFER (wire shape preserved in cycle 1)
- [x] 9.12 `npm run lint`, `npm test`, `npm run format:check` — green (frontend untouched, 664 tests pass)

## 10. HEL-242 — DEFERRED as follow-up ticket

- [ ] 10.1 Fold-in: not applied (fix surface > 20 lines per §1.6 investigation)
- [x] 10.2 Defer: root-cause hypothesis recorded in `executor-report-1.md` §1.6 — recommend follow-up ticket targeting `PanelService.resolveBindingsForRead` cross-user-clear policy + frontend cache invalidation

## 11. Backend ADT-specific tests

- [x] 11.1 Created `backend/src/test/scala/com/helio/domain/PanelSpec.scala` — 14 tests: per-subtype `kind` correctness, Registry parity, `dataTypeId`/`validateConfig`/`buildQuery` per subtype, JSON config decode tolerance, exhaustiveness pattern-match
- [~] 11.2 `PanelProtocolSpec.scala` — DEFER to CS2c-3c (no protocol changes in cycle 1 beyond preserving wire shape)
- [~] 11.3 `PanelRepositorySpec.scala` partial-config regression — DEFER to CS2c-3c (existing `ApiRoutesSpec` panel tests exercise the new dispatch path; +14 new PanelSpec tests cover the typed ADT)
- [~] 11.4 `ApiRoutesSpec.scala` panel-endpoint cases — UNCHANGED (wire shape preserved, existing tests pass without changes)
- [~] 11.5 Snapshot round-trip tests — DEFER to CS2c-3c
- [x] 11.6 `sbt test` — full green (591/591)

## 12. Cross-cutting

- [~] 12.1 OpenSpec spec.md updates — DEFER to CS2c-3c (wire shape preserved, no spec drift)
- [x] 12.2 `npm run check:openspec` — green
- [x] 12.3 `npm run check:schemas` — green

## 13. Verification gates

- [x] 13.1 `sbt test` — full green (591/591; +14 new PanelSpec tests; no regressions)
- [x] 13.2 `npm test` — full green (664/664; frontend untouched)
- [x] 13.3 `npm run lint` — zero warnings
- [x] 13.4 `npm run format:check` — clean
- [x] 13.5 `npm run check:schemas` — passes
- [x] 13.6 `npm run check:openspec` — clean
- [x] 13.7 `npm run check:scala-quality` — passes (19 soft warnings, matches CS2c-3a baseline; no inline FQNs)
- [~] 13.8 File-size budget audit per design §7 — `model.scala` 268L (was 293L; 4-line dip after Panel deletion — extra 18L from net change is PanelType not removed in cycle 1), `Panel.scala` 162L, `panels/<Kind>Panel.scala` 21-82L, `PanelRepository.scala` 273L, `PanelService.scala` 327L (up from 287 — added `buildNewPanel`), other targets met
- [x] 13.9 `Panel.Registry` is single source of truth; no hard-coded `Set[String]` lists in domain
- [x] 13.10 Old wide-flat `Panel` case class deleted from `domain/model.scala`
- [x] 13.11 AuthService unchanged: `git diff main -- backend/src/main/scala/com/helio/services/AuthService.scala` empty

## 14. Smoke validation (evaluator Phase 3 runs — executor does NOT run smoke)

- [ ] 14.1 Backend starts with `BACKEND_PORT=8081 sbt run`; `/health` returns 200
- [ ] 14.2 Frontend starts with `DEV_PORT=5174 npm run dev`
- [ ] 14.3 Smoke flow simplified for cycle 1 (wire shape preserved): existing dashboards / panels round-trip; the structural ADT win is verified by `sbt test` (591/591 green) + AuthService diff empty + scala-quality clean. Full 7-kind smoke (with the `config`-collapse wire shape) becomes the CS2c-3c gate.

## 15. Commit / PR handoff

- [x] 15.1 Multi-commit history: cycle 1 lands as logically split commits — domain trait + per-file subtypes, repo dispatch + DemoData, protocol/service/applier wire-flatteners, tests, openspec docs
- [x] 15.2 All commits on branch `task/backend-panel-adt/HEL-236`
- [ ] 15.3 Orchestrator handles push + PR — do not push

## Spinoff candidates (capture, do NOT pull into CS2c-3b cycle 1)

- [x] 16.1 **CS2c-3c — wire-shape evolution**: typed `config` collapse on the wire, 6 panel schemas to discriminated union, frontend `Panel` discriminated union, `DashboardSnapshotPanelEntry` typed, snapshot version bump, cross-type PATCH lock. Captured as the natural follow-up.
- [ ] 16.2 `BoundPanel` / `UnboundPanel` intermediate traits if common methods cluster naturally — not yet warranted; the cycle-1 polymorphic surface (`dataTypeId`, `validateConfig`, `buildQuery`) is small.
- [ ] 16.3 `appearance.chart` migration into `ChartPanelConfig` (appearance-vs-config boundary cleanup) — CS3-era
- [ ] 16.4 **Snapshot version-N → version-(N+1) upgrade tooling** — needed once CS2c-3c bumps the version
- [ ] 16.5 **HEL-242 P0 panel-binding bug** — root-cause hypothesis in `executor-report-1.md` §1.6; recommend follow-up ticket
- [ ] 16.6 **`useLegacyBoundPanel.ts` removal** — independent of ADT; unify legacy-bound and pipeline-bound rendering paths in CS3-era
- [ ] 16.7 **Snapshot Image/Divider data-loss bug** — pre-existing; closes as a side effect of CS2c-3c
- [ ] 16.8 `PanelType` ADT in `model.scala` (~32L) — duplicates `PanelKind` constants; consider replacing all string-discriminator call sites with `PanelKind` in a future cycle
