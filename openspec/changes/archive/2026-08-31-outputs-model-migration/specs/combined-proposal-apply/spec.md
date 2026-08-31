## REMOVED Requirements

### Requirement: Atomic combined apply
**Reason**: The combined proposal's "$pipelineOutput" sentinel resolves into a pipeline's newly-created output DataType id — a concept retired wholesale by decision 11. The underlying `PipelineProposalService`/`DashboardProposalService` are rewired for compile-only correctness in this ticket (see tasks.md 3.8/3.10 and design.md's proposal-service scope decision), not rebuilt as an Outputs-aware combined-apply feature.
**Migration**: P1.4 (HEL-907) rebuilds the equivalent single-call authoring surface around Outputs (decision 10: `create_pipeline` becomes a single call that can build source → steps → outputs; `place_outputs` places them on a dashboard) — this is the direct successor, not a revival of the DataType-sentinel mechanism.

### Requirement: Output-ref sentinel resolves before dashboard creation
**Reason**: The combined proposal's "$pipelineOutput" sentinel resolves into a pipeline's newly-created output DataType id — a concept retired wholesale by decision 11. The underlying `PipelineProposalService`/`DashboardProposalService` are rewired for compile-only correctness in this ticket (see tasks.md 3.8/3.10 and design.md's proposal-service scope decision), not rebuilt as an Outputs-aware combined-apply feature.
**Migration**: P1.4 (HEL-907) rebuilds the equivalent single-call authoring surface around Outputs (decision 10: `create_pipeline` becomes a single call that can build source → steps → outputs; `place_outputs` places them on a dashboard) — this is the direct successor, not a revival of the DataType-sentinel mechanism.

### Requirement: A dangling output ref creates nothing
**Reason**: The combined proposal's "$pipelineOutput" sentinel resolves into a pipeline's newly-created output DataType id — a concept retired wholesale by decision 11. The underlying `PipelineProposalService`/`DashboardProposalService` are rewired for compile-only correctness in this ticket (see tasks.md 3.8/3.10 and design.md's proposal-service scope decision), not rebuilt as an Outputs-aware combined-apply feature.
**Migration**: P1.4 (HEL-907) rebuilds the equivalent single-call authoring surface around Outputs (decision 10: `create_pipeline` becomes a single call that can build source → steps → outputs; `place_outputs` places them on a dashboard) — this is the direct successor, not a revival of the DataType-sentinel mechanism.

### Requirement: Dashboard-phase failure rolls back the pipeline and source
**Reason**: The combined proposal's "$pipelineOutput" sentinel resolves into a pipeline's newly-created output DataType id — a concept retired wholesale by decision 11. The underlying `PipelineProposalService`/`DashboardProposalService` are rewired for compile-only correctness in this ticket (see tasks.md 3.8/3.10 and design.md's proposal-service scope decision), not rebuilt as an Outputs-aware combined-apply feature.
**Migration**: P1.4 (HEL-907) rebuilds the equivalent single-call authoring surface around Outputs (decision 10: `create_pipeline` becomes a single call that can build source → steps → outputs; `place_outputs` places them on a dashboard) — this is the direct successor, not a revival of the DataType-sentinel mechanism.

### Requirement: Standalone proposal paths are unaffected
**Reason**: The combined proposal's "$pipelineOutput" sentinel resolves into a pipeline's newly-created output DataType id — a concept retired wholesale by decision 11. The underlying `PipelineProposalService`/`DashboardProposalService` are rewired for compile-only correctness in this ticket (see tasks.md 3.8/3.10 and design.md's proposal-service scope decision), not rebuilt as an Outputs-aware combined-apply feature.
**Migration**: P1.4 (HEL-907) rebuilds the equivalent single-call authoring surface around Outputs (decision 10: `create_pipeline` becomes a single call that can build source → steps → outputs; `place_outputs` places them on a dashboard) — this is the direct successor, not a revival of the DataType-sentinel mechanism.

### Requirement: Non-mutating validation of a CombinedProposal
**Reason**: The combined proposal's "$pipelineOutput" sentinel resolves into a pipeline's newly-created output DataType id — a concept retired wholesale by decision 11. The underlying `PipelineProposalService`/`DashboardProposalService` are rewired for compile-only correctness in this ticket (see tasks.md 3.8/3.10 and design.md's proposal-service scope decision), not rebuilt as an Outputs-aware combined-apply feature.
**Migration**: P1.4 (HEL-907) rebuilds the equivalent single-call authoring surface around Outputs (decision 10: `create_pipeline` becomes a single call that can build source → steps → outputs; `place_outputs` places them on a dashboard) — this is the direct successor, not a revival of the DataType-sentinel mechanism.

