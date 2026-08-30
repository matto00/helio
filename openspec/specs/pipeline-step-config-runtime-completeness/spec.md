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

### Requirement: A `compute` step whose stored expression cannot be parsed SHALL fail the run, naming the step and the reason

A `compute` step stored before write-path expression validation existed may hold an expression that
parses under neither grammar. Running it SHALL fail, with an error naming the step's id, the step's
kind, and the parser's own description of the problem — rather than evaluating the expression per row
and writing `null` into every row of the output column.

The run surface SHALL evaluate this check through the step kind's `requiredConfigProblems`. Step preview,
which executes through the same engine path as a run, SHALL therefore surface the same failure rather than
displaying a column of blanks.

The analyze surface SHALL report the same defect, but reaches it by a different route: analyze evaluates the
step kind's write-path `validateRawConfig` first and short-circuits `requiredConfigProblems` when that
returns a problem, so an unparseable expression is reported there as a write-path rejection. Both routes
SHALL carry the parser's own description of the problem; their message prefixes differ by surface, and no
requirement is placed on the prefixes being identical.

A missing or empty `expression` SHALL continue to be reported as missing required configuration and
SHALL take precedence over the parse check, so an unconfigured draft reports what it is rather than a
parse error about an empty input.

A row-dependent evaluation failure — unknown field, division by zero, null operand, type error — SHALL
NOT fail the run. Such a row's value remains `null` and the run continues, per `pipeline-compute-op`.

#### Scenario: Running a stored step with an unparseable expression fails, naming the step
- **WHEN** a pipeline containing a `compute` step whose stored expression parses under neither grammar
  is run
- **THEN** the run fails and the error names the step id, the kind `compute`, and the parse error

#### Scenario: Analyze reports the same problem
- **WHEN** the same pipeline is analyzed
- **THEN** that step's `validationError` reports the parse error
- **AND** that step's `outputSchema` equals its `inputSchema`, since a step with a validation error
  does not contribute an inferred output field

#### Scenario: Preview reports the same problem
- **WHEN** the same step is previewed
- **THEN** the preview fails with the attributed parse error rather than returning rows whose computed
  column is `null`

#### Scenario: An empty expression reports missing configuration, not a parse error
- **WHEN** a pipeline containing a `compute` step with an empty `expression` is run
- **THEN** the run fails reporting the missing `expression`, and the message is not a parse error

#### Scenario: A row-dependent failure does not fail the run
- **WHEN** a pipeline containing a `compute` step with a parseable expression is run over rows where one
  row divides by zero
- **THEN** the run succeeds, that row's computed value is `null`, and other rows are computed normally
