## Context

`PipelineService.createTransactional` runs `validateStepCrossOwnerRefs`, then a single DBIO: `createAction` →
`buildStepsAction` → `buildOutputsAction`, inside `runTransactionally`. `buildStepsAction` folds over `req.steps` and,
per step, rejects a duplicate clientId (400), an unknown type (400), an unresolvable `parentStepId` (400), a decode
failure (400, "Invalid '<type>' config"), and an unresolvable forward lane reference (400) — each via
`DBIO.failed(PipelineCreateValidationFailure(err))`, which aborts the transaction and is unwrapped by
`.recover { case PipelineCreateValidationFailure(err) => Left(err) }`. It never calls
`PipelineStep.Companion.validateRawConfig`.

Every other write surface does, returning `ServiceError.UnprocessableEntity` (422):
`addStepReporting` (`PipelineService.scala` ~L1831, bare message), `updateStep` (~L2185, bare message),
`PipelineProposalService.validateSteps` (L296, `"step N: <msg>"`), `PatchSetApplyResolvers` step update
(L205, `"edit N: <msg>"`). `validateRawConfig` defaults to `strictDecodeProblem` (wrong-type keys for every kind) and is
overridden by compute (expression parseability, HEL-888; unknown function message
`"'x' is not a recognized function; supported functions: ..."`), aggregate (HEL-1310), cast, rename, convertformat,
upsertsource, analyzewithai, generatetext. Callers of `create`: `PipelineRoutes` (REST/MCP `create_pipeline`),
`PipelineProposalService.apply` (also the path for first-run and persona templates, after `validateSteps`), and
`PatchSetApplyForward` (patch-set pipeline-create edit — its resolver `resolvePipelineCreate` only pre-checks roots, so
step configs there are currently unvalidated too). A forward-apply failure is reported as HTTP 200 with `failure` set
and earlier edits rolled back (`PatchSetApplyService` L111-129, `PatchSetRoutes` always OK), whereas a resolve-time
`Left` is a real 4xx — patch-set step **update** edits already reject at resolve time with 422
(`PatchSetApplyResolvers` L204-207); step **create** edits (`resolvePipelineStepCreate`) do not.

## Goals / Non-Goals

**Goals:** single-call create rejects exactly what the step routes reject, for every kind, 422, atomically; red-first
test per newly validated path; prove helio-news and server-generated configs unaffected.

**Non-Goals:** read/analyze changes; validating `duplicateStep` (copies a stored config; undo/rollback already validate
via `addStep`/`updateStep`); resolve-time validation of patch-set step **create** edits; changing other surfaces'
messages.

## Decisions

1. **Validate inside `buildStepsAction`'s fold, after the type check, before `PipelineStepConfigCodec.decode`.** This
   mirrors `addStepReporting`'s order exactly (type → `validateRawConfig` → decode), so the 400-vs-422 split is the
   same on both surfaces: malformed/undecodable stays 400 (strictDecodeProblem returns `None` for non-type-mismatch
   decode failures by design), "understood and refused" is 422. One site covers every kind and every caller of
   `create` (REST, MCP, proposal apply, patch-set pipeline-create). Alternative — a pre-transaction pass in
   `createTransactional` — would fail earlier (before the cross-owner DB lookups) but splits step validation across two
   places with different ordering relative to the duplicate/type checks; rejected for single-site clarity.
2. **Status 422, message `s"Step '${spec.clientId}': $msg"`.** 422 matches `pipeline-step-config-rejection` and every
   existing `validateRawConfig` surface (the ticket's "400" is stale — see premise-validation.md). The `Step '<id>'`
   prefix matches `buildStepsAction`'s own existing messages (a create request names steps by clientId, like the
   proposal's `step N:` and patch-set's `edit N:` prefixes). The `$msg` body is the companion's message verbatim, so
   the function name + supported list reach the caller unchanged.
3. **No change to `PipelineProposalService.validateSteps`.** It already rejects first with its own prefix; apply's
   subsequent `create` call now re-checks (defence in depth), never reached for a config validate already refused.
