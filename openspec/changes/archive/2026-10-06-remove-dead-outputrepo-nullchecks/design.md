## Context

Verified on main @ a5a2fa2ce (premise-validation.md). `ApiRoutes(dbContext: DbContext)` has no default and no
caller passes `dbContext = null` (26 constructions: 25 specs + `Main.scala`, all `dbContext = ctx`). The seven
services HEL-1295 touched carry `require(outputRepo != null, ...)`. Four further classes take `outputRepo` with no
default but **no** `require`, and specs still pass `null` into them:

| Class | Null branch(es) on main | Specs passing null today |
| --- | --- | --- |
| `OutputControlsValidator` | :56 `case Some(_) if outputRepo == null` | none (only `PublicDashboardRoutes`' `outputRepoOpt.orNull`) |
| `WorkspaceContextService` | :132, :308 | `WorkspaceContextService{PanelCount,ClassifySemanticRole,ComputeColumnStats,ComputeJoinHints,SanitizeSampleRows}Spec`, `AssistantToolExecutorSpec` helper |
| `WorkspaceSearchService` | :76 | `AssistantToolExecutorSpec` helper (when its `outputRepo` arg is null) |
| `PatchSetApplyContext` (resolvers :637, :774) / `PatchSetUndoService` :91 | `outputRepoUnavailable` | `PatchSetPreviewOutputContextSpec` (~:265-278), `PatchSetUndoServiceSpec` `undoServiceWithoutOutputRepo` (~:710-760+) |

## Goals / Non-Goals

**Goals:** remove every branch reachable only via a null `outputRepo`/`dbContext`; make the non-null premise
mechanical; keep production behaviour byte-identical; keep test count equal except enumerated removals.

**Non-Goals:** changing a downstream class's `Option`-typed parameter whose optionality has another cause; touching
other genuinely nullable `ApiRoutes` params (`auditEventRepo`, `mfaRepo`, `pipelineRunGuardRepo`, ...); bug fixes.

## Decisions

**D1 — Add `require(outputRepo != null, "<Class> requires an OutputRepository")`** to `OutputControlsValidator`,
`WorkspaceContextService`, `WorkspaceSearchService`, and `PatchSetApplyContext` (case-class body), mirroring
`PanelService.scala:91`. Rationale: deleting a null branch without it turns a silent degrade into a call-time NPE
in any null fixture; the `require` turns it into a construction-time failure that names the cause, exactly as
HEL-1295 did. `PatchSetUndoContext` (PatchSetUndoTypes.scala:19) is a distinct type and gets the same `require`. Alternative rejected: delete branches only (NPE).

**D2 — Remove the null branches** listed in Context, plus `PatchSetApplyContext.outputRepoUnavailable` /
`OutputRepoUnavailableMessage` once no caller remains (grep must show zero hits in `main`). Rewrite every comment
that describes the "null when no DbContext" convention at these sites (e.g. `PatchSetApplyTypes.scala:106-109`,
`WorkspaceSearchService.scala:73`, `WorkspaceContextService.scala:79-83,123-128`, `OutputControlsValidator` scaladoc).

**D3 — Fixture updates (not removals) for specs that never exercised a null branch**: pure-function workspace
specs pass `mock(classOf[OutputRepository])` (Mockito is already used, e.g. `AssistantToolExecutorSpec:84`) or a
real EmbeddedPostgres-backed repo where one is already in scope. Their assertions are unchanged. A spec that DID
reach a null branch and asserts the degraded result (e.g. empty `dataTypes`) is either re-pointed at a real repo
with no outputs (same observable result, now via the real path) or listed as removed under D6.

**D4 — `PublicDashboardRoutes(outputRepo: OutputRepository, ...)`**: required, positional slot unchanged, no
default. The `(…, Some(outputRepo), …)` match arms drop the `Option` layer; arms reachable only when the repo was
`None` are deleted. `outputControlsValidator` takes `outputRepo` directly. `pipelineRepoOpt`/`nodeSnapshotRepoOpt`
stay `Option` (non-goal). All 9 callers already pass a real repo (`Some(outputRepo)` -> `outputRepo`), so public
route behaviour is unchanged; if the executor finds any caller relying on the `None` default, it STOPS and raises
an `ESCALATION` (driver rule) rather than adapting.

**D5 — ApiRoutes.** Each of the 16 `Option(dbContext)` sites (:251, :252, :256, :259, :274, :361, :365, :392,
:444, :637, :644, :665, :678, :704, :748, plus `outputRepoOpt = Some(outputRepo)` :248) becomes a plain value:
- `Option(x).orElse(Option(dbContext).map(f))` (:256/:259) -> `Option(x).getOrElse(f(dbContext))`. The two are
  public `val`s with no external readers; dropping `Opt` would collide with the constructor params
  `outputHistoryRepo`/`nodePayloadHistoryRepo`, so name them e.g. `resolvedOutputHistoryRepo`.
- `aiStepClient` (:444): drop the `(Right(_), None)` arm; match on `claudeConfigProvider()` alone.
- Consumers: `.orNull` -> the value; `xOpt.fold(reject: Route)(f)` -> `f(x)`; `for` comprehensions binding only
  always-present values -> plain construction; comprehensions/matches also binding a genuinely optional value
  (ClaudeConfig, `alertRuleRepo`, `emailSenderOpt`, ...) keep that optional part only.
- Transitive Opts (`outputServiceOpt`, `shareTokenServiceOpt`, `connectorEntityServiceOpt`,
  `connectorCompletionServiceOpt`, ...) become plain when every input is now plain; otherwise stay `Option`.
- Where a downstream class takes an `Option` parameter (`AuthService`, `ShareTokenValidatorImpl`,
  `WorkspaceRoutes`, `DashboardAuthoringRoutes`, `RefinementRoutes`, the provenance service at ~:736, ...), pass
  `Some(x)` and leave its signature (non-goal; noted as a follow-up in the PR).
- Rewrite stale "nullable dbContext"/"fixtures that don't pass a DbContext" comments at each touched site.

**D6 — Test removals** are limited to tests asserting the null-repo state: expected candidates are the
`PatchSetPreviewOutputContextSpec` null-outputRepo case (~:264-278) and the `PatchSetUndoServiceSpec`
"`PatchSetUndoService.undo with a null outputRepo (HEL-1256)`" block (each `in` counted separately) and its
`undoServiceWithoutOutputRepo` helper, and the `WorkspaceContextServicePanelCountSpec` null-outputRepo
construction if any assertion depends on it. `PanelServiceOutputBindingSpec:184/191` (asserting `require` fires)
STAY. Each removal is listed in the PR body with its reason. Optionally (recommended) add one test per D1 class
asserting the new `require` fires, mirroring `PanelServiceOutputBindingSpec`; these count as additions.

**D7 — `PipelineService.createTransactional`**: re-indent the body to the file's 4-space method-body level,
including the inner `resolveSecondarySourceSchemas(...).flatMap { ... }` block. Whitespace only; verify with
`git diff -w` showing no change for that hunk.

**D8 — Test count evidence (design-gate note 2).** Both runs must show zero aborted suites. Before editing, run the full backend suite once on the untouched branch and record
the ScalaTest totals ("Tests: succeeded N, failed F, ..." / "Total number of tests run"); after, again. Report
`after = before - 4 + added`, with the 4 removals (1 PatchSetPreviewOutputContextSpec, 3
PatchSetUndoServiceSpec) and every addition named.

## Risks / Trade-offs

- `ApiRoutes` val-initialisation order: Scala vals initialise top-down; turning an `Opt` into a plain val must not
  move a use above its definition (comment at :437-441 documents a real instance). Keep declaration order.
- Concurrent lanes (HEL-1343 retention service) may edit `ApiRoutes` wiring (`outputHistoryRepo`/
  `nodePayloadHistoryRepo` params) -> rebase conflicts; resolve by re-applying D5 to their version, never by
  dropping their change.
- `require` in a case class body runs on `copy(...)`; there is no `copy` with a null repo in `main` (grep to confirm).

## Planner Notes

- Self-approved: D1 (`require`) extends HEL-1295's own pattern; no new dependency, API, or behaviour change.
- Self-approved: including `PatchSetUndoService:91` (same shape, not named by the ticket).
- Gate-chain: no `.husky/**` or pre-commit script is touched.
