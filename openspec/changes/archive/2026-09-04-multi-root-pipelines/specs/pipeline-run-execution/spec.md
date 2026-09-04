## MODIFIED Requirements

### Requirement: POST /api/pipelines/:id/run executes steps and returns a result
The run endpoint SHALL execute the pipeline's graph and return a result reporting per-node row counts for **every** evaluated node across **all** lanes and **all** roots, keyed by node id. When a step fails, the reported error SHALL identify the failing step, its reason, and the **lane path** leading to that step, so a failure in one of several sibling lanes is unambiguous.

The lane path SHALL be the ordered list of ids from the originating root to the failing step inclusive, joined by `" > "`, with the root rendered as `root:<rootId>` (for example `root:r_7a2f > s1 > s4 > s7`). Where a node is reachable from more than one root, the canonical path SHALL be the one through the lowest-positioned originating root.

The engine SHALL emit this lane path; a specification of the format alone SHALL NOT be treated as satisfying this requirement.

#### Scenario: Row counts are returned for nodes in every lane
- **WHEN** a pipeline with two sibling lanes is run
- **THEN** the result carries a row count for every evaluated node in both lanes

#### Scenario: A failure in the second of two lanes names that lane's path
- **WHEN** a step in the second of two sibling lanes raises during a run
- **THEN** the reported error names the failing step, its reason, and the lane path leading to it, in the specified format

#### Scenario: A failure in a lane of the second root names that root
- **WHEN** a step fails in a lane originating at the second of two roots
- **THEN** the lane path begins with that root's id, not the first root's

#### Scenario: Run with no steps returns source rows unchanged
- **WHEN** `POST /api/pipelines/:id/run` is called on a single-root pipeline that has no steps
- **THEN** the response is `200 OK` with all of that root's source rows returned and `last_run_status` is `"succeeded"`

#### Scenario: Run with no steps on a multi-root pipeline returns the lowest-positioned root's rows
- **WHEN** `POST /api/pipelines/:id/run` is called on a two-root pipeline that has no steps
- **THEN** the response is `200 OK` and `last_run_status` is `"succeeded"`
- **THEN** the returned rows are the lowest-positioned root's source rows, not the concatenation of both roots' rows
- **THEN** every root's per-node row count is still reported

#### Scenario: A failure in a non-branching pipeline is unchanged in substance
- **WHEN** a step fails in a single-root pipeline with no branching
- **THEN** the failing step and its reason are reported as before
- **THEN** the lane path is the single chain to that step, beginning `root:<rootId>` for that pipeline's only root

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


### Requirement: POST /api/pipelines/:id/run executes a rest_api or sql base source
The run endpoint SHALL load rows for every root of the pipeline, whatever source kind each root binds, before the walk begins. A root binding a `rest_api` or `sql` source SHALL be fetched exactly as a single-source pipeline fetches it today.

#### Scenario: Two roots of different source kinds both load
- **WHEN** a pipeline has one `static` root and one `rest_api` root
- **THEN** both roots' rows are loaded and each root's lane evaluates from its own frame

#### Scenario: A healthy rest_api source completes a real run
- **WHEN** `POST /api/pipelines/:id/run` is called on a pipeline whose base source is a reachable
  `rest_api` source
- **THEN** the response is `200 OK` with rows fetched from the REST endpoint, `last_run_status` is
  `"succeeded"`, and the Output is populated with those rows

#### Scenario: A healthy sql source completes a real run
- **WHEN** `POST /api/pipelines/:id/run` is called on a pipeline whose base source is a reachable
  `sql` source
- **THEN** the response is `200 OK` with rows fetched from the SQL query, `last_run_status` is
  `"succeeded"`, and the Output is populated with those rows

#### Scenario: An unreachable rest_api source fails the run, not silently
- **WHEN** `POST /api/pipelines/:id/run` is called on a pipeline whose base `rest_api` source cannot
  be reached
- **THEN** the response is `422 Unprocessable Entity` and `last_run_status` is `"failed"` — the same
  outcome as any other source-kind read failure, not the categorical rejection this source kind
  previously always received

