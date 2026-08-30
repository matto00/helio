# pipeline-step-config-runtime-completeness Specification

## Purpose
Ensure a step whose required configuration is missing or empty fails with a message naming the step and the field
when the pipeline is run or analyzed, so a saved-but-unconfigured draft can never silently produce degraded output.

## Requirements

### Requirement: A step with missing or empty required configuration SHALL fail the run, naming the step and field
When a pipeline is run and a step's required configuration values are missing or empty, the run SHALL fail with an
error that names the failing step and states which required configuration value is absent. The run SHALL NOT
execute that step as a no-op, SHALL NOT pass its input through unchanged, and SHALL NOT emit output columns derived
from an empty configuration value.

Saving such a configuration remains permitted: a step may be added and configured later. This requirement governs
only what happens when that step is actually run.

#### Scenario: A compute step with an empty output column fails the run
- **GIVEN** a pipeline containing a `compute` step whose `column` is the empty string
- **WHEN** the pipeline is run
- **THEN** the run fails
- **AND** the error names that step and identifies `column` as the missing required value
- **AND** no output column named with the empty string is produced

#### Scenario: A join step with no join key fails the run
- **GIVEN** a pipeline containing a `join` step whose `joinKey` is the empty string
- **WHEN** the pipeline is run
- **THEN** the run fails
- **AND** the error names that step and identifies `joinKey` as the missing required value

#### Scenario: A step with complete configuration is unaffected
- **GIVEN** a pipeline whose steps all carry complete required configuration
- **WHEN** the pipeline is run
- **THEN** the run succeeds and produces the same output as before this requirement

### Requirement: The same incompleteness SHALL be reported at analyze time
The analyze surface SHALL report a step's missing or empty required configuration through that step's existing
validation-error field, before any run is attempted, using the same determination as the run-time check so the two
surfaces can never disagree.

#### Scenario: An unconfigured step is reported by analyze
- **GIVEN** a pipeline containing a `compute` step whose `column` and `expression` are both empty
- **WHEN** the pipeline is analyzed
- **THEN** that step's validation error is present and names the missing required values
- **AND** that step's output schema equals its input schema
