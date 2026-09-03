## MODIFIED Requirements

### Requirement: Join step merges two data sources on a key column
The execution engine SHALL support the `join` op with inner and left join semantics. The config SHALL contain `secondaryInput` (the discriminated object, exactly one of `{"kind": "source", "dataSourceId": "<id>"}` or `{"kind": "lane", "stepId": "<id>"}`), `joinKey` (a column present in both inputs), and `joinType` (`"inner"` or `"left"`). The legacy flat `rightDataSourceId` field SHALL NOT be accepted. The result SHALL contain all columns from both inputs (right-side duplicate key column excluded), identically whether the right-hand rows come from a data source or from a referenced lane node's post-evaluation frame.

#### Scenario: Inner join returns only matching rows
- **WHEN** a `join` step with `{"secondaryInput": {"kind": "source", "dataSourceId": "<id>"}, "joinType": "inner"}` is executed
- **THEN** only rows matching on `joinKey` are returned, with all columns from both sides and the right-side duplicate key column excluded

#### Scenario: Left join preserves unmatched left rows
- **WHEN** the same step is executed with `"joinType": "left"`
- **THEN** unmatched left rows are preserved with null-filled right-side columns

#### Scenario: A lane-kind join produces the same shape
- **WHEN** a `join` step's right-hand rows come from a `lane`-kind secondary input instead of a data source
- **THEN** the joined result has the same columns and semantics as the equivalent source-kind join

#### Scenario: Left join retains all left rows
- **WHEN** a join step with `joinType: "left"` is applied and some left-side rows have no match
- **THEN** all left-side rows appear in the result with null values for right-side columns where no match exists

### Requirement: POST /api/pipelines/:id/run executes steps and returns a result
The run endpoint SHALL execute the pipeline's graph and return a result reporting per-node row counts for **every** evaluated node across **all** lanes, keyed by node id. When a step fails, the reported error SHALL identify the failing step and its reason, and SHALL additionally identify the **lane path** leading to that step, so a failure in one of several sibling lanes is unambiguous. The lane path SHALL be the ordered list of step ids from the source root to the failing step inclusive, joined by `" > "`, with the virtual root rendered as `root` (for example `root > s1 > s4 > s7`).

#### Scenario: Row counts are returned for nodes in every lane
- **WHEN** a pipeline with two sibling lanes is run
- **THEN** the result carries a row count for every evaluated node in both lanes

#### Scenario: A failure in the second of two lanes names that lane's path
- **WHEN** a step in the second of two sibling lanes raises during a run
- **THEN** the result names the failing step, its reason, and the lane path leading to it, in the specified format

#### Scenario: A failure in a non-branching pipeline is unchanged in substance
- **WHEN** a step fails in a pipeline with no branching
- **THEN** the failing step and its reason are reported as before, with the lane path being the single chain to that step

#### Scenario: Run with no steps returns source rows unchanged
- **WHEN** `POST /api/pipelines/:id/run` is called on a pipeline that has no steps
- **THEN** the response is `200 OK` with all source rows returned and `last_run_status` is `"succeeded"`

#### Scenario: Run with multiple steps applies them in position order
- **WHEN** `POST /api/pipelines/:id/run` is called on a pipeline whose trunk has steps at positions
  0, 1, 2 (a pure trunk, no tails)
- **THEN** the response is `200 OK` with rows that reflect the cumulative output of all three steps
  applied in trunk order — identical to what the pre-tree-walk engine produced for the same pipeline

#### Scenario: Run with an invalid step expression returns 422
- **WHEN** a filter step contains an invalid expression and `POST /api/pipelines/:id/run` is called
- **THEN** the response is `422 Unprocessable Entity` and `last_run_status` is `"failed"`

#### Scenario: Returns 404 for unknown pipeline
- **WHEN** `POST /api/pipelines/:id/run` is called with a pipeline id that does not exist
- **THEN** the response is `404 Not Found`

#### Scenario: Run blocked by an error-severity assertion still returns 200 OK, but last_run_status is failed
- **WHEN** `POST /api/pipelines/:id/run` is called and step execution completes without exception, but an
  `assert` step's error-severity rule fails
- **THEN** the HTTP response is still `200 OK` with the computed rows, but `pipelines.last_run_status` is
  set to `"failed"`, not `"succeeded"`

#### Scenario: Step failure names the step id, kind, and reason
- **GIVEN** a pipeline whose second step is a `stringops` step configured with an unsupported `operation`
- **WHEN** `POST /api/pipelines/:id/run` is called
- **THEN** the response is `422 Unprocessable Entity`
- **AND** the error message contains that step's id, the string `stringops`, and the underlying
  validation message naming the unsupported value and the supported operations

#### Scenario: A non-validation failure does not leak internals
- **GIVEN** a step that fails with a throwable that is not an `IllegalArgumentException`
- **WHEN** the pipeline is run
- **THEN** the error message names the failing step's id and kind
- **AND** the message contains neither the throwable's message nor any package-qualified class name

#### Scenario: A step-tree invariant violation is rejected before execution
- **WHEN** `POST /api/pipelines/:id/run` is called for a pipeline whose step tree violates the
  Phase-1 graph invariant (see `pipeline-step-tree`)
- **THEN** the response is `422 Unprocessable Entity` naming the offending node, and no step is
  evaluated
