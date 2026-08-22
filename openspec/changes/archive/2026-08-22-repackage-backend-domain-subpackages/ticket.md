# HEL-633: Repackage backend main into domain subpackages

## Description

Subdivide the flat backend layers in `backend/src/main/scala/com/helio` by domain.
Layer-first is retained; domain names must be spelled identically in every layer so a
single grep on a domain name surfaces its whole stack. Parent epic: HEL-632.

Iron constraint (HEL-632): **no behaviour changes**. Moves, `package` declarations,
imports, and READMEs only. No logic edits, no signature changes, no type renames, no
"while I'm here" fixes. Bugs found in passing get a spinoff ticket.

## Measured ground truth (worktree @ 29fc0528)

The tree grew from 215 files (when the ticket was written) to 322. The ticket's
per-file placement lists are therefore stale.

- `services/` 88, `api/routes/` 48, `api/protocols/` 46, `infrastructure/` **40**,
  `domain/` root 22. Movers in the four flat layers: 222; across all five: 244.
- Test tree: 218 files, 143 of which import `com.helio.{api,services,infrastructure,domain}`.
- Quality baseline: `check-scala-quality.mjs` clean with exactly 128 soft warnings.
- Protocols are 41 traits mixed into `JsonProtocols` via `extends`; spray-json implicits
  resolve through that inheritance chain, not package scope. Only 2 main files use the
  `com.helio.api.protocols._` wildcard.

## The thirteen domain names

`alerts`, `auth`, `dashboards`, `panels`, `pipelines`, `sources`, `workspace`, `hooks` (HEL-633's
original eight), plus `metrics`, `assistant`, `agents`, `proposals`, `patchsets` (design.md D1). Spelled
identically in every layer; a layer omits one only when it genuinely has no file for it.

## HEL-633's target layout (verbatim from Linear — the authority design.md defers to)

```
com/helio/
  api/
    http/         AclDirective, AuthDirectives, TraceContextDirective, CookieConfig,
                  RequestValidation, ResourceType, ResourceTypeRegistry, AccessCheckerImpl
    routes/{alerts,auth,dashboards,panels,pipelines,sources,workspace,hooks}/
    protocols/{alerts,auth,dashboards,panels,pipelines,sources,workspace,hooks}/
    ApiRoutes.scala, JsonProtocols.scala, package.scala   (composition root — stays put)
  services/{alerts,auth,dashboards,panels,pipelines,sources,workspace,hooks}/
    ServiceError.scala                                     (shared — stays at root)
  infrastructure/
    persistence/{alerts,auth,dashboards,panels,pipelines,sources,workspace}/
                  + Database, DbContext
    storage/      FileSystem, LocalFileSystem, GcsFileSystem
    crypto/       TokenHashing
    concurrency/  MdcPropagatingExecutionContext
  domain/
    model/        model.scala, Panel, DataSource, PipelineStep, pagination, package.scala
    connectors/   Connector, SqlConnector, RestApiConnector, ConnectorRegistry
    engine/       InProcessPipelineEngine, SchemaInferenceEngine, ExpressionEvaluator,
                  PipelineAnalyzeService, PipelineRowJson, AlertEventStateMachine
    util/         Clock, CronSchedule
    steps/  shapes/  panels/                               (already exist — unchanged)
```

### HEL-633's placement notes for the ambiguous files (verbatim)

* `AutoLayoutService` / `AutoLayoutRoutes` / the existing `services/layout/` → `panels`.
* `PermissionService`, `AccessChecker`, `PipelinePermissionService`, `ApiTokenService`, `SecretField` → `auth`.
* `ImageUploadService`, `PdfTextSupport`, `ContentSourceSupport`, `DataSourceCsvSupport`,
  `ImageSourceSupport`, `SchemaInferenceFacade`, `ConnectionTest` → `sources`.
* `DashboardProposalService` and `ProposalPanelSupport` → `dashboards`.
* `PipelineRunRegistry` (currently under `api/routes/`) → `pipelines`.
* `ServiceResponse` (currently under `api/routes/`) → `api/http/`.
* `IdParsing`, `PaginationProtocol`, `ResourceProtocol` → keep at `api/protocols/` root.

**Where design.md knowingly overrides the above, and why:** `domain/package.scala` stays at `domain/`
root (D5, not `domain/model/`); `DashboardProposalService`/`ProposalPanelSupport` → `proposals`, not
`dashboards` (D3); `ServiceResponse` stays at `api/routes/` root, not `api/http/` (D3). Every other line
above is followed as written.

## Scope boundary with HEL-634

- MUST update every `import` in the test tree so `sbt test` stays green.
- MUST NOT relocate or restructure test files — that is HEL-634's job.

## Acceptance criteria

- `sbt test` green; test diff limited to `package`/`import` lines.
- `git log --follow` still traces moved files (`git mv`).
- `rg 'com\.helio\.security'` returns nothing; empty `security/` package deleted.
- No file directly in `services/`, `api/routes/`, `api/protocols/`, `infrastructure/` except these
  named shared files: `services/ServiceError.scala`; `api/routes/ServiceResponse.scala` (stays put,
  overriding HEL-633's `api/http/` line — design.md D3); `api/protocols/{IdParsing,
  PaginationProtocol,ResourceProtocol}.scala`. At `api/` root: `ApiRoutes`, `JsonProtocols`,
  `package.scala`. At `domain/` root: `package.scala` (design.md D5).
  `Database.scala`/`DbContext.scala` move to `infrastructure/persistence/` root per HEL-633's layout —
  an earlier draft of this file wrongly listed them as permitted directly in `infrastructure/`
  (design.md D3 resolves the contradiction).
- A `README.md` in each newly created directory, stating what belongs there AND what does
  not, verified against the directory's actual final contents.
- No inline fully-qualified names introduced (CONTRIBUTING.md).
- Route surface and mount order unchanged; implicit resolution unchanged.
