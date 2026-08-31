## REMOVED Requirements

### Requirement: POST /api/panels/bound composes source, pipeline, run, and panel bind in one call
**Reason**: The single-call source+pipeline+run+bound-panel composition is retired with BoundPanelService; the equivalent single-call surface for the new model is the Outputs create_pipeline flow (P1.3/P1.4).
**Migration**: Use the new single-call create_pipeline (P1.3) plus place_outputs (P1.4) once those land; this ticket only removes the retired path.

### Requirement: Panel/DataType binding is validated before any resource is created
**Reason**: The single-call source+pipeline+run+bound-panel composition is retired with BoundPanelService; the equivalent single-call surface for the new model is the Outputs create_pipeline flow (P1.3/P1.4).
**Migration**: Use the new single-call create_pipeline (P1.3) plus place_outputs (P1.4) once those land; this ticket only removes the retired path.

### Requirement: A mid-chain failure names its stage and triggers compensating cleanup
**Reason**: The single-call source+pipeline+run+bound-panel composition is retired with BoundPanelService; the equivalent single-call surface for the new model is the Outputs create_pipeline flow (P1.3/P1.4).
**Migration**: Use the new single-call create_pipeline (P1.3) plus place_outputs (P1.4) once those land; this ticket only removes the retired path.

### Requirement: Every resource in the chain is owner-scoped
**Reason**: The single-call source+pipeline+run+bound-panel composition is retired with BoundPanelService; the equivalent single-call surface for the new model is the Outputs create_pipeline flow (P1.3/P1.4).
**Migration**: Use the new single-call create_pipeline (P1.3) plus place_outputs (P1.4) once those land; this ticket only removes the retired path.

