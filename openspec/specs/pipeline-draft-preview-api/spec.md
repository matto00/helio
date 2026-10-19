# pipeline-draft-preview-api Specification

## Purpose
Evaluate an unsaved pipeline draft's server-evaluated steps over rows the client supplies, streaming per-step results, without
reading any source, calling any AI model, or recording a run.

## Requirements

### Requirement: Draft preview streams per-step lines before the final rows line
`POST /api/pipelines/:id/draft-preview` SHALL respond `200` with `Content-Type: application/x-ndjson` and a chunked body of
newline-terminated JSON objects: every `unavailable` line decided before evaluation, then one `step` or `error` line per
evaluated enabled step in evaluation order (each `error` line followed by `downstreamOfError` lines for its pruned subtree), then
exactly one final `rows` line for the requested step (default: the trunk terminal of the full draft). Each line SHALL validate against
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

### Requirement: Draft preview never reads a data source
The endpoint SHALL evaluate only the frames in the request. It SHALL NOT read any data source's rows or metadata, primary or
secondary. A step whose source secondary is absent from `sources`, or supplied with `complete: false`, SHALL get an
`unavailable` line with reason `sourceNotSupplied` (and its subtree `downstreamOfUnavailable`); a lane reference neither in the
request nor in `lanes` SHALL get reason `laneNotSupplied`.

#### Scenario: Supplied rows win over the stored source
- **WHEN** the pipeline's persisted source holds rows different from the supplied input frame
- **THEN** every count and the final rows derive from the supplied frame and no source read occurs

#### Scenario: Partially cached secondary
- **WHEN** a join's source secondary is supplied with `complete: false`
- **THEN** the join gets `{"type":"unavailable","reason":"sourceNotSupplied"}` and no source read occurs

### Requirement: Unavailability propagates over child and lane edges
A step that depends on an unavailable step through its parent chain or through a lane input SHALL itself be unavailable
(`downstreamOfAiStep` below an AI step, `downstreamOfUnavailable` otherwise), and the request SHALL NOT fail because of it.

#### Scenario: Lane on an unavailable join
- **WHEN** a union's lane input is a join whose source secondary is `complete: false`
- **THEN** the join is `sourceNotSupplied`, the union is `downstreamOfUnavailable`, and the stream ends with a `rows` line

### Requirement: A node's output is bounded
No draft node SHALL produce more than 20,000 rows. A `join` or `unpivot` that would exceed it SHALL fail as that step's `error`
before materialising its output; a `splittext`, `chunkbytokencount` or `extractheadings` SHALL stop emitting once past it and fail as that step's
`error`; any other node over it SHALL be that step's `error` with a distinct message. Runs and the saved-config preview SHALL be unaffected.

#### Scenario: Fan-out join
- **WHEN** a 10,000-row frame is joined to a 10,000-row lane on a single shared key
- **THEN** the join gets an `error` line naming the 20,000-row limit and the response completes promptly

#### Scenario: Token-per-row chunking
- **WHEN** `chunkbytokencount` with `targetTokenCount: 1` runs over a frame whose text holds more than 20,000 tokens
- **THEN** the step stops emitting past the limit and gets an `error` line naming it

### Requirement: A request's live memory is bounded
The frames one draft preview holds at once SHALL stay within a live-cell budget (1,800,000): cells = rows x columns summed over
every frame the walk still needs plus the frame a node just produced, with each distinct text value across those frames also
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

### Requirement: Disabled steps are transparent
A disabled step of any kind SHALL NOT be evaluated, SHALL get no line and SHALL NOT be marked unavailable; its input frame
SHALL pass to its children.

#### Scenario: Disabled AI step
- **WHEN** a draft has a disabled `generatetext` step followed by an enabled `filter`
- **THEN** the filter gets a `step` line and no line names the disabled step

#### Scenario: Disabled step below an AI step
- **WHEN** a draft is AI step, then a disabled step, then an enabled step
- **THEN** the enabled step is `downstreamOfAiStep`, no line names the disabled step, and the stream ends with `rows`

#### Scenario: Disabled join with an unsupplied lane
- **WHEN** a disabled join's lane input is neither in the request nor in `lanes`
- **THEN** the request does not fail and the join's children evaluate over its pass-through frame

