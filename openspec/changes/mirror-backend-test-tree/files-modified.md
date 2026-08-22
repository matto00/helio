# Files modified — HEL-634

Mechanical test-tree relocation: `backend/src/test/scala/com/helio` mirrored onto
the domain-subpackaged layout `backend/src/main` already has (HEL-633). Moves,
`package` declarations, and imports only — no new tests, no changed assertions,
no renamed spec classes, no `backend/src/main` edits.

## Headline numbers (D8 acceptance evidence)

- **Test-file count**: 218 before → 218 after (`find backend/src/test/scala -name
  '*.scala' | wc -l`), identical.
- **Moved-file count**: 190 files moved (`git status --short backend/src/test` →
  190 `A` / 190 `D`, no rename-detected pairs since content also changed via
  import fixes). 28 files are explicit no-op entries (already in the correct
  package, recorded in `mapping/mapping.tsv` rather than silently dropped) —
  190 + 28 = 218.
- **Test count**: 3346 tests / 212 suites before → 3346 tests / 212 suites
  after (`sbt test`, both runs 100% green). Verified by running the full suite
  against the pre-move tree (`git stash`) and again against the post-move tree.
- **`rg 'com\.helio\.testutil'`**: empty (both `testutil/` files merged into
  `testsupport/`, directory deleted).
- **Directory/package correspondence**: every `test/.../com/helio/<pkg>` has a
  matching `main/.../com/helio/<pkg>` (`testsupport` and `infrastructure`
  excepted per design.md D5 — `StructuredJsonLoggingSpec` has no main-tree
  Scala subject, only `logback.xml`/config).

## What moved

All 218 spec files were re-evaluated against `mapping/mapping.tsv` (fully
resolved — the 159 entries built during Planning plus all 59 `unmatched.txt`
entries resolved in this session per design.md D2/D5/D5b). Representative
categories:

- `api/*.scala` (34 flat files) → `api/routes/<domain>/` or
  `api/protocols/<domain>/` per D1–D3/D5 (e.g. apply-proposal specs split
  across `api/routes/proposals/` and `api/routes/pipelines/` per D3).
- `api/routes/*.scala` (29 flat files) → `api/routes/<domain>/` (D1/D2/D5).
- `domain/*.scala` → `domain/{steps,shapes,engine,model,connectors}/` (D1/D4/D5).
  `AggregateStepSpec` → `domain/steps` (the only step spec still at root); the
  four `*ShapeEngineSpec` files → `domain/shapes` (D4).
- `services/*.scala` → `services/<domain>/` (D1/D2/D5, including the seven
  `WorkspaceContextService*Spec` files → `services/workspace` and the six
  `PanelService*Spec` files → `services/panels`).
- `infrastructure/*.scala` → `infrastructure/persistence/<domain>/` or
  `infrastructure/persistence/` (D5, all Slick/Flyway/RLS specs).
- `testutil/{JsonLogCapture,PdfFixtures}.scala` → `testsupport/` (D6);
  `testutil/` deleted.

## Explicit no-op moves (D5b, recorded not omitted)

- `ResourceTaggingSpec` — stays at `api/routes/` root (exercises `DataTypeRoutes`,
  `PipelineRoutes`, `DataSourceRoutes`, `WorkspaceRoutes` — four domains, no
  single primary).
- `AggregatorRegressionSpec` — stays at `api/protocols/` root (round-trips
  types from five protocol domains via `JsonProtocols` itself).
- `DataTypeDataSourceAclSpec` — stays at `api/routes/` root (spans
  `api/routes/pipelines/DataTypeRoutes` and `api/routes/sources/DataSourceRoutes`,
  no single primary — same D5b rule as the two above).
