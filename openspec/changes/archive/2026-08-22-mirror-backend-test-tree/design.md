## Context

HEL-633 (merged, archived at `openspec/changes/archive/2026-08-22-repackage-backend-domain-subpackages/`)
repackaged `backend/src/main` into nested domain subpackages (`api/routes/<domain>/`,
`api/protocols/<domain>/`, `services/<domain>/`, `infrastructure/{persistence,storage,crypto,concurrency}/`,
`domain/{model,connectors,engine,util,panels,shapes,steps}/`) but only fixed test-file imports, never moved
test files. The ticket's own drift description is **stale** (per epic lesson): main is nested two levels
under `api/routes/`/`api/protocols/`, not flat as the ticket implies, and `testutil/` holds two files
(`JsonLogCapture.scala`, `PdfFixtures.scala`), not the one the ticket names.

218 test files live under `backend/src/test/scala/com/helio` today (re-counted from the live tree, not
the ticket).

## Goals / Non-Goals

**Goals:** every spec lands in the package mirroring its main-tree subject; `testutil/` merges into
`testsupport/`; shared spec base classes sit at the root of the package whose specs extend them; file
count and test count are provably unchanged; `sbt test` green.

**Non-Goals:** no assertion/behavior changes, no `main` edits, no scope bleed into HEL-802/803/804/811.

## Decisions

**D1 — Matching methodology.** A test file's *subject* is its base name with a trailing `Spec` /
`SpecBase` / `RegressionSpec` stripped (e.g. `PanelSpec` → `Panel`, `DataSourceServiceRestartPersistenceSpec`
→ prefix-matched, see D2). Where a main file with that exact base name exists, the spec moves to that
file's package — a 1:1 mechanical rule, auto-generated into `mapping/mapping.tsv` (135/218 files resolved
this way; script at `mapping/build-mapping.py` — kept as an execution artifact, not committed source).

**D2 — Scenario/integration specs (no 1:1 main-file name).** The remaining 83 files are named after a
*behavior* (e.g. `DashboardApplyProposalAggregationSpec`, `WorkspaceContextServiceComputeJoinHintsSpec`,
`RlsPolicyGuardSpec`) rather than a single class. These match by **domain-prefix against the main
services/routes/protocols subpackage names** (`dashboards`, `pipelines`, `panels`, `proposals`,
`patchsets`, `sources`, `workspace`, `metrics`, `alerts`, `hooks`, `agents`, `assistant`, `auth`) — e.g.
`WorkspaceContextService*Spec` → `services/workspace` (matches `WorkspaceContextService.scala`'s own
package); `PanelService*Spec` → `services/panels`. Verified per-file below (D3–D6), not assumed from the
prefix alone — the prefix narrows the search, the actual main-tree grep confirms it.

**D3 — Route-level `*ApplyProposal*`/`*ContentsReplace*`/`CombinedApplyProposal*` specs and their shared
base classes, split by the route domain they actually integration-test (corrected in round 2 — round 1
wrongly claimed all three route classes live in `api/routes/proposals/`; ground truth:
`PipelineProposalRoutes.scala` lives in `api/routes/pipelines/`, not `proposals/`).**
- `DashboardApplyProposal*Spec` (5), `DashboardContentsReplace*Spec` (2), `DashboardGetOrCreateSpec`,
  `CombinedApplyProposal*Spec` (3) + `ApplyProposalSpecBase` + `CombinedApplyProposalSpecBase` →
  `api/routes/proposals/` (integration-test `DashboardProposalRoutes.scala` /
  `CombinedProposalRoutes.scala`, both confirmed present there).
- `PipelineApplyProposalSpec`, `PipelineApplyProposalRollbackSpec`, `PipelineApplyProposalSpecBase` →
  `api/routes/pipelines/` (integration-test `PipelineProposalRoutes.scala`, confirmed at
  `main/.../api/routes/pipelines/PipelineProposalRoutes.scala`) — this is the single stated target for
  these three files; D5's old duplicate bullet for the same files is removed, not merely repeated.
This still satisfies the ticket's "shared base classes at the package root" requirement (item 4) for all
three base classes, split across their two correct domains rather than one.

