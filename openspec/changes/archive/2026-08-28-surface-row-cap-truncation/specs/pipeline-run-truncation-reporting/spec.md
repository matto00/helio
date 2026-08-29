## Purpose
Defines how a pipeline run detects that its source read was capped by the run row limit, and what every caller-facing surface — the run-result API body, the MCP `run_pipeline` tool, the pipeline detail UI, and REST source creation — must report so that a truncated result is never mistaken for a complete one.

## ADDED Requirements

### Requirement: The run row cap is reported, never silently applied
A pipeline run SHALL report whether its primary source read was truncated by the engine's run row cap. The cap value itself SHALL NOT be changed, raised, or made configurable by this capability — the cap is a memory bound and remains in force; only its visibility changes.

A run that was truncated SHALL be distinguishable from a run that was not, at every surface listed in this capability, without the caller inspecting row counts and inferring.

`sourceTruncated` SHALL be true when **any** source read performed by the run was truncated, including a secondary source read by a `join`, `union` or `lookup` step. The run SHALL NOT report `sourceTruncated: false` when a secondary source was truncated — reporting completeness the run cannot support is a worse failure than reporting nothing.

`sourceAvailableRowCount` SHALL describe the **primary** source only, and its documentation SHALL say so. Per-source detail SHALL be carried by `truncatedReads`, one entry per truncated read, each naming the data source, the rows read, and the available total when one was measured.

#### Scenario: A source larger than the cap reports truncation
- **WHEN** a pipeline runs over a REST source whose response contains 3303 rows and the run row cap is 1000
- **THEN** the run result reports `sourceTruncated: true`, `sourceAvailableRowCount: 3303`, and `sourceRowCount: 1000`

#### Scenario: A source smaller than the cap reports no truncation
- **WHEN** a pipeline runs over a source containing 250 rows
- **THEN** the run result reports `sourceTruncated: false` and omits `truncationNotice`

#### Scenario: A source exactly at the cap is not reported as truncated
- **WHEN** a pipeline runs over a source containing exactly as many rows as the run row cap
- **THEN** the run result reports `sourceTruncated: false` — the cap being reached is not by itself evidence that rows were discarded

#### Scenario: A truncated union right-hand source is reported
- **WHEN** a pipeline's `union` step reads a secondary source larger than the run row cap, while the primary source is under the cap
- **THEN** the run result reports `sourceTruncated: true` and `truncatedReads` contains an entry naming that secondary source

#### Scenario: A truncated join or lookup source is reported
- **WHEN** a pipeline's `join` or `lookup` step reads a secondary source larger than the run row cap
- **THEN** the run result reports `sourceTruncated: true` rather than `false`

#### Scenario: The run row cap is unchanged
- **WHEN** this capability is implemented
- **THEN** `InProcessPipelineEngine.maxRunRows` is still `1000`

### Requirement: A connector reports an available-row count only when it measured one
A connector SHALL report an available-row count only when that count was actually observed. A connector that can prove truncation without knowing the total SHALL report truncation with **no** available-row count rather than reporting an inferred, estimated, or saturation-derived number.

#### Scenario: REST reports an exact available-row count
- **WHEN** a REST connector parses a response body into N rows and returns the first `maxRows` of them
- **THEN** it reports `availableRowCount = Some(N)` and `truncated = N > maxRows`

#### Scenario: SQL proves truncation without claiming a total
- **WHEN** a SQL connector is asked for `maxRows` rows and the database returns more than `maxRows` rows to its `maxRows + 1` probe
- **THEN** it reports `truncated = true` and `availableRowCount = None`, and returns exactly `maxRows` rows

#### Scenario: SQL returning fewer than the probe size is complete
- **WHEN** a SQL connector's `maxRows + 1` probe returns `maxRows` or fewer rows
- **THEN** it reports `truncated = false`

