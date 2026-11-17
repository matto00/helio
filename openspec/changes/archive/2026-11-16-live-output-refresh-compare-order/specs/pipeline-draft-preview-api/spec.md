## ADDED Requirements

### Requirement: Draft preview returns rows for several requested steps
The request MAY carry `rowsStepIds`, a list of at most 8 distinct step ids, each naming a step in the request. The response SHALL end with one `rows` line for the `rowsStepId` step (or its default) followed by one `rows` line for each further id in `rowsStepIds`, in list order (an id equal to the primary is not repeated), each limited to 1,000 rows with its full count and `truncated` flag. A request without `rowsStepIds` SHALL behave exactly as before. A list longer than 8, a duplicate, or an id not in the request SHALL be refused with `400` before the response is committed. Holding the extra rows SHALL NOT raise the request's peak memory past the bound measured for the endpoint.

#### Scenario: Two rows lines
- **WHEN** a request names `rowsStepId` A and `rowsStepIds` [A, B]
- **THEN** the stream ends with exactly one `rows` line for A followed by one for B

#### Scenario: Unknown id
- **WHEN** `rowsStepIds` names a step that is not in the request
- **THEN** the response is `400` and nothing is evaluated

#### Scenario: Extra id not previewable
- **WHEN** `rowsStepIds` names a step below an AI step
- **THEN** its `rows` line is `available: false` with no rows, and the other rows lines are unaffected

#### Scenario: Old client
- **WHEN** a request carries only `rowsStepId`
- **THEN** the stream is the same as before this change

## MODIFIED Requirements

### Requirement: Draft preview streams per-step lines before the final rows line
`POST /api/pipelines/:id/draft-preview` SHALL respond `200` with `Content-Type: application/x-ndjson` and a chunked body of
newline-terminated JSON objects: every `unavailable` line decided before evaluation, then one `step` or `error` line per
evaluated enabled step in evaluation order (each `error` line followed by `downstreamOfError` lines for its pruned subtree), then
one `rows` line for the requested step (default: the trunk terminal of the full draft), followed by one further `rows` line per
additional id in `rowsStepIds` (see "Draft preview returns rows for several requested steps"); with no `rowsStepIds` there is
exactly one final `rows` line. Each line SHALL validate against
`schemas/pipelines/draft-preview-line.schema.json` and the request against `draft-preview-request.schema.json`.

#### Scenario: Line order
- **WHEN** an owner posts a valid draft of three enabled steps over one supplied root frame
- **THEN** the body is three `step` lines (`step`, `count`, `schema`) followed by one `rows` line, in that order

#### Scenario: A failing step
- **WHEN** a step's evaluation fails
- **THEN** that step gets an `error` line with a message, its subtree gets `unavailable` lines with reason
  `downstreamOfError`, an independent sibling branch is still evaluated, and the stream still ends with a `rows` line

#### Scenario: Requested rows step is not previewable
- **WHEN** the trunk terminal sits below an AI step
- **THEN** the final line is `{"type":"rows","step":<terminal id>,"available":false,"rows":[],"count":0,"truncated":false}`

### Requirement: Draft preview bounds the request and keeps rows out of logs
A body over 4 MiB, a frame over 10,000 rows, more than 8 root frames, more than 8 secondary frames, more than 50 steps, or a step id over 64
characters SHALL be refused with `413` and a JSON error naming the cap. At most the configured number of requests per instance (default derived from a recorded heap measurement, never above 8)
and 2 per principal SHALL be evaluating, and at most four times that many bodies SHALL be being read; another request SHALL get an immediate `429` with `Retry-After` and no queueing (past the reading or principal bound before its body is read, past the running bound once its body has been read). A client that is still sending its body SHALL NOT hold one of the evaluating slots. Once a walk has started, its evaluating slot and its principal slot SHALL be held until the walk itself has ended (its outcome logged), not until the response stream ends: a cancelled walk stops only at the next step boundary, and the node in progress keeps its memory. A request whose walk never started (refused, reset before the response was produced) SHALL give its slots back when its stream ends or its materialize grace expires. Each `rows` line SHALL carry at most 1,000 rows with `truncated` set when more existed.
Request cell values SHALL NOT appear in server logs.

#### Scenario: A reset request's walk still holds its slots
- **WHEN** a client resets the connection while its second step is mid-evaluation, and the same user then sends a second request (admitted) and a third
- **THEN** the third gets `429` with `Draft preview busy` until the first walk has logged its outcome, and another user is refused too while both evaluating slots are held

#### Scenario: Oversize body
- **WHEN** a 5 MiB body is posted
- **THEN** the response is `413` with a JSON error, not a 500

### Requirement: A request's live memory is bounded
The frames one draft preview holds at once SHALL stay within a live-cell budget (1,800,000): cells = rows x columns summed over
every frame the walk still needs (including every frame retained for a requested `rows` line) plus the frame a node just produced, with each distinct text value across those frames also
weighing its length (2 bytes a character at 46 bytes a cell) beyond the cell holding it. The draft walk SHALL finish a node's leaf
children before descending, so a comb-shaped pipeline does not keep its spine alive. A node whose output would pass the budget SHALL
be that step's `error` with a message naming the draft-preview memory limit, and its dependents SHALL be pruned as for any other step
`error`. A `compute`, `stringops`, `splittext`, `extractheadings`, `chunkbytokencount`, `convertformat`, `cast` (to string) or `pivot` (its output column names) step SHALL NOT create a
text value over 262,144 characters, and SHALL stop while it emits, as
that step's `error` with a message naming the draft-preview text limit, once the new text it has created passes what the request has
left under the budget. Step lines SHALL be emitted in this evaluation order. Runs and the saved-config preview SHALL be unaffected.

#### Scenario: Output over the budget
- **WHEN** a step's output, added to the frames still needed downstream, would hold more cells than the budget
- **THEN** that step gets an `error` line containing `Draft preview memory limit`, its dependents get `downstreamOfError` lines, and the response completes

#### Scenario: Fresh text priced by length
- **WHEN** a chain of 49 `compute` steps each writes a fresh 300-character text per row over a 20,000-row join output
- **THEN** a step well before the 49th gets an `error` line, and the request's measured heap stays at or under 96 MB

#### Scenario: Text created inside one node
- **WHEN** a `compute` step would create 10,000 texts of 200,000 characters (or a text that doubles per step) from a join fan-out
- **THEN** that step gets an `error` line containing `Draft preview text limit`, before the texts are built, and the request completes without exhausting the heap

#### Scenario: Text copied per row inside one node
- **WHEN** a 10,000-row join fan-out of one 100,000-character text (a 479 KB body) is followed by `splittext` or `extractheadings`
- **THEN** that step gets an `error` line containing `Draft preview text limit`, never `step execution failed`, and the request completes without exhausting a 768 MB heap

#### Scenario: Pivot column names copied per group
- **WHEN** a 10,000-row join fan-out of one 100,000-character text (a 479 KB body) is followed by a `pivot` on that text
- **THEN** the `pivot` step gets an `error` line containing `Draft preview text limit`, never `step execution failed`, and the request completes without exhausting a 768 MB heap; a run of the same pivot is unchanged

#### Scenario: Headroom is what the request has left
- **WHEN** a text-creating node starts while the frames already held leave room for only a few new texts
- **THEN** the node stops inside itself with `Draft preview text limit`, rather than running to the end and being refused by the memory limit

#### Scenario: Realistic draft
- **WHEN** a draft has 1,000-row samples, 50 columns and 50 steps
- **THEN** every step is evaluated, even at a tenth of the budget
