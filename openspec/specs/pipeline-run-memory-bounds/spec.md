# pipeline-run-memory-bounds Specification

## Purpose
Bounds the memory one real pipeline run or saved-step preview can take, so a pipeline that multiplies rows or grows
text fails as an ordinary step error instead of exhausting the backend heap.

## Requirements

### Requirement: Runs and the saved preview enforce a per-node row limit
Every real pipeline run (manual, scheduled, external hook, auto-run, backfill) and every saved-step preview SHALL refuse
any node whose output would exceed 100,000 rows. `join` and `unpivot` SHALL refuse before materialising any output
row; `splittext`, `chunkbytokencount` and `extractheadings` SHALL refuse while emitting, before materialising more than
one input row's output past the limit; any other node over the limit SHALL be refused after it is produced.

#### Scenario: A join fan-out past the limit is refused before merging
- **WHEN** a run's join step would produce 100,001 or more rows
- **THEN** the run fails at that step with an error naming the step, the kind `join` and the 100,000-row run limit
- **AND** no merged row was materialised

#### Scenario: A text split past the limit is refused while emitting
- **WHEN** a run's splittext, chunkbytokencount or extractheadings step would emit more than 100,000 rows
- **THEN** the run fails at that step with an error naming the kind and the run limit

#### Scenario: A pipeline under the limit is unaffected
- **WHEN** every node of a run produces 100,000 rows or fewer and the run stays under its memory budget
- **THEN** the run's rows, step counts and snapshots are identical to a run without the limits

### Requirement: Runs and the saved preview enforce a live memory budget
A run and a saved preview SHALL hold at most a live-cell budget sized to 25% of a 768 MB heap, counting every cell of
every frame still retained plus the frame a node just produced, with text priced by its length once per distinct text.
A frame SHALL be released once no unevaluated child, unevaluated lane dependent, Output node, trunk terminal or requested
preview/backfill target still needs it. A node that would pass the budget SHALL fail the run as that step's error.

#### Scenario: A text-heavy chain past the budget fails cleanly
- **WHEN** a run's retained frames plus a node's output would pass the budget
- **THEN** the run fails at that node with an error naming the step and the pipeline run memory limit, and the backend
  keeps serving requests

#### Scenario: An ordinary large pipeline still runs
- **WHEN** a pipeline over a 50,000-row, 6-column CSV (the largest the CSV cell limit allows) runs a 10-step compute
  chain with Outputs on a middle node and the terminal
- **THEN** the run succeeds and writes both Outputs' snapshots

### Requirement: Runs bound the text a step creates
In a run and a saved preview, no text-creating step (compute, stringops, splittext, extractheadings, chunkbytokencount,
convertformat, cast to string, pivot column names) SHALL create a text value longer than 1,048,576 characters, and the
new text one node creates SHALL stay within what the run has left under its memory budget. A breach SHALL fail the run
as that step's error, checked before the oversized text is built where the length is known in advance.

#### Scenario: A doubling concat stops before it exhausts the heap
- **WHEN** a run's compute chain doubles a text by concatenation past 1,048,576 characters
- **THEN** the run fails at that step with a pipeline run text-limit error, and no OutOfMemoryError occurs

### Requirement: A run over a limit fails like any step error
A run refused by any of these limits SHALL be recorded as a failed run whose error names the failing step, its kind,
its lane path and the limit, worded as a pipeline run limit, and SHALL write no node snapshot. The draft preview SHALL
keep its own limits and wording unchanged.

#### Scenario: The run history shows the limit
- **WHEN** a run fails on a run limit
- **THEN** the run's status is `failed`, its error names the step and the run limit, and no node snapshot is written

#### Scenario: The draft preview wording is unchanged
- **WHEN** a draft preview step passes its own 20,000-row limit
- **THEN** its error still says "draft preview limit"

### Requirement: Fatal errors are not converted into step errors
The engine SHALL convert only non-fatal exceptions and StackOverflowError thrown by a step into step errors. An
OutOfMemoryError or other fatal error SHALL NOT be converted into a step error, whether thrown synchronously or surfaced
through a failed asynchronous step. The production container JVM SHALL exit on OutOfMemoryError so the instance restarts.

