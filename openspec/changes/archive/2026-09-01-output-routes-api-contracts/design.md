## Context

P1.1 (`outputs`, `node_snapshots`, `parent_step_id`, `OutputBindingSpec`/`OutputPanel`/
`OutputContract`/`OutputRepository`) and P1.2 (tree-walk engine, per-node execution, per-Output
dry-run previews) are merged. No HTTP route reads/writes `OutputRepository` yet. `ApiRoutes.scala`
composes routes by instantiating a `*Routes` class per resource and wiring it into a `pathPrefix`
tree (see `outputRepoOpt` at `ApiRoutes.scala:182`, already present as a repo handle). Panels
already support `type: "output"` with `config.outputId` (HEL-904 task 3.6) — no schema change
needed there. `PipelineAnalyzeService` currently walks only the pipeline's single terminal step
(P1.2 left per-node trunk+tail projection as task 6.4, this ticket's job).

## Goals / Non-Goals

**Goals:** add the Output route surface; extend pipeline creation to a single transactional call;
add capabilities-at-node backed by real per-node schema projection; remove the last
DataType/Metric/panel-binding leftovers from `ApiRoutes.scala` and specs; keep the P1.3/P1.4 schema
split (`check-schema-drift.mjs`'s proposal/patch-set pair) untouched.

**Non-Goals:** helio-mcp tool wiring (P1.4), frontend consumption (P1.5/P1.6), full public-path RLS
smoke and export/import version-bump reshape (P1.7) — this ticket only rewires
`PublicDashboardRoutes` enough to compile and return rows.

## Decisions

**D1 — `OutputRoutes` is a new `*Routes` class, mounted the same way as `PanelRoutes`.** Follows
the existing thin-shell pattern (`PanelRoutes.scala`): HTTP shape only, all ACL/validation in a new
`OutputService`. Alternative considered: fold Output routes into `PipelineRoutes` — rejected,
Outputs are also addressed directly by id (`/api/outputs/:id`), independent of any pipeline
sub-path, mirroring how `PanelRoutes` isn't nested under `DashboardRoutes`.

**D2 — Field-mapping slot eligibility reuses `OutputBindingSpec`/`SlotEligibility` unchanged.**
Already built by P1.1 for exactly this purpose (`OutputBindingSpec.scala`); the capabilities route
is a thin evaluator over it against a projected schema, not a new eligibility model.

**D3 — RATIFIED (cycle 5, coordinator ruling): single-call `create_pipeline` composes one real
Slick `DBIO` transaction across three repositories, not a saga/compensating-transaction pattern.**
This is option (iii) from the design discussion, as actually shipped: `PipelineRepository`,
`PipelineStepRepository` and `OutputRepository` each expose a `DBIO`-returning `*Action` method
(`createAction`/`insertInternalAction`/`insertInternalAction`) alongside their pre-existing
`Future`-returning method, which now simply delegates to the `DBIO` version so there remains one
definition of each insert, not two. `PipelineService.createTransactional` composes all three in a
single `for`-comprehension over `DBIO`, and runs the composed action through
`PipelineRepository.runTransactionally` (`ctx.withSystemContext(action.transactionally)` —
`privilegedDb.run(action.transactionally)`), which is one `db.run`, one transaction, spanning all
three repositories. The pre-existing simple-create shape (`req.steps.isEmpty && req.outputs.isEmpty`)
is untouched and still calls `pipelineRepo.create` directly.

The compensating-delete pattern from an earlier cycle (best-effort delete of the partially-created
pipeline row on a later-step failure, with the delete's own result silently discarded) was
**deleted outright, not left alongside the new implementation** — a real transaction has no
compensation step to fail, so the silent-partial-state hole that pattern carried is structurally
gone rather than patched over. Verified via mutation testing: splitting the composed `DBIO` into
two separate top-level `db.run`/`runTransactionally` calls (rather than one call over the composed
chain) reproduces a real partial write — the pipeline row commits before a later step's build
fails — and the rollback test (`PipelineCreateTransactionalSpec`, asserting via a raw-SQL row count
on the privileged connection, bypassing the repository-layer ACL path entirely) catches it.

**RLS posture — RESOLVED cycle 7 by empirical experiment, superseding cycle 6's analytical
ruling.** Cycle 6 kept `runTransactionally` on `ctx.withSystemContext` (the RLS-bypassing
privileged pool) reasoning analytically that `PipelineStepRepository.insertInternalAction`/
`OutputRepository.insertInternalAction` being `internal`/system-context-only methods, combined
with `DBIO.transactionally` requiring every action in a composed chain to run against the SAME
`Database` handle, made `withUserContext` infeasible for the composed action. The coordinator
asked for that reasoning to actually be tested rather than assumed. It was tested this cycle
(`PipelineRepositoryRunTransactionallyRlsSpec`, a real non-superuser RLS-enforced app-pool
role — not the superuser-both-pools fixture `PipelineCreateTransactionalSpec` uses, which never
exercises RLS) and the **observed result is that it works unmodified**: `pipeline_steps_owner`'s
`USING` clause and `outputs_insert`'s `WITH CHECK` clause both key off
`current_setting('app.current_user_id')`/`owner_id`, and every row this composed chain writes
(the pipeline row, the step, the Output) is stamped with the SAME authenticated user id
`withUserContext` sets that session variable to — there is no cross-user write anywhere in this
specific composition, so the RLS check that would normally reject a mismatched
`*Internal`-method caller never fires here. `runTransactionally`/`createTransactional` are now on
`ctx.withUserContext(user.id)` — atomicity AND RLS enforcement together, with no bypass and no
bypass-justification comment needed. The earlier analytical concern (composing an
`internal`/system-context-only method under the app pool) turned out not to be a real constraint
for this specific write shape; it would still be worth re-checking if a future composed action
in this chain ever writes a row NOT owned by the calling user.

**D4 — Per-node schema projection (task 6.4) computes one projection per node (trunk-final-step +
each tail-final-step), not per every step.** `capabilities?stepId=` only ever asks about a
specific existing step's output; intermediate-step projections already exist as `analyze`'s
per-step `outputSchema` — task 6.4 only needed to ALSO project at tail endpoints, which `analyze`
was skipping. Reuses the existing per-step schema-inference machinery, walked over tails too,
rather than adding a second inference codepath.

**D5 — Canonical `DataFieldType` enforcement is fixed at the two known emission points** (
`PipelineAnalyzeService.aggResultType`'s `sum`/`avg`, and the `running_sum` case), verified by an
exhaustive grep enumeration of every producer of a field-type string (per the "position" lesson —
classify the whole class, not one instance) before declaring AC 3 (HEL-895 AC 5) satisfied.

**D6 — `panel-query-model` capability is REMOVED, not left dormant.** The route it specified
(`GET /api/panels/:id/query`) was already deleted by HEL-904 task 4.1; leaving the spec in place
would leave a capability describing a route that returns 404, failing HEL-910's eventual sweep for
exactly this kind of stale-but-undocumented removal.

**D7 — `inferredSchema` is added to `DataSourceResponse` (the list/get shape), not to
`CreateSourceResponse` (already has it since before this ticket).** Grep confirms
`CreateSourceResponse.inferredSchema: Option[InferredSchemaResponse]` already exists
(`DataSourceProtocol.scala:186`); the gap is that `GET/POST /api/data-sources` and
`GET /api/data-sources/:id` return the base `DataSourceResponse` ADT, which has no such field. No
`schemas/sources/` directory exists at all today — this ticket adds one
(`schemas/sources/data-source.schema.json`) covering `DataSourceResponse` with `inferredSchema`,
reusing the same field shape as `CreateSourceResponse`'s existing `InferredSchemaResponse`. This is
strictly additive to `com.helio.api.protocols.sources.DataSourceProtocol` — it does not touch
`schemas/patch-sets/**` or `schemas/pipelines/pipeline-proposal.schema.json` (P1.4-owned).

**D8 — Panel-layout defaults (decision 15) live in a new `PanelLayoutDefaults` object in
`PanelService`, keyed by panel kind/type, and are applied inside the same Slick transaction as the
panel insert.** `POST /api/panels` currently only inserts the panel row (`PanelRoutes.scala`
delegates entirely to `PanelService.create`); this decision adds a second write — appending a
computed layout item to `dashboards.layout` — inside that same `create` call's transaction, so a
failure on either side rolls back both. The response shape gains a `layoutItem` field (the placed
`{ x, y, w, h }` for the created panel) alongside the existing `PanelResponse`. Rejected alternative:
compute defaults client-side (what P1.5/P1.6 do today) — decision 15 explicitly moves this
server-side so there is one source of truth, not two constants files that can drift.

**D9 — `POST /api/pipelines/:id/validate-expression?stepId=` is new, not a rename.** Grep confirms
no backend route named `validate-expression` exists anywhere today (the frontend's
`dataTypeService.ts:51` call to `/api/types/:typeId/validate-expression` is dead — its backend
route was deleted along with `DataTypeRoutes` in P1.1 and never replaced). This ticket adds the
pipeline/node-scoped replacement, delegating to the same `ExpressionEvaluator.validate` the
pipeline engine already uses (`PipelineAnalyzeService.scala:296`) rather than a new validator.

**D10 — HEL-877 (partial-merge PATCH for `chart.legend`/`tooltip`/`seriesColors`/`axisLabels`) and
HEL-876 (Output `config.format` number formatting) are folded into the `output-routes-api`
capability's `PATCH /api/outputs/:id` requirement, not a separate capability.** Both are about the
shape and merge semantics of Output config, which is exactly what `PATCH /api/outputs/:id` owns
post-remodel (this data used to live on panel `appearance`; it now lives on `outputs.config`).

**D11 — explicit, justified divergence from governing-spec line 144 on the export/import version
bump: deferred to P1.7 in full (bump + reshape together), not split.** The ticket's own Contracts
section and governing-spec line 144 both place the `CurrentVersion` bump inside P1.3, but a version
bump exists to signal an incompatible payload-shape change (`DashboardServiceValidation`'s
unsupported-version rejection) — bumping the number here with no accompanying shape change would
reject every existing `version: 2` export/import payload for no functional reason, since the
snapshot's panel/layout shape does not change until P1.7 actually represents Output-backed panels
in the snapshot. Bumping now and reshaping later would force a second bump immediately after,
double-breaking import compatibility for zero benefit in between. This ticket therefore leaves
`CurrentVersion = 2` unchanged and defers the bump to land atomically with the P1.7 reshape it
exists to gate.

**D12 — AC-3's mechanism (boundary validation + schema enums + a runtime `SchemaField`
constructor guard) is deliberately NOT the compiler-enforced typed-`DataFieldType` refactor.**
That refactor (`SchemaField.type`/`DataField.dataType` becoming a typed `DataFieldType` rather than
a plain `String`, across ~31 construction sites) is real, separately-scoped work — filed as
**HEL-931**. The 12 already-persisted `data_sources` rows found carrying a non-canonical `"number"`
type during this ticket's dev-DB check are a data-hygiene fix, not a code fix — filed as
**HEL-932**.

**D13 — P1.3b carries the four route/contract items this ticket ran out of runway for**:
`DataSource.inferredSchema` on `DataSourceResponse` (task 3.10 + the `schemas/sources/` schema),
decision-15 server-owned panel-layout defaults (task 2.7), Output `config.format` number
formatting for HEL-876 (task 2.3b), and the one remaining Output response schema
(`output-capabilities-response`, backing task 3.4 -- `preview-outputs-response` shipped in THIS
ticket as `schemas/pipelines/pipeline-preview-response.schema.json`, cycle 10, once task 3.7 was
completed; it is no longer part of P1.3b). None of the four block P1.4/P1.5/P1.6 the way
`GET /api/outputs/:id/rows` and `POST /api/pipelines/:id/preview` did (both of which shipped in
this ticket instead), which is why they were the ones split out rather than those two. P1.3b
blocks HEL-910 (P1.7's final sweep should not run with these outstanding). Filed as **HEL-933**.

**D14 — the `pipeline-shapes/:id/expand` envelope change (task 3.8, BREAKING) shipped in this
ticket rather than moving to P1.3b, despite an earlier intent to isolate it for review.** It was
finished, every existing `PipelineShapeRoutesSpec`/`ApiRoutesSpec` assertion was updated, and
nothing was left red — reverting working, fully-tested code to satisfy a reviewability preference
formed when the item was still unstarted would have been pure waste. Its consumers (frontend,
e2e, helio-mcp) still expect the old bare-array response and are now stale; filed as **HEL-934**,
cross-referenced to HEL-907 (P1.4, rewrites the helio-mcp side) and HEL-908 (P1.5,
rewrites the pipeline page), since those two rows will absorb most of the fix as part of their own
work. This is acceptable per the governing spec's decision 17: `main` may be knowingly
non-functional as a web app between P1.3 and P1.6, since deploys fire only on `v*` tags and no tag
is cut until P1.7.

## Risks / Trade-offs

- [Single big transaction for `create_pipeline` could be slow/lock-heavy for a pipeline with many
  steps+Outputs] → bounded by realistic UI-driven payload sizes (a handful of steps/Outputs per
  call); no batch-import use case in scope here.
- [Rewiring `PublicDashboardRoutes` off `findLastRunAtByOutputDataTypeId` touches a public,
  unauthenticated route] → keep the change minimal (swap the lookup path only), full RLS smoke
  deferred to P1.7 as the ticket's Out-of-scope section states explicitly.
- [Removing `panel-query-model` requirements without a replacement route could look like silent
  data loss] → REMOVED delta each name a **Migration** (Output rows via `GET /api/outputs/:id/rows`)
  so the archive trail is explicit, matching CLAUDE.md's "no `@deprecated`, alias, or shim" AC.

## Gate-Chain Implications Checklist

N/A — this change does not touch `.husky/**` or any script a pre-commit hook invokes; it is
backend routes/services/schemas/openspec only.

## Migration Plan

No new Flyway migration needed — `outputs`/`node_snapshots` tables already exist from HEL-904's
V94 migration. This ticket is routes/services/schemas only. Rollback is a plain revert (no new
persisted state format is introduced).
