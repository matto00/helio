# pipeline-create-modal Specification

## Purpose
TBD - created by archiving change create-pipeline-flow. Update Purpose after archive.

## Requirements

### Requirement: Data source select is populated from existing data sources
The data source select in `CreatePipelineModal` SHALL be populated by dispatching `fetchDataSources`
if the data sources list is not already loaded. Each option SHALL show the data source name.

#### Scenario: Data source select shows available data sources
- **WHEN** `CreatePipelineModal` is open and data sources exist
- **THEN** the data source select contains one option per data source

#### Scenario: Data source select fetches sources if not loaded
- **WHEN** `CreatePipelineModal` is opened and the data sources status is "idle"
- **THEN** `fetchDataSources` is dispatched to load them