### Requirement: Draft preview never executes an AI step
Steps of kind `analyzewithai` or `generatetext` SHALL get `unavailable` reason `aiStep`; their subtrees and any step that
depends on them through a lane SHALL get `downstreamOfAiStep`. The AI client SHALL receive zero calls.

#### Scenario: AI step in the draft
- **WHEN** a draft contains a `generatetext` step followed by a `filter`
- **THEN** the lines mark them `aiStep` and `downstreamOfAiStep` and the AI client records zero calls

### Requirement: Draft preview is owner-or-editor only and re-checks access before evaluation
The caller SHALL be the pipeline owner or hold an editor grant. A pipeline invisible to the caller SHALL be `404`; a viewer
SHALL be `403`. Access SHALL be re-checked immediately before evaluation; a grant revoked in between SHALL be `403` with no
evaluation. These checks SHALL hold under row-level security for a role without `BYPASSRLS`.

#### Scenario: Editor under RLS
- **WHEN** an editor grantee posts a draft as a non-BYPASSRLS application role
- **THEN** the response is `200` with step lines

#### Scenario: Viewer refused
- **WHEN** a viewer grantee posts a draft
- **THEN** the response is `403` and nothing is evaluated

### Requirement: Draft preview is side-effect free
The endpoint SHALL NOT consume the pipeline-run guard, create a `pipeline_runs` row, change `last_run_*`, write node snapshots or
history, or apply any write-back.

#### Scenario: No run recorded
- **WHEN** a draft with an `upsertsource` step is previewed
- **THEN** `pipeline_runs`, `pipeline_run_rate_window` and the target source are unchanged

### Requirement: Draft preview bounds the request and keeps rows out of logs
A body over 4 MiB, a frame over 10,000 rows, more than 8 root frames, more than 8 secondary frames, more than 50 steps, or a step id over 64
characters SHALL be refused with `413` and a JSON error naming the cap. At most the configured number of requests per instance (default derived from a recorded heap measurement, never above 8)
and 2 per principal SHALL be evaluating, and at most four times that many bodies SHALL be being read; another request SHALL get an immediate `429` with `Retry-After` and no queueing (past the reading or principal bound before its body is read, past the running bound once its body has been read). A client that is still sending its body SHALL NOT hold one of the evaluating slots. Once a walk has started, its evaluating slot and its principal slot SHALL be held until the walk itself has ended (its outcome logged), not until the response stream ends: a cancelled walk stops only at the next step boundary, and the node in progress keeps its memory. A request whose walk never started (refused, reset before the response was produced) SHALL give its slots back when its stream ends or its materialize grace expires. The final `rows` line SHALL carry at most 1,000 rows with `truncated` set when more existed.
Request cell values SHALL NOT appear in server logs.

#### Scenario: A reset request's walk still holds its slots
- **WHEN** a client resets the connection while its second step is mid-evaluation, and the same user then sends a second request (admitted) and a third
- **THEN** the third gets `429` with `Draft preview busy` until the first walk has logged its outcome, and another user is refused too while both evaluating slots are held

#### Scenario: Oversize body
- **WHEN** a 5 MiB body is posted
- **THEN** the response is `413` with a JSON error, not a 500

### Requirement: Draft preview has its own rate limit
The endpoint SHALL be limited per principal by its own budget (`DRAFT_PREVIEW_RATE_LIMIT_PER_WINDOW`, default 120 per
`RATE_LIMIT_WINDOW_SECONDS`) and SHALL NOT be counted against the general `/api` budget. CSRF and scoped-token confinement SHALL
still apply.

#### Scenario: 121st request
- **WHEN** a principal sends 121 draft-preview requests in one window with the default limit
- **THEN** the 121st gets `429` with `Retry-After` and the draft-preview limiter's own message, and a general `/api` request
  from the same principal is still allowed

#### Scenario: Scoped token and missing CSRF header
- **WHEN** a hook-scoped PAT posts a draft, or a session POST omits the CSRF header
- **THEN** the request is refused and nothing is evaluated

### Requirement: The server stops evaluating when the client aborts
When the client cancels the response stream, the server SHALL evaluate no further steps of that request.

#### Scenario: Abort after the first line
- **WHEN** the client aborts after reading the first `step` line of a multi-step draft
- **THEN** the server records the request as aborted and evaluates exactly one step