4. **`resolvePipelineCreate` also validates the edit's inline steps (skeptic-design-1 CR1, option b).** For each step
   of the decoded `CreatePipelineRequest`, run the same companion `validateRawConfig` (after its existing roots
   pre-check, only for steps whose type is a registered kind) and return
   `Left(UnprocessableEntity(s"edit $index: Step '${clientId}': $msg"))` on the first problem. This keeps patch-set
   behavior consistent with its step **update** edits (resolve-time 422, nothing applied) instead of a
   200-with-`failure`. Because `PatchSetPreviewService.preview` uses the same `resolveAll`, `/api/patch-sets/preview`
   also returns 422 for such an edit; the refinement service and the assistant's `propose_patch_set` tool already
   relay preview errors to the model as a message — acceptable, same as step-update behavior today.
   Apply-time `create` still checks (decision 1) as the authoritative backstop. Extract one small shared helper
   (e.g. `PipelineStep.rawConfigProblem(kind, config): Option[String]`, or a private helper reused by both sites) only
   if it avoids duplicating the `companionFor(...).toOption.flatMap(...)` idiom awkwardly; either is acceptable.
5. **Server-generated steps — non-regression pin only.** First-run/persona templates already pass `validateSteps`
   before `create`, and shape expansion writes through `addStep`; none is newly exposed. A spec still pins that every
   shape's and `FirstRunPlanner`'s generated configs pass `validateRawConfig`, so a future generator change cannot
   start failing create silently; any rejection found is a BLOCKER to report.
6. **helio-news compatibility (C4).** A backend spec SHALL feed helio-news' literal configs — `filter`
   `{combinator:"AND", conditions:[{field,operator:"=",value:"true"}]}`, `aggregate`
   `{groupBy:[], aggregations:[{alias,field,fn:"count"}]}` and `{groupBy:[{name,type}], aggregations:[{...,fn:"avg"}]}`,
   `sort` `{sortBy:[{direction,field}]}`, `select` `{fields:[...]}` — through `validateRawConfig` and assert `None`.
   Its shape-pipeline calls (`build_shape_pipeline`) create a bare pipeline then add steps via `addStep` (already
   validated), so they never reach the create-path change. The executor
   SHALL re-grep helio-news (read-only) for any other step config before relying on this list.
7. **Docs.** If `schemas/`, the OpenAPI spec under `openspec/`, `docs/agent-native.md`, or `helio-mcp` tool
   descriptions enumerate `POST /api/pipelines` error statuses, add 422; if none do, record "no doc change" in
   tasks.md with the grep used.

## Risks / Trade-offs

- **Newly rejected client payloads.** Any client that relied on create accepting a config the step routes reject now
  gets 422. That is the intended fix; helio-news is proven unaffected (decision 6).
- **Server-generated config rejected** → would break shapes/first-run. Mitigated by decision 5's spec, red if any fail.
- **Legacy rows.** No read path touched; a test pins list + analyze on a directly-inserted invalid compute row.

## Planner Notes

- Self-approved: 422 over the ticket's literal 400 (consistency with every existing surface, AC's stated intent).
- Self-approved: `duplicateStep` stays unvalidated (copies stored state). Undo/rollback already validate (unchanged).
- Self-approved: patch-set step **create** edits keep today's behavior — no resolve-time check
  (`resolvePipelineStepCreate` L709-730); an invalid one is caught by `addStep` at forward apply → HTTP 200 with
  `failure`, edits rolled back. Outside this ticket's AC; listed as a follow-up candidate in the final report.
- Existing backend tests whose fixtures carry configs that become rejected on single-call create are a question
  (fixture wrong vs. code wrong), never a silent fixture edit — each such edit is justified in the commit/evidence (C6).
- Red-first (C3) applies to the two newly validated paths: single-call create (compute/cast/aggregate) and patch-set
  pipeline-create resolve. Each must be shown failing on base before the fix. Proposal apply is already rejected by
  `validateSteps`, so its test is a labelled regression pin, not a red-first proof.
- Not done: a MODIFIED delta to the existing compute-expression requirement's surface list; the ADDED requirement
  covers single-call create for every kind (skeptic-design-1 non-blocking note).