**D4 — Four `*ShapeEngineSpec` files** (`SingleRowShapeEngineSpec` etc., currently at `domain/` root) test
`domain/shapes/{SingleRowShape,TopNShape,TimeSeriesShape,PivotMatrixShape}.scala` (confirmed by grep — no
`*ShapeEngine.scala` main file exists; "Engine" is a stale name fragment in the spec, not a subject match).
Move to `domain/shapes/`, alongside the already-correctly-placed `*ShapeSpec` files — this is the ticket's
own explicit instruction (item 2), now grounded against the actual main files.

**D5 — Cross-cutting/no-single-subject specs**, resolved by grep against `backend/src/main` for the
concept each name suggests, not by domain-prefix guesswrange:
- `ResourceTaggingSpec` → **stays at `api/routes/` root, no move** (corrected in round 2 — round 1's
  "confirmed" claim that tag logic lives in `WorkspaceTeardownService.scala` does not hold:
  `grep -ril 'resourcetag' main/scala/com/helio` returns nothing; `WorkspaceTeardownService.scala` merely
  reads a caller-supplied `req.tag` field. The spec's own header states its actual subject: tag
  persistence + `?tag=` filtering + wire-format parity across `DataTypeRoutes`, `PipelineRoutes`,
  `DataSourceRoutes`, and `WorkspaceRoutes` — four domains at once. See D5b for the general rule this
  now falls under.)
- `PanelMetricBindingRoutesSpec` → `api/routes/panels` (confirmed: `PanelRoutes.scala`/`PanelService.scala`
  own metric-binding wiring; no separate `PanelMetricBindingRoutes.scala` main file exists).
- `StructuredJsonLoggingSpec` → `infrastructure/` root. No `main`-tree Scala subject exists (it tests
  `LOG_FORMAT`/`logback.xml` behavior, config not code) — stays at the top of `infrastructure/`, the
  closest existing cross-cutting-config package, rather than forcing a false match.
- `DatabaseConnectionTimeoutSpec`, `PaginationSpec`, `*MigrationSpec` (`BinaryRefsMigration`,
  `PipelineOnlyPanelBindingMigration`, `ResourceTagMigration`, `TriggerSourceMigration`,
  `UserTierMigration`), `Rls*Spec` (`RlsOwnerTables`, `RlsPolicyGuard`, `RlsPrivilegedDml`,
  `RlsSharingAwareTables`), `PipelineSharingAclSpec` → `infrastructure/persistence` (all exercise
  Slick/Flyway/RLS behavior against `infrastructure/persistence/**`).
- `DataFieldTypeSpec`, `PanelAppearanceMergeSpec`, `PanelTypeSpec`, `DashboardModelSpec` →
  `domain/model` (all test types defined in `domain/model/model.scala` / `Panel.scala`).
- `NewConnectorInferenceSpec` → `domain/connectors`.
- `UserTierSpec` → `services/auth` (tests `UserTierConfig.scala`).
- `AggregatorRegressionSpec` → **stays at `api/protocols/` root, no move** (corrected in round 2 — round 1
  guessed "aggregation" meant the pipeline `AggregateStep`; the file's own docstring and its
  zero-`domain.*`-import content prove otherwise: it "locks in the byte-for-byte JSON wire shape of every
  top-level response/request type after the per-domain protocol split" by mixing in `JsonProtocols`
  itself and round-tripping types from `auth`/`dashboards`/`panels`/`pipelines`/`sources` protocols. Its
  subject is `com.helio.api.JsonProtocols` (already at `api/` root), not any single domain — same
  cross-cutting shape as `AggregatorRegressionSpec`'s own current placement, which is therefore already
  correct).
- `ComputedFieldsRoutesSpec`, `ImageFitValidationSpec` → `api/routes/pipelines` and
  `api/routes/sources`/`protocols/sources` respectively (confirmed by grep: computed-field logic sits in
  `DataTypeProtocol.scala`/`DataTypeService.scala`; image-fit is `ImageUploadProtocol.scala`).
- ACL specs at `api/routes/` root (`DashboardPanelAclSpec`, `DataTypeDataSourceAclSpec`, `PipelineAclSpec`)
  → the domain each name's first noun identifies (`dashboards`, `pipelines`/`sources`, `pipelines`).
