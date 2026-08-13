# HEL-387: Combined source + pipeline + dashboard end-to-end proposal

## Description

"Build me a dashboard from this CSV" requires creating the whole chain in one reviewable, atomic act: a data source, a pipeline that produces a bindable output DataType, and a dashboard whose panels bind to that brand-new type. Today the dashboard proposal (`DashboardProposal`) can only reference a **pre-existing** pipeline-output DataType by id (`preValidateBindings` in `DashboardProposalService` rejects anything else), and the pipeline apply path (HEL-342 atomic-apply ticket) produces a type but doesn't build panels. Neither alone closes the loop.

This ticket adds a combined proposal that stitches the pipeline-proposal apply and the dashboard-proposal apply into one atomic transaction, resolving the newly-minted output DataType id into the dashboard's panel bindings before they are created.

Touches: new combined protocol/schema, a new orchestration service composing `PipelineProposalService` (HEL-342) + `DashboardProposalService`, a route (e.g. `POST /api/proposals/apply` or `POST /api/dashboards/apply-full-proposal`) wired in `api/ApiRoutes.scala`, and MCP + frontend surfaces.

## Scope

* schemas: a combined proposal schema `{ pipeline: PipelineProposal (or reference), dashboard: DashboardProposal }` where dashboard panels may bind by a symbolic reference to the pipeline's output type (e.g. `outputRef`) resolved to the real id at apply time — since the id doesn't exist until the pipeline is applied.
* Backend Scala: an orchestration service that applies the pipeline proposal first, captures the created output DataType id, substitutes it into the dashboard proposal's panel bindings, then applies the dashboard proposal — the WHOLE thing atomic (roll back the pipeline+source if the dashboard step fails, reusing each sub-service's existing rollback). Compose the two existing proposal services; no new persistence. No fully-qualified names inline.
* Backend Scala: endpoint returning created source/pipeline/output-type + dashboard + panels.
* MCP TS + frontend: expose the combined flow (MCP tool; the in-app path can reuse it once HEL-341 authoring lands — link, don't block).
* Tests: ScalaTest end-to-end (CSV/static source → pipeline → run → dashboard with a panel bound to the new type, all created); dashboard-step failure rolls back the pipeline+source too (no orphans); symbolic output-ref resolves correctly.

## Acceptance criteria

- [ ] A single request creates source+pipeline+run+dashboard+panels atomically; panels bind to the newly-created output DataType via a resolved symbolic reference.
- [ ] Failure in the dashboard phase rolls back the pipeline + source (no orphaned data-layer resources) — verified by test.
- [ ] Reuses `PipelineProposalService` + `DashboardProposalService` (no duplicated create/rollback logic); RLS + V41 enforced throughout.
- [ ] Output-ref resolution is validated: an unresolved/dangling ref is a 400 that creates nothing.
- [ ] MCP tool added; `sbt test` + MCP tests green.
- [ ] Backward-compat: additive; the standalone dashboard and pipeline proposal paths remain unchanged.

## Out of scope

* NL authoring of the combined proposal (HEL-341 / Claude wiring) — this is the deterministic apply path only.
* Multi-pipeline / multi-source proposals (single source+pipeline+dashboard for this ticket).

## Dependencies

* Depends on the HEL-342 pipeline-proposal schema + atomic-apply tickets and the existing `DashboardProposalService`. Related to HEL-341 (in-app authoring may drive this) and HEL-365.