- `ApiRoutesCorsErrorHandlingSpec`, `ApiTokenAuthSpec` — stay at `api/` root
  (cross-cutting: exercise `TopLevelErrorHandlers`/`AuthDirectives` and "every
  existing authenticated route" respectively — the `ApiRoutes` composition
  root, per D5b's rule).
- `ClaudeStreamAssemblySpec` — stays at `ai/` root (already in the correct
  package; tests `ClaudeSseAssembler`, also at `ai/` root — a D1-style
  same-package match, not a domain-prefix guess).
- `StructuredJsonLoggingSpec` — stays at `infrastructure/` root (no
  main-tree Scala subject; tests `LOG_FORMAT`/`logback.xml` config, D5).
- `JsonSchemaValidation.scala` (`testsupport/`) — already correctly placed.

## Import fixes beyond the move itself

Moving files out of the flat `com.helio.api` / `com.helio.domain` /
`com.helio.services` root packages surfaced dependencies on two package
objects (`api/package.scala`, `domain/package.scala`) and one plain top-level
object (`services/ServiceError.scala`) that those flat packages resolved
implicitly. Every affected file received a single explicit import statement
(never a line-oriented edit — D7):

- `import com.helio.api._` — restores `JsonProtocols`, `ApiRoutes`, and the
  request/response type aliases (`ErrorResponse`, `AuthResponse`,
  `DataSourceResponse`, etc.) to specs that moved into `api.routes.*` /
  `api.protocols.*` and previously got them for free at the `api` root.
  Affected: `AclDirectiveSpec`, `AuthDirectivesSpec`, `GoogleOAuthRoutesSpec`,
  `MfaApiRoutesSpec`, `ComputedFieldsRoutesSpec`, `ApplyProposalSpecBase`,
  `CombinedApplyProposalSpecBase`, `PipelineApplyProposalSpecBase`,
  `PipelineStepRoutesSpec`, `PipelineApplyProposalRollbackSpec`,
  `DataSourceRoutesSpec`, `UploadRoutesSpec`.
- `import com.helio.api.routes.proposals.ApplyProposalSpecBase` — two specs
  (`AutoLayoutRouteSpec`, `PanelBatchCreateSpec`) that moved into
  `api.routes.panels` but still extend the shared fixture, which moved into
  `api.routes.proposals` per D3.
- `import com.helio.domain.steps._` — two specs (`PipelineStepSpec`,
  `SingleRowShapeEngineSpec`) that moved out of the flat `domain` root, which
  re-exports every step/config type via `domain/package.scala`.
- `import com.helio.services.ServiceError` — 24 service specs that moved out
  of the flat `services` root, where `ServiceError.scala` lives directly.
- `com.helio.testutil.{JsonLogCapture,PdfFixtures}` → `com.helio.testsupport.*`
  in the 6 files that imported them (D6 follow-through).

These are all additive single-import-statement changes; no existing import
line was rewritten line-by-line (D7), and no assertion/behavior changed.

## Verification (D8)

- `sbt Test/compile`: clean, both after each batch and on the final tree.
- `sbt test`: 3346/3346 passing pre- and post-move (full suite run both ways
  via `git stash`/`git stash pop` to get a true baseline).
- Bytecode constant-pool comparison (`javap -p -c -constants`, package-prefix
  normalized) on one sample per decision category:
  - D1 (`AlertRuleServiceSpec`, D2 (`PanelServiceMetricBindingSpec`): only
    ScalaTest `Position` line-number literals shifted (from the added import
    line) — same referenced classes/methods.
  - D3 (`DashboardApplyProposalSpec`, `PipelineApplyProposalSpec`): byte-for-
    byte identical after prefix normalization.
  - D4 (`SingleRowShapeEngineSpec`): resolves step types via the direct
    `domain.steps._` import instead of the `domain` package-object aliases —
    fewer indirection hops through `package$.MODULE$`, same underlying
    classes/methods; a legitimate import-driven bytecode difference, not a
    logic change.
  - D5 (`RlsPolicyGuardSpec`): byte-for-byte identical.
  - D6 (`JsonLogCapture`): byte-for-byte identical.
- File-count parity: 218 → 218.
- `rg 'com\.helio\.testutil'`: empty.