#### Scenario: An OutOfMemoryError is not reported as a step error
- **WHEN** a step throws an OutOfMemoryError during a run
- **THEN** the engine does not convert it into a step error

#### Scenario: A stack overflow in a step is still a step error
- **WHEN** a step throws a StackOverflowError during a run (for example, a user regex over long text)
- **THEN** the run fails with an ordinary step error naming that step, and the backend keeps running

#### Scenario: The production JVM exits on OutOfMemoryError
- **WHEN** the production container starts
- **THEN** its JVM flags include `-XX:+ExitOnOutOfMemoryError`

### Requirement: A run's snapshot writes stay within the per-run share whatever the row width

A real run (manual, scheduled, hook, auto-run, backfill) SHALL write each node snapshot so that the JSON text it holds
rendered at one time is bounded by a fixed character budget per batch, independent of how many rows the node has; a
batch SHALL always hold at least one row. A run holding any row whose rendered JSON is longer than a fixed, measured
row-render limit (sized so the worst retained frames plus that one row's render stay within the per-run share) SHALL fail
before any write with the existing pipeline run limit step error; a backfill in that case SHALL write
nothing and fail through its existing logged failure. The opt-in history payload write SHALL measure the payload's bytes
before rendering it and SHALL NOT render a payload over its byte cap.

#### Scenario: A short node of long text is written in size-bounded batches
- **WHEN** a run's Output node has 200 rows of 35,000-character UTF-16 text through three `concat` steps
- **THEN** the run succeeds and its peak heap stays at or under 192 MB under a 768 MB heap

#### Scenario: Backfill writes through the same bounded path
- **WHEN** a backfill writes a node snapshot of long text
- **THEN** the snapshot is written in the same size-bounded batches as a run

#### Scenario: A row at the row-render limit is written within the share
- **WHEN** a run's retained frames are at the walk's worst and one Output row's rendered JSON is exactly at the limit
- **THEN** the run succeeds and its peak heap stays at or under 192 MB under a 768 MB heap

#### Scenario: A row over the row-render limit fails cleanly
- **WHEN** a run's Output or terminal row's rendered JSON is one character over the row-render limit
- **THEN** the run fails with the pipeline run limit step error and no snapshot is written

#### Scenario: A backfill of a too-wide row writes nothing
- **WHEN** a backfill's target node holds a row whose rendered JSON is over the row-render limit
- **THEN** no snapshot is written and the failure is logged like any other backfill failure

#### Scenario: An oversized history payload is never rendered
- **WHEN** an opted-in Output's node would render past `PAYLOAD_HISTORY_MAX_BYTES`
- **THEN** it is never rendered, no payload is stored, a WARN is logged and the summary point is still written

### Requirement: A run's HTTP response stays within the per-run share without changing its content

A response that carries a run result (`POST /api/pipelines/:id/run`, with or without `dry=true`,
`POST /api/pipelines/apply-proposal` and `POST /api/proposals/apply`) SHALL be written incrementally, so the response
body is never held as one fully rendered text. The heap a manual run holds, measured from before the run until the
last byte of its response is written, SHALL stay at or under the 192 MB per-run share on the certified shapes,
including the 200-row long-text shape and a row of exactly the maximum rendered row width. The response body SHALL be
byte-for-byte the compact JSON the endpoint returned before this change: the same fields, rows, counts and status.

#### Scenario: Long-text run response stays within the share
- **WHEN** a real or dry manual run of the 200-row long-text shape succeeds and its response is fully written
- **THEN** the measured heap peak over the run and the response write is at or under 192 MB

#### Scenario: Widest allowed row stays within the share
- **WHEN** a manual run whose finished row renders to exactly the maximum rendered row width succeeds and its response
  is fully written
- **THEN** the measured heap peak over the run and the response write is at or under 192 MB

#### Scenario: Response content is unchanged
- **WHEN** any of the listed endpoints succeeds
- **THEN** the body parses to the same JSON value, and is the same bytes, as the compact rendering of the response
  object, with `rows` holding every terminal row and `rowCount` its size
- **AND** the body is sent as a chunked stream rather than as one buffered entity
