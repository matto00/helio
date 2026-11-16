## Context

Paths are under `backend/src/main/scala/com/helio/`, facts at fd7064f7d (HEL-1639 merged). Full inventory of every
apply check, its cost, and whether propose runs it: `apply-check-inventory.md` in this change.

- `PipelineProposalService.validate` (PPS:89) = `validateStructure` + root ownership. No schema work. Apply (PPS:128)
  creates inline sources first, then `PipelineCreateWrites.checkedCreate` → `PipelineCreatePreflight.run` →
  `PipelineCreateTransaction.validateStepCrossOwnerRefs` → `createTransactional` (cycle guard, `buildOutputsAction`
  → `OutputFieldMappingCheck.validate`, the column check) → run.
- `PipelineProposalAnalyze.analyzeProposal` already computes per-node schemas and runs `OutputFieldMappingCheck`, but
  reports it as a 200 `validationError`. Nothing on the assistant/MCP propose path calls it.
- `CombinedProposalService.validate` skips layout, the sentinel count, non-sentinel panel bindings, and everything above.
- `DashboardProposalService.validate` IS apply's first step, but `PanelCreateBuilder.buildForCreate` (config decode,
  `panel.validateConfig`, binding, controls, form) runs only at apply. `buildForCreate` already writes nothing.
- Patch-set preview and apply share `PatchSetApplyResolvers.resolveAll` (HEL-1639 put the output-create column check
  there). Panel create/update service checks (`buildForCreate`, `PanelUpdateValidation`) run only at apply.
- An assistant tool `Left(msg)` already becomes `ToolResult(isError = true)` (`ClaudeClient` l.168). No client change.
- helio-mcp `propose_pipeline`/`propose_dashboard` call no backend validation; there is no validate route.

## Goals / Non-Goals

**Goals:** for each proposal kind, propose rejects exactly what apply's pre-write checks would reject, with apply's
message, by running the same functions. MCP gets the same via routes.

**Non-Goals:** dry-running the pipeline run; stale-workspace detection; patch-set step add/update and data-source
edit service checks (follow-up ticket, task 6.3); tool `input_schema` changes; `ClaudeClient`/`ClaudeProtocol`/
`ClaudeModels`; live model calls; frontend changes.

## Decisions

**D0: probe first, red first.** Before any production edit, write the failing tests of task 1 (pipeline column case
via `PipelineProposalService.validate`, combined, assistant executor) and record the red output. Re-confirm the
inventory rows this design relies on; any row that differs is reported, not silently redesigned.

**D1: pipeline dry run = apply's pre-write checks, by construction.** The dry run is `PipelineCreateDryRun` (`services/pipelines`; built as a shared class rather than the originally named `PipelineProposalDryRun`, because the patch-set resolver calls it too), reached through `PipelineProposalService.dryRun`, run by
`PipelineProposalService.validate` after `validateStructure` + ownership, and by `apply` before `resolveAllRoots`.
Steps 1-3 iterate per root in request order, all of a root's checks before the next root, as `resolveAllRoots` does,
so the first message is apply's even with several errors. In order:
1. Inline csv root → apply's exact 422 message from `resolveSource` (extract the message to one constant).
2. Inline-source create checks, extracted from the create methods into pure/metadata `validate*` functions that the
   create methods themselves call (so create and dry run cannot drift): `SourceService.createSql` pre-insert checks
   (incl. `checkConfigEgress`), `createRest` pre-insert checks (auth, connectorId xor url, `toDomain`,
   `rejectBodyOnSafeMethod`, `checkConnectorKind`, `checkConnectorPending`), `DataSourceService.createStatic`
   validation (name, row cap, tag, column types, defaults, `DatasetRowValidator`).
3. Root schemas, from the config apply persists (round-1 CR1, round-2 CR2): existing source → `ds.inferredSchema`;
   static → apply's runtime column types (`staticColumnRuntimeType`), not the declared type; sql → the same
   `SqlSourceConfigPayload.toDomain` + `CreateSourceEnvelope` inference arguments `createSql` uses, via one shared
   function; rest → ONE request composition. Extract `createRest`'s config build (url split + `queryParams` merge +
   `parameters`; connectorId branch `toDomain`) into a pure function both call. Factor the post-`resolveConnector` part
   of `RestApiConnectorDriver.buildResolvedRequest` (templating with `parameters`, `joinUrl`, ordered query merge,
   headers) into a function taking a `Connector` value; apply's resolved path calls it unchanged. The dry run feeds it
   the UNPERSISTED Auto connector `ImplicitConnectorConfig.forLegacySource` would build (url branch) or the real owned
   connector (connectorId branch), then infers through the same fetch + inference code. The ephemeral path is not
   touched (HEL-823 keeps templating off it). `analyzeProposal` is not reused for rest/sql.
