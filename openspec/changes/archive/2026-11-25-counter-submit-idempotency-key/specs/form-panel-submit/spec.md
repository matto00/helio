## MODIFIED Requirements

### Requirement: A submit appends exactly one row to the panel's bound source through a panel-scoped API

The system SHALL expose `POST /api/panels/:id/submit` accepting `{"values": {"<sourceField>": <value>}}`, plus an
optional `submitKey` (see "A keyed JSON submit appends at most one row per key"), for a `form` panel. A successful
submit that appends SHALL append exactly one row to the source the panel is bound to and SHALL respond
`201 Created` with that row's identity: `id` and `updatedAt` always, and `seq` only when the submitter is the form's
owner (a non-owner submitter's response carries no `seq` key). A keyed submit replayed under that requirement SHALL
append nothing and respond `200 OK` with the same body shape. The write target SHALL be the panel's persisted
binding only: the request SHALL NOT be able to name a source, and a request body carrying any key other than
`values` and `submitKey` SHALL be rejected with `400`. Fields the form does not configure SHALL be written as absent,
so the dataset's declared default (or declared requirement) applies.

#### Scenario: One row lands on the bound source only
- **WHEN** a valid submit is made for a panel bound to source A while source B also exists
- **THEN** source A has exactly one more row and source B is unchanged

#### Scenario: A request cannot redirect the write
- **WHEN** the request body is `{"values": {...}, "dataSourceId": "<other source>"}`
- **THEN** the response is `400` and no source is modified

#### Scenario: Unconfigured declared field takes its default
- **WHEN** the dataset declares `status` with a default and the form has no `status` field
- **THEN** the appended row holds the declared default for `status`

#### Scenario: A non-owner submitter gets no seq
- **WHEN** a dashboard editor who is not the form's owner submits successfully
- **THEN** the `201` response's row carries `id` and `updatedAt` and no `seq` key

#### Scenario: The form owner still gets seq
- **WHEN** the form's owner submits successfully
- **THEN** the `201` response's row carries `id`, `seq` and `updatedAt`

### Requirement: A write by a non-owner is attributed to its submitter and its auto-run to the pipeline owner

A submit that appends a row SHALL record an audit event for the append whose actor is the submitter and which names
the panel. A keyed submit replayed without appending SHALL record none (see "A duplicate keyed submit is replayed
only to its own submitter and panel, with no side effects"). Any downstream auto-run the write schedules SHALL be
submitted as, and counted against, the pipeline's owner (their HEL-505 rate limit and concurrency cap), and the run
SHALL record the last writer before it fired as the user who triggered it, as an editor's manual run does.

#### Scenario: An editor's submit triggers an auto-run counted against the pipeline owner
- **WHEN** an editor submits to a form whose dataset feeds an auto-runnable pipeline and the debounce fires
- **THEN** the run is in the pipeline owner's run history, counts toward the owner's concurrency cap, and its
  triggering user is the editor

#### Scenario: The audit event names the editor
- **WHEN** an editor submits successfully and a row is appended
- **THEN** the append's audit event has the editor as actor and carries the panel id

## ADDED Requirements

### Requirement: A keyed JSON submit appends at most one row per key

The JSON submit body (`POST /api/panels/:id/submit`) SHALL accept an optional top-level `submitKey`, a UUID string;
any other `submitKey` value SHALL be rejected with `400` and nothing written. A submit with no `submitKey` SHALL
behave exactly as before this requirement. Within the bound dataset's existing write lock, a keyed submit SHALL look
up a row of that dataset carrying the same key before validating or appending. When none exists, the submit SHALL
append as before and record the key, the submitter and the panel on the appended row. The key SHALL be kept for as
long as that row exists. The multipart (file-attached) submit SHALL NOT read or store a key.

#### Scenario: A same-key re-send appends no second row
- **WHEN** a submitter submits with key K, the row is appended, and the same submitter re-sends to the same panel
  with key K
- **THEN** the dataset holds exactly one row for K and the re-send answers `200` with the response shape of the
  original submit, built from the original row

#### Scenario: A submit with no key is unchanged
- **WHEN** a submit carries no `submitKey`
- **THEN** it appends one row and answers `201` exactly as before

#### Scenario: A malformed key is rejected
- **WHEN** `submitKey` is not a UUID string
- **THEN** the server answers `400` and appends nothing

### Requirement: A duplicate keyed submit is replayed only to its own submitter and panel, with no side effects

A same-key hit SHALL be replayed only when both the recorded submitter and the recorded panel match the current
request; any other hit SHALL answer `409` and SHALL NOT reveal the original row. A replay SHALL be masked for a
submitter who is not the form's owner exactly as a fresh submit is (no `seq`). A replay or a `409` SHALL write
nothing, record no audit event, trigger no auto-run, re-arm no debounce and update no `triggered_by_user_id`, and
its response SHALL list no denied pipelines.

#### Scenario: A different submitter's same-key submit is refused
- **WHEN** submitter A appended with key K and submitter B submits to the same dataset with key K
- **THEN** B gets `409`, nothing is appended, and the response carries no row id or `seq`

#### Scenario: A different panel's same-key submit is refused
- **WHEN** a key K row was appended through panel P1 and the same submitter submits key K through panel P2 bound to
  the same dataset
- **THEN** the submit gets `409` and nothing is appended

#### Scenario: A replay schedules no auto-run
- **WHEN** a same-key replay is answered for a dataset that feeds an auto-runnable pipeline
- **THEN** no debounce row is written or updated and no audit event is recorded for the replay

#### Scenario: A key whose submitter or panel was deleted can only conflict
- **WHEN** the panel or the user recorded on a keyed row is deleted
- **THEN** the row survives with that reference cleared, and a later submit with the same key gets `409`

### Requirement: The client retries a no-response submit with the same key, at most twice

The web client SHALL generate a fresh key for every JSON form submit and every counter click, and SHALL send it as
`submitKey`. When a request gets no HTTP response, the client SHALL re-send the same body with the same key, at most
2 more times with a short backoff, before treating the submit as indeterminate; any HTTP response, success or error,
SHALL end the retries. A manual re-click or re-submit SHALL use a new key. The counter's optimistic value SHALL be
adjusted once per click regardless of retries, and a replayed `200` SHALL be handled as an ordinary success.

#### Scenario: A lost acknowledgement is recovered without a double count
- **WHEN** a counter click's first request commits but its response is lost, and the automatic retry with the same
  key gets the replayed `200`
- **THEN** the dataset holds one row for the click, the counter shows one increment, and no error is announced

#### Scenario: Retries stop after two
- **WHEN** a submit and both of its retries get no HTTP response
- **THEN** exactly three requests were sent, all with the same key, and the existing indeterminate handling runs
