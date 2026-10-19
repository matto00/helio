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
