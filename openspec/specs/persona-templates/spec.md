# persona-templates Specification

## Purpose
Let a user with no data of their own start from a persona (streamer, founder, ops, finance) and land on a full dashboard built from bundled sample data, owned by them.

## Requirements

### Requirement: Persona template instantiation
The system SHALL expose an authenticated endpoint that instantiates one of four persona templates (streamer, founder, ops, finance) for the calling user: a CSV source built from the bundled sample dataset, a pipeline that is applied and run, its outputs, and a dashboard with panels over those outputs. It SHALL NOT call Claude and SHALL NOT be tier-gated.

#### Scenario: Free-tier user instantiates a persona
- **WHEN** a free-tier user posts a valid persona slug
- **THEN** a dashboard with materialized, correctly typed data is created and its id returned

#### Scenario: Unknown persona
- **WHEN** an unknown slug is posted
- **THEN** the response is 400 and nothing is created

#### Scenario: Failure rolls back
- **WHEN** the dashboard phase fails after the pipeline applied
- **THEN** the pipeline and the created sample source are removed

### Requirement: Per-user ownership
Every resource a template creates SHALL be owned by the calling user, be editable and deletable like hand-built resources, carry no system-user ownership, and never be shared between users.

#### Scenario: Cross-user isolation
- **WHEN** user A instantiates a template
- **THEN** user B cannot list or fetch any of A's instantiated resources, and B's own instantiation yields distinct resources

### Requirement: Honest sample naming
Template sources SHALL be named "Sample: <persona> ..." so provenance never implies the data is the user's own.

#### Scenario: Provenance reads as sample
- **WHEN** a template panel's provenance is shown
- **THEN** its source name begins with "Sample:"

### Requirement: Dataset integrity validated in CI
Every bundled dataset SHALL be validated by the backend test suite for header schema, minimum row count, and size cap, so a broken file fails the build.

#### Scenario: Broken dataset
- **WHEN** a dataset has a missing column or too few rows
- **THEN** the test suite fails

### Requirement: Layout without overlap
Each template dashboard SHALL define explicit panel layouts that do not overlap at desktop and phone widths.

#### Scenario: Phone width
- **WHEN** a template dashboard is viewed at phone width
- **THEN** panels stack without overlap