- Remaining `api/routes/` and `api/` root route specs not covered above resolve by D1/D2 against the
  matching `api/routes/<domain>/*Routes.scala` (e.g. `AutoLayoutRouteSpec` → `panels`, `GoogleOAuthRoutesSpec`
  → `auth`, `MfaApiRoutesSpec` → `auth`, `PanelBatchCreateSpec` → `panels`,
  `PatchSetPreviewRoutesSpec`/`PatchSetUndoRoutesSpec` → `patchsets`,
  `PipelineAnalyze*RoutesSpec`/`PipelineRunRoutesSpec` → `pipelines`). `PipelineApplyProposal*Spec` is
  resolved by D3 above, not here — removed from this bullet in round 2 to eliminate the duplicate,
  contradictory instruction round 1 left in place.

**D5b — Rule for genuinely cross-domain / multi-route integration specs (added in round 2; round 1 had
no stated rule and got two placements wrong as a result — CR2/CR3 above).** A spec that integration-tests
route classes from more than one domain package, with no single domain doing the bulk of the assertions,
stays at the **root of the smallest package that already contains all of them** — mirroring where
`ApiRoutes.scala` itself lives (the composition root for every sub-router), rather than being forced into
one arbitrarily-chosen domain. Concretely: `ResourceTaggingSpec` (exercises `DataTypeRoutes`,
`PipelineRoutes`, `DataSourceRoutes`, `WorkspaceRoutes`) and `AggregatorRegressionSpec` (round-trips types
from five protocol domains via `JsonProtocols` itself) both satisfy this and both stay at their current
root package (`api/routes/` and `api/protocols/` respectively) — a **no-op move** for these two files,
which is a valid, checkable outcome of applying D1's own subject rule, not an exception to it. Any other
`unmatched.txt` entry that turns out to name ≥2 domains with no clear primary applies this same rule;
task 1.2 must flag each such case explicitly rather than silently forcing a single-domain guess.

**D6 — `testutil` → `testsupport` merge.** Move `JsonLogCapture.scala` and `PdfFixtures.scala` into
`testsupport/`, delete `testutil/`. `rg 'com\.helio\.testutil'` must return nothing afterward.

**D7 — Import rewrite is statement-oriented, never line-oriented** (epic lesson from HEL-633's own three
line-tool failures): use a Scala-aware or brace-balanced parser for every `package`/`import` edit, never
`sed`/`awk` on raw lines. Emit every rewritten import on one line, mirroring HEL-633's D7(c) convention.

**D8 — Verification is compiler + bytecode, never green-tests-alone.** `sbt Test/compile` must be clean
after every batch of moves. Before declaring done: compare `.class` file constant pools (same technique
HEL-633 used) for a sample of moved spec classes pre/post-move to confirm no accidental content edit
beyond `package`/`import` lines — a green suite alone already certified three real defects on this epic
that only computed measurement caught. The sample must include at least one file from each decision
category (D1's mechanical match, D2's domain-prefix match, D3's split base-class move, D4's shape-engine
move, D5's grep-resolved cases, D6's testutil merge) — not an unspecified "representative sample". Also
assert file-count parity (`find ... | wc -l` before/after) and `rg 'com\.helio\.testutil'` empty.

**D9 — `-Wunused` is not part of this ticket's evidence.** HEL-807 (filed, unfixed) means any single
`-Wunused` run undercounts above 100 warnings/phase; this ticket does not rely on unused-import counts as
gate evidence, only on `Test/compile` succeeding and file/test counts matching.

## Risks / Trade-offs

- **A D2/D5 domain-prefix guess is wrong** → every placement is followed by `sbt Test/compile`; a wrong
  package surfaces as an import-resolution failure or, worse, silently compiles if the wrong domain
  happens to share visible names — mitigated by D8's bytecode check plus final-gate skeptic review of the
  full diff, not by the prefix heuristic alone.
- **Line-oriented import tooling reintroduces HEL-633's exact failure** → D7 forbids it by name.
- **A file gets missed and silently stays in place** → D8's file-count-parity check catches a moved-count
  mismatch; `mapping/mapping.tsv` plus `mapping/unmatched.txt` (both execution artifacts) are the
  completeness checklist, asserted against the full `find` listing before archiving.

## Planner Notes

Self-approved: all of D1–D9 (mechanical placement + verification method, no external dependency, no
architectural change, no breaking API — squarely within the ticket's own stated constraints). No
escalation raised.