#### Scenario: Uncapped source kinds never report truncation
- **WHEN** a pipeline runs over a static, CSV, text, PDF, or image source
- **THEN** the run reports `sourceTruncated: false` and no available-row count — the engine applies no run row cap to these kinds

### Requirement: The truncation notice states the consequence, not just the fact
When a run was truncated, the run result SHALL carry a human- and agent-readable `truncationNotice` composed server-side. The notice SHALL state how many rows were read, SHALL state the available total when one was measured, SHALL explicitly say the total is not known when none was measured, and SHALL state that results derived from the run describe only the partial population.

The notice SHALL interpolate the cap value from the engine's configured cap rather than embedding a literal, so the message cannot desynchronise from the behaviour.

A notice that reports truncation without saying how many rows were read does not satisfy this requirement.

#### Scenario: Notice when the total is known
- **WHEN** a run read 1000 of 3303 available rows
- **THEN** `truncationNotice` names both 1000 and 3303, names the 1000-row run cap, and states that filters, sorts, and aggregates from this run describe only the partial population

#### Scenario: Notice when the total is unknown
- **WHEN** a run read 1000 rows from a SQL source proven to have more
- **THEN** `truncationNotice` names 1000, states that more rows exist and that the total is not known, and does not name any number as the available total

#### Scenario: No notice on a complete run
- **WHEN** a run was not truncated
- **THEN** `truncationNotice` is absent from the response body

### Requirement: Truncation is visible at the MCP surface
The MCP `run_pipeline` tool result SHALL carry the truncation flag, the available-row count when known, and the truncation notice. The tool's own description SHALL describe the returned truncation fields rather than promising an unqualified row count.

An agent reading only the tool result, without access to the raw HTTP body, SHALL be able to tell a truncated run from a complete one.

#### Scenario: MCP result distinguishes a truncated run
- **WHEN** an agent calls `run_pipeline` on a pipeline whose source exceeds the cap
- **THEN** the returned object carries `truncated: true`, the available-row count, and the notice text

#### Scenario: MCP result on a complete run carries no truncation claim
- **WHEN** an agent calls `run_pipeline` on a pipeline whose source is under the cap
- **THEN** the returned object carries `truncated: false` and no notice

### Requirement: Truncation is visible in the pipeline UI
The pipeline detail UI SHALL display a warning when the most recent run was truncated, rendering the server-composed notice, and SHALL display nothing when the run was not truncated. The warning SHALL be visible without the user opening a raw response or a developer tool.

#### Scenario: Warning shown after a truncated run
- **WHEN** a user runs a pipeline whose source exceeds the cap
- **THEN** a truncation warning naming the rows read and the available total is visible on the pipeline detail page

#### Scenario: No warning after a complete run
- **WHEN** a user runs a pipeline whose source is under the cap
- **THEN** no truncation warning is rendered

### Requirement: Source creation warns that runs will be truncated
When a source is created and schema inference actually observed more rows than the run row cap, the create response SHALL carry a `rowCapNotice` advising that runs over this source will read only the first `maxRunRows` rows. This is a forward-looking advisory about run behaviour; source creation itself applies no run row cap.

The observed row count SHALL be carried out of inference on the existing inference result rather than obtained by issuing a second fetch. A connector kind whose inference cannot observe the true row count SHALL report no observed count, and SHALL therefore emit no advisory rather than a guess.

#### Scenario: REST creation over a large source advises
- **WHEN** a REST source is created and inference observes 3303 rows
- **THEN** the create response carries a `rowCapNotice` naming 3303 and the 1000-row run cap

#### Scenario: REST creation under the cap is silent
- **WHEN** a REST source is created and inference observes 250 rows
- **THEN** the create response carries no `rowCapNotice`

#### Scenario: SQL creation emits no advisory
- **WHEN** a SQL source is created
- **THEN** the create response carries no `rowCapNotice` — SQL inference samples at most 100 rows and cannot observe the true total