4. Build the `CreatePipelineRequest` apply would build (inline roots get a placeholder source id) and run
   `PipelineCreatePreflight.run` on it.
5. `validateStepCrossOwnerRefs` (cross-owner + upsert ownership) on the steps.
6. Cycle guard: if `PipelineCycleGuard.checkExistingGraphAction` and the upsertsource step cycle check are read-only
   given a not-yet-persisted graph, run them in a read-only `db.run`; otherwise record them in the inventory as
   apply-only with the reason (do not fake them; the spec's exclusion set allows exactly this).
7. Node schemas through ONE extracted pure function (round-1 CR2), e.g.
   `PipelineCreateTransaction.outputNodeSchemas(req, rootIndices, rootSchemas, secondarySchemas)`: builds the
   `NodeStepInput`s, runs `analyzeNodes`, applies the root-bound fallback, and returns each Output's node schema.
   `createTransactional` is refactored to call it, and so is the dry run. Each Output is then checked through ONE pure
   `outputMappingProblem(spec, kind, nodeSchema)` that `buildOutputsAction` also calls. Message = apply's.
   **Disabled steps (decided: fix both together).** Today `createTransactional` omits `enabled`, so a disabled step
   projects as enabled, unlike analyze and the run (a disabled step passes its input through,
   PipelineAnalyzeService.scala:320). The shared function passes `enabled = req.enabled.getOrElse(true)`, so apply and
   dry run both match what the run produces. This is a deliberate apply behaviour fix, stated in the PR.

**Rest/sql schema fetch failure (round-1 CR3): apply's acceptance exactly.** A fetch-failed root gets an empty schema,
as at apply, and step 7 runs unchanged. Reject only where apply's column check fails. When the failing Output's node
descends from a fetch-failed root, the message is `roots[i]: could not read the source schema (<connector error>), so
fieldMapping cannot be checked` instead of apply's empty-columns message; otherwise apply's message. If step 7 passes,
the dry run passes and apply proceeds to its recorded unrunnable run, as today.

**D1b: patch-set `pipeline` create edits (round-1 CR4, included; round-2 CR1).** A patch-set pipeline create carries a
full `CreatePipelineRequest` with steps and outputs; today only root ownership + preflight run at resolve, so a
missing column passes preview and fails apply (the ticket's symptom). Its roots may be inline:
`CreatePipelineRootRequest` carries `type`/`sqlConfig`/`restConfig`/`staticConfig`, and patch-set apply resolves them
through `PipelineRootWrites.resolveOneRootSourceId`'s inline branch, whose messages differ from PPS's (e.g. "inline csv
sources are not supported for pipeline roots; ..."). So D1 steps 1-2 are parameterized by entry point: the proposal
path uses the checks extracted from `PipelineProposalService.resolveSource`/`SourceService`, the patch-set and
`POST /api/pipelines` path uses checks extracted from `PipelineRootWrites`'s inline branch, each with its own messages
and each called by its own create path. Step 3's schema builder (sourceId/static/sql/rest) is shared by both.
`PatchSetPipelineResolvers.resolvePipelineCreate` (in `resolveAll`, so preview and apply) runs steps 1-7 with the
patch-set policy. Patch-set step add/update and data-source edits stay deferred (follow-up, task 6.3).

**D2: combined.** `CombinedProposalService.validate` additionally runs `ProposalLayoutSupport.validate`, the sentinel
count statically (`combined.pipeline.outputs.size` against `resolveSentinelOutputId`'s rule, same message, by calling
that function with placeholder summaries), and `validateBindingsAndControls` for non-sentinel panels. Sentinel-bound
panels get D3's dry run in sentinel mode.

**D3: dashboard and patch-set panels.** Split `PanelCreateBuilder.buildForCreate` into the pure part (config decode
incl. `validateCreatePanelRequest`, appearance, `panel.validateConfig`) and the binding part (`rejectMissingOutput`,
`rejectMissingDataSource`, controls, `rejectInconsistentForm`); `buildForCreate` calls both, unchanged in behaviour.
`dryRunForCreate(request, user, outputBinding)` runs both, where `outputBinding` is `Real` (all checks) or
`Sentinel` (a case object, round-1 CR6): skips `rejectMissingOutput` (the Output is the one this proposal creates;
D2 checks the count), and runs controls against the proposed Output's kind/config/node schema only if task 0.2 finds
`OutputControlsValidator` can do that without a persisted Output; otherwise sentinel-panel controls are recorded
apply-only with the reason. Called per panel from `DashboardProposalService.validate` (placeholder dashboard id; the
new dashboard's access check is trivially owner), from combined validate, and from
`PatchSetPanelResolvers.resolvePanelCreate` (non-`$ref` panels: `Real`; `$ref` panels: `Sentinel` against the
referenced output create). Panel update: `PanelUpdateValidation`'s checks on the effective config at resolve time.
All patch-set calls sit in `resolveAll`, so preview and apply both run them.

**Slot eligibility.** Apply checks slot names and column existence, not slot types (`OutputBindingSpec`): nothing to mirror.

**D4: routes and MCP.** `POST /api/pipelines/validate-proposal`, `POST /api/dashboards/validate-proposal`,
`POST /api/proposals/validate` (HTTP-only: there is no MCP `propose_combined`): same auth/rate limiting as the matching apply route, body = the proposal, `200
{"valid": true}` or apply's error status and message. Schemas `schemas/proposals/proposal-validate-response.schema.json`
plus OpenAPI entries. helio-mcp `propose_pipeline` and `propose_dashboard` call the route; a rejection returns an
`isError` tool result with the backend message; success output shape unchanged (existing warnings kept). No MCP
`propose_combined` exists; MCP patch sets go through `/api/refinements` → preview, already covered by D3.

**D5: assistant.** `AssistantToolExecutor` keeps calling `validate`/`preview`; they now include the dry run. No tool
schema, description or prompt change. The HEL-700 counters already count a dry-run `Left` as a validation failure.

**D6: parity.** A corpus test (`ProposalDryRunParitySpec`, DB-backed) of >= 16 proposals spanning every check family,
each run through validate and through apply against a fresh fixture; asserts validate accepts iff apply succeeds
(excluding the run and the inventory's apply-only rows), and each rejection carries apply's message (D1's fetch
message excepted). Must include: url root with `queryParams`/`parameters`, discriminating (the `fetchOverride` stub or a local HTTP stub
records the composed request, endpoint after templating plus ordered query pairs, and the entry fails if dry run and
apply differ; mutation: drop `parameters` from the dry-run path, entry goes red); patch-set pipeline create with an
inline static root mapping an existing column (accept) and a missing one (reject); disabled step upstream of an Output; failed
root + Output on a healthy root; failed root + step-produced mapped column; patch-set pipeline create with a missing
column; sentinel panel. Shared-function proof by mutation, recorded in evidence: break `outputNodeSchemas` (and
separately `outputMappingProblem`) and show both a dry-run test and an apply test go red, then restore.

## Risks / Trade-offs

- Apply now calls the dry run first: for an inline rest/sql root the schema is fetched twice (dry run, then create).
  One extra request per apply of an inline-source proposal; acceptable for an explicit user action. Assistant and MCP
  `propose_*` now also fetch for inline rest/sql roots: added latency and egress, stated in the PR.
- Disabled-step fix (D1.7) changes acceptance for `POST /api/pipelines`, patch-set pipeline creates and proposals
  with disabled steps, toward `pipeline-step-lifecycle`'s existing contract; one direct `POST /api/pipelines`
  regression test.
- A source whose fetch result flips between the dry run and the create fetch is a stale-workspace case, not a parity
  failure.
- Moving inline-source checks into `validate*` functions touches source create paths used by REST routes. Behaviour
  preserved; existing source specs must stay green, and the extraction is a pure move.
- A propose that used to pass now fails: intended. Assistant counters will show more validation failures.

## Planner Notes

- Self-approved: three new non-breaking routes (D4), required by the ticket's MCP bullet.
- The run (rows) is not dry-runnable; stated per the driver's instruction rather than dropped.
- AC 4 (live Sleeper check) is proven only by a scripted-model replay (task 4.2); the live run is not performed per
  the driver's no-live-calls directive and is reported unmet in the PR.
