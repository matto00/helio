## Context

`AutoRunTriggerService.handleDenied` is the single point that builds `EvaluatedPipeline.Denied` for a write response; every in-scope write (`appendRows`, `appendFormRow`, `replaceRows`, `patchRow`, and the form file-submission path) obtains its denials through `DataSourceService.triggerAutoRunAwaited` -> `triggerAutoRun` -> `handleDenied`. `handleDenied` already branches on the writer: pipeline owner, editor grantee, other grantee, no grant (dropped). `DeniedPipelineResponse.fromDomain` copies `reasons` verbatim to the wire.

HEL-1661 (`PipelineAnalyzeReads.toCostVerdictResponse`) neutralizes estimator reasons for a non-owner as `CostReasonResponse(r.code, neutralDetail(r.code), r.stepId)` with `PipelineAnalyzeReads.NeutralReasonDetail` / `GenericReasonDetail`, and passes `step-config-invalid` config reasons through unchanged.

Who can receive each response today:

| Response | Route | Who can call | Who receives a denial |
|---|---|---|---|
| `RowWriteResponse` | `POST`/`PUT /api/data-sources/:id/rows` | the source's owner | writer with any grant on (or ownership of) the denied pipeline; a non-owner of the pipeline when another user's pipeline roots this writer's source and has shared it with them |
| `RowResponse` | `PATCH /api/data-sources/:id/rows/:rowId` | the source's owner | same as above |
| `FormSubmitResponse` | `POST /api/panels/:id/submit` (JSON and multipart file path) | dashboard owner or `editor` grantee (HEL-1784) | the submitter (HTTP caller, not the form owner) when they hold a grant on the denied pipeline |
| (none) | `DELETE /api/data-sources/:id/rows/:rowId` | source owner | none: `204`, no body |

## Goals / Non-Goals

**Goals:** a writer who is not the denied pipeline's owner never receives a cost figure, source kind, op name or step quote in `deniedPipelines[].reasons[].detail`; the owner's detail is unchanged.

**Non-Goals:** changing which pipelines are returned (`visible` gate), `canRun`, the log line, analyze, the client copy, or the scheduled-run `error_log` (owner-only surface).

## Decisions

**D1. Neutralize in `handleDenied`, at the domain boundary.** For the non-owner branches (editor and other grantee) build the `Denied` with reasons mapped `r => if (r.code == StepConfigInvalidCode) r else r.copy(detail = neutralDetail(r.code))`. The owner branch keeps `verdict.reasons`. This is where the writer-vs-owner decision already lives, so every response that carries a denial inherits it. Alternative rejected: neutralizing in `DeniedPipelineResponse.fromDomain` — the protocol layer does not know the writer, and would need a new field threaded through four call sites.

**D2. Reuse HEL-1661's table, do not copy it.** Call `PipelineAnalyzeReads.NeutralReasonDetail.getOrElse(code, PipelineAnalyzeReads.GenericReasonDetail)` (same package, `private[pipelines]` is visible). No new wording, so no product question: every code the estimator emits already has an owner-ruled neutral sentence. `PipelineAnalyzeReads.scala` is not edited (HEL-1799 may be editing it).

**D3. `step-config-invalid` passes through**, matching analyze: its text comes from `RunConfigGate.stepConfigReasons` -> `PipelineAnalyzeService.stepConfigProblem`, a function of the step's own configuration (which an editor/viewer grantee can already read), carrying no data size.

**D4. No shape change, so no seam test.** Field names/types are identical; `schemas/panels/form-submit-response.schema.json` and the data-source write schemas already type `detail` as a string. The web client (`denyReasonCopy`) maps by `code` and never reads `detail`. Recorded rather than adding a seam test the AC makes conditional.

## Risks / Trade-offs

- [A future estimator code with no neutral sentence leaks its detail] -> unknown codes fall back to `GenericReasonDetail`, never to the raw detail.
- [HEL-1799 renames or moves the constants] -> compile failure on rebase, caught by CI; coordinate before merge.

## Gate-Chain Implications Checklist

Not applicable: no `.husky/**` or pre-commit script is touched.
