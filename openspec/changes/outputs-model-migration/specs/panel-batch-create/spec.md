## MODIFIED Requirements

### Requirement: Batch create does not build a pipeline chain

A batch item's `config.outputId` (when present) SHALL only bind to an existing, accessible Output
— identical to `POST /api/panels`'s placement rule. Batch create SHALL NOT accept inline
source/pipeline/step/output definitions; building a new pipeline or Output remains out of scope
for this endpoint.

#### Scenario: Batch item places an existing Output
- **WHEN** a batch item's `config.outputId` names an existing, accessible Output
- **THEN** the created panel is placed against that Output, exactly as a single `POST /api/panels`
  call with the same `config` would produce

#### Scenario: Batch item binds to an existing pipeline-output DataType
- **WHEN** a batch item's `config.outputId` names an existing, accessible Output (a pipeline
  output — the DataType concept it previously referenced no longer exists)
- **THEN** the created panel is placed against that Output, exactly as a single `POST /api/panels`
  call with the same `config` would produce
