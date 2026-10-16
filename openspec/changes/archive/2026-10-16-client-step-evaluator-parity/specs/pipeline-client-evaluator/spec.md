## Purpose

Lets the pipeline editor evaluate pipeline steps in the browser over in-memory rows, producing the same rows the server engine would, so a live draft preview needs no network request per edit.

## ADDED Requirements

### Requirement: Client evaluation matches the server engine
For every step kind and configuration the client evaluator accepts, evaluating a step over an input frame SHALL produce the same rows, in the same row order, with the same values (including integral-versus-floating value class where the server distinguishes them), as the server engine produces for the same configuration and input frame. Output column order is not part of the contract.

#### Scenario: Shared vector agrees on both sides
- **WHEN** a parity vector's configuration and input rows are evaluated by the server engine and by the client evaluator
- **THEN** both produce exactly the vector's expected rows, and the expected rows are the server engine's actual output

#### Scenario: Known numeric trap
- **WHEN** a compute step evaluates `round(-2.5)` and `round(2.675, 2)`
- **THEN** the client produces `-3` and `2.68`, matching the server

#### Scenario: Step failure agrees
- **WHEN** a configuration makes the server engine fail the step on its run path, including a required-configuration problem such as an unparseable compute expression
- **THEN** the client either marks that step as an error or declines it as needing the server, and in both cases produces no rows for it

#### Scenario: Disabled step is transparent
- **WHEN** a step of any kind, including a server-only or AI kind, is disabled
- **THEN** its output is its input unchanged, as on the server, and it causes no decline

### Requirement: Unsupported configurations are declined, never approximated
The client evaluator SHALL decline, with a stated reason and without producing rows, any step whose kind is server-only, any AI step, any compute expression that needs the legacy bare-identifier grammar or a function outside the supported list, any regular-expression pattern outside the safe subset, and any join, union or lookup whose source secondary is not available as a complete frame.

#### Scenario: Server-only kind
- **WHEN** a pipeline contains a `chunkbytokencount` or `convertformat` step
- **THEN** that step is reported as needing the server, and its dependents are not computed client-side

#### Scenario: AI step
- **WHEN** a pipeline contains an `analyzewithai` or `generatetext` step
- **THEN** that step and every step downstream of it are reported as not previewed

#### Scenario: Partially cached secondary
- **WHEN** a join's source secondary is supplied only as a truncated sample
- **THEN** the join is reported as needing the server rather than evaluated over the partial rows

### Requirement: A failing step does not hide unaffected results
When a step fails or references an invalid lane, the client evaluator SHALL mark that step as an error, SHALL leave its dependents uncomputed, and SHALL still compute every step that does not depend on it, with the same rows the server engine produces for the pipeline without the failing step.

#### Scenario: Error in one branch
- **WHEN** one step fails and a sibling branch does not depend on it
- **THEN** the failing step is an error, its dependents are blocked, and the sibling branch's rows match the server's

### Requirement: Incremental recompute from the edited step
When one step's configuration changes, the client evaluator SHALL recompute only that step and the steps that depend on it through parent edges or lane-secondary edges, SHALL reuse every other step's previous result unchanged, and SHALL produce the same results as a full recompute.

#### Scenario: Rejoin through a non-ancestor lane
- **WHEN** a step on a side lane changes and a join elsewhere uses that lane as its secondary
- **THEN** the join and its dependents are recomputed and match a full recompute

#### Scenario: Unaffected steps reused
- **WHEN** a step's configuration changes
- **THEN** steps that do not depend on it keep their previous results by identity

### Requirement: Parity drift fails the build on either side
The repository SHALL contain a shared parity corpus that is executed against the server engine and against the client evaluator in the standard test suites. Classification of every registered step kind, and of every supported compute function, SHALL be checked against both implementations, so that adding a step kind or function on either side without updating the other fails a test.

#### Scenario: New server step kind
- **WHEN** a step kind is registered on the server without a corresponding manifest entry
- **THEN** the server test suite fails

#### Scenario: Missing client evaluator or vectors
- **WHEN** a client-evaluable kind has no client evaluator, or fewer than its minimum number of vectors
- **THEN** the client test suite fails

### Requirement: Recompute stays within the latency budget
Recomputing the reference three-step pipeline (filter, sort, compute) over 1,000 rows after a single edit SHALL take a median of under 50 milliseconds on the reference machine, and the measurement SHALL be recorded with the change.

#### Scenario: Measured filter edit
- **WHEN** 500 filter edits are measured after warm-up on the 1,000-row reference pipeline
- **THEN** the recorded median per-edit recompute time is under 50 milliseconds
