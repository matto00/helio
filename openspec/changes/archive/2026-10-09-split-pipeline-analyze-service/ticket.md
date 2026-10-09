# HEL-1385: Split PipelineAnalyzeService.scala (~1190 lines) behaviour-preserving; tidy HEL-1279 nits

## Description

origin_kind: followup
origin_ticket: HEL-1279

`backend/.../domain/engine/PipelineAnalyzeService.scala` is ~1190 lines, far over CONTRIBUTING.md's split threshold.
HEL-1279 added `stepConfigProblem` there, a public wrapper over the private `validateStepConfig`. Split along its seams
(step config validation, schema inference/propagation, cost/canRun classification), keeping `stepConfigProblem` as the
shared entry point HEL-1279's auto-run gate calls.

While there, fix HEL-1279's cosmetic leftovers: unsorted imports in `AutoRunTriggerServiceSpec.scala`, and over-long
comment lines at `PipelineAnalyzeProtocol.scala:237` and `AutoRunTriggerService.scala:116`.

## Acceptance criteria

* Behaviour-preserving: analyze and auto-run specs pass with import-only changes; no wire change.
* No inline FQNs (check:scala-quality).

## Premise validation notes (orchestrator, 2026-10-09, origin/main ecaa1a53)

* File is now 1201 lines (HEL-1423 inferCompute/coalesce, HEL-1407 min/max float, HEL-1416 enum checks landed since).
* `stepConfigProblem` is now ALSO the fire-time gate's entry point (`RunConfigGate`, HEL-1384) in addition to
  dataset-write auto-run (`AutoRunTriggerService` via `StepConfigInvalidCode`) and analyze. It must remain the single
  shared entry point for both gates.
* No cost/canRun classification lives in this file (it is in `PipelineService`/`PipelineCostEstimator`/`RunConfigGate`);
  that seam is stale. Real seams: `SchemaField`; step-config validation; per-op schema inference; DAG walk.
* `AutoRunTriggerService.scala:116`'s over-long comment line is now at :122 (HEL-1384 shifted it).
