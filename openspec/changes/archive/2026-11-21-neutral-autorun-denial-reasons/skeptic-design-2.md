## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed at HEAD 0fac82ce38ee0c391f8473fb4b3bb58d87fb5c7a. The planning artifacts in the change dir are untracked. I judged the current ticket.md, proposal.md, design.md, tasks.md and specs/dataset-write-auto-run/spec.md against the code, not against round 1's narrative.

### What I verified (with evidence)

- **D1 boundary.** `AutoRunTriggerService.handleDenied` (AutoRunTriggerService.scala:124-151) builds every `EvaluatedPipeline.Denied`. It has three branches: owner (:142), editor grant (:145) and other grant (:146). All three pass `verdict.reasons` verbatim. The log line (:132-136) reads `verdict.reasons` before the branch, so "log unchanged" is naturally preserved. `hasConfigReason` (:131) is computed from the original reasons, and tasks 1.3 explicitly keeps `canRun` on them.
- **D2 table reuse.** `PipelineAnalyzeReads` is `private[pipelines]` (PipelineAnalyzeReads.scala:322), in the same package as `AutoRunTriggerService`. `NeutralReasonDetail` (:329-340) covers all ten codes. The rows/steps codes come from PipelineCostEstimator.scala:96-104, and the other eight were confirmed in round 1 and are unchanged. `GenericReasonDetail` (:342) is the fallback. No neutral sentence contains a digit, so the "no digit of the count or threshold" assertion can be satisfied.
- **D3 pass-through matches analyze.** `RunConfigGate.scala:21` builds the `step-config-invalid` reason from the step config. Analyze's non-owner path (`nonOwnerValidationError`, PipelineAnalyzeReads.scala:233-238) returns the same `stepConfigProblem` text unchanged.
- **No other leaking field on `Denied`.** `Denied` carries `pipelineId`, `name`, `reasons` and `canRun` only. There is no `estimatedRows`, unlike analyze, which also had to neutralize `estimatedRows`. So the reason details are the whole leak surface.
- **Round 1 CR1 and CR2 are resolved.** tasks 1.1 now names `FormSubmitEditorRlsSpec`. I confirmed that spec wires a real `AutoRunTriggerService` into `DataSourceService` (FormSubmitEditorRlsSpec.scala:114, :118). `findLastRunRowCountInternal` and `findGrantRole` both run in system context (PipelineRepository.scala:143-146, :194-204), so a seeded `last_run_row_count` above 10000 and a seeded pipeline grant take effect under the NOBYPASSRLS harness. The existing `seed()` adds a dashboard grant only (:156), and tasks 1.1 explicitly requires adding the editor's pipeline grant. tasks 1.1 also requires asserting that `deniedPipelines` is non-empty with the expected code before the no-digit check, and it requires a recorded red showing the raw `Estimated N rows exceeds ...` detail. That closes the vacuous-red path.
- **Round 1 non-blocking notes are folded in.** 1.3 now asks for a pure mapping function with a direct unknown-code-to-generic unit test. 2.2 adds three mutations, one per branch decision.
- **AC coverage.** AC1 is covered by 1.1 and 2.2(b). AC2 is covered by 1.2 and 2.2(a). AC3 is conditional on a shape change, and D4 records that there is none, which I confirmed: the schema types `detail` as a string and the client renders by code (round 1 evidence, unchanged code paths).
- **Spec delta does not contradict the base spec.** The base `dataset-write-auto-run` spec (openspec/specs/dataset-write-auto-run/spec.md:36-130) requires "denial reason(s)" to reach visible writers. Codes and `stepId` are kept, and only grantee `detail` text changes. An ADDED requirement is consistent with that.

### Verdict: CONFIRM

### Non-blocking notes

- 1.1's `steps-above-bound` case needs 21 enabled steps. If they are seeded with minimal or invalid configs, `step-config-invalid` reasons (pass-through text) or `unclassified-op` reasons may appear alongside. Scope the no-digit assertion to the estimator reasons, or use valid allow-listed ops, so a pass-through config message cannot confuse the check.
- 1.1 is service-level (`PanelService.submitForm`), not route-level. That is acceptable, because `DeniedPipelineResponse.fromDomain` copies `detail` verbatim and is already covered by `RowWriteResponseDenyReasonCoverageSpec`. The executor should say this explicitly in the evidence.
- After HEL-1799 lands, recheck that `NeutralReasonDetail` and `GenericReasonDetail` keep their names and their `private[pipelines]` visibility (design Risks already lists this).
