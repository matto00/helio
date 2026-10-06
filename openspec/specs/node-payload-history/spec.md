# node-payload-history Specification

## Purpose
Opt-in, size-capped and tier-retained storage of a materialized node's full row payload for each real pipeline
run, linked to that run's per-Output summary history points, plus the authenticated endpoint that returns a
stored payload for one history point.

## Requirements

### Requirement: Payload opt-in lives on the Output config
The system SHALL treat `outputs.config.historyPayloads` as the payload opt-in. It SHALL be a JSON boolean; absent
or `null` SHALL mean off. Every Output config write path that validates `config.compare` SHALL reject any other
type with `400`.

#### Scenario: Non-boolean flag is rejected
- **WHEN** a client PATCHes an Output with `config.historyPayloads` set to `"yes"`
- **THEN** the response is `400` and the Output's stored config is unchanged

#### Scenario: Default is off
- **WHEN** an Output's config has no `historyPayloads` key and its pipeline runs successfully
- **THEN** no payload is stored for that Output's history point

### Requirement: Payloads are written with the node snapshot, under caps and tier limits
On a real, unblocked, successful run (the same runs that record summary history), the system SHALL store one
payload per materialized node when at least one Output on that node has `historyPayloads: true`. The payload SHALL
hold the node's full row set as a single JSON array and SHALL be written in the same transaction as that node's
snapshot replace and summary insert. Only the opted-in Outputs' history points SHALL reference the payload. A
payload SHALL NOT be stored when the pipeline owner's tier allows zero payload runs, when the row count exceeds
the configured row cap (default 1000), or when the serialized array exceeds the configured byte cap (default
1 MiB). In the over-cap case the summary SHALL still be written and a WARN SHALL be logged. A payload SHALL never
be truncated.

#### Scenario: Free tier writes nothing
- **WHEN** a free-tier user's opted-in Output's pipeline runs successfully
- **THEN** its summary point is recorded with no payload, and no payload row exists for the pipeline

#### Scenario: Over the byte cap
- **WHEN** an opted-in beta-tier node produces rows whose serialized array exceeds the byte cap
- **THEN** no payload is stored for that run, the summary point is recorded, and a WARN is logged

#### Scenario: Over the row cap
- **WHEN** an opted-in owner-tier node produces more rows than the row cap
- **THEN** no payload is stored for that run and the summary point is recorded

#### Scenario: Atomic with the snapshot
- **WHEN** the payload insert fails during a node's write
- **THEN** that node's snapshot replace and summary insert are rolled back too

#### Scenario: Dry run writes nothing
- **WHEN** an opted-in Output's pipeline is dry-run
- **THEN** no payload is stored

### Requirement: Payload retention is tier-bounded and never outlives its summary points
The system SHALL keep at most the tier's run count of payloads per node, newest first (defaults: free 0, beta 10,
owner 30), and none older than the tier's age limit (defaults: free 0 days, beta 7, owner 30). The tier SHALL be
that of the pipeline's owner. The count SHALL be enforced at write time whenever the history retention pass is not
running at that moment; while the retention pass is running, the write-time enforcement SHALL be skipped for that
write and the excess SHALL be removed by a later retention pass. Age, count, tier changes and payloads no summary
point references SHALL be enforced on the existing history retention pass. A tier the configuration does not name
SHALL be treated as allowing no payloads.

#### Scenario: Count cap at write
- **WHEN** a beta-tier opted-in node's 11th payload is written while the retention pass is not running
- **THEN** only the 10 newest payloads for that node remain

#### Scenario: Count cap deferred while retention runs
- **WHEN** a beta-tier opted-in node's 11th payload is written while the retention pass is running
- **THEN** the write succeeds with 11 payloads for that node, and after the next retention pass only the 10 newest
  remain

#### Scenario: Tier downgrade
- **WHEN** an owner-tier pipeline owner is downgraded to free and the retention pass runs
- **THEN** every payload on that owner's pipelines is deleted and the summary points remain

#### Scenario: Thinned summary point
- **WHEN** retention thinning removes every summary point that referenced a payload
- **THEN** the same retention pass deletes that payload

### Requirement: Payload read endpoint is authenticated and sharing-aware
`GET /api/outputs/:id/history/:point/rows` SHALL return the stored payload for the history point `:point` of
Output `:id` as `{pointId, outputId, capturedAt, runId, triggerSource, rowCount, rows}`. Access SHALL be authorized
exactly as `GET /api/outputs/:id/history`. An unknown or inaccessible Output, a point that does not belong to that
Output, and a point with no stored payload SHALL each return `404`. No public or unauthenticated route SHALL ever
return payload rows.

#### Scenario: Owner reads a payload
- **WHEN** the owner requests the rows of a point that has a payload
- **THEN** the response is `200` with the stored rows in their original order

#### Scenario: Grantee reads a payload
- **WHEN** a user granted access to the pipeline requests the rows
- **THEN** the response is `200`

#### Scenario: Stranger
- **WHEN** a user with no access requests the rows
- **THEN** the response is `404`, identical to an unknown Output

#### Scenario: Point from another Output
- **WHEN** the point id belongs to a different Output
- **THEN** the response is `404`

#### Scenario: Public dashboard
- **WHEN** an anonymous viewer requests any payload path under the public dashboard routes
- **THEN** no payload rows are returned

### Requirement: Payload storage is protected by sharing-aware row-level security
`node_payload_history` SHALL have RLS enabled and forced, with policies gated on access to the row's pipeline,
mirroring node snapshots. These policies SHALL hold for a non-superuser, non-BYPASSRLS role, and the privileged
role SHALL be able to read, write and delete the table.

#### Scenario: Non-BYPASSRLS stranger sees nothing
- **WHEN** a non-BYPASSRLS session scoped to a user with no access to the pipeline selects from the table
- **THEN** zero rows are returned, while the owner's and a grantee's sessions see the row

### Requirement: Retention housekeeping never fails or blocks a run
A run's per-node history write SHALL NOT wait on, deadlock with, or fail because of a concurrently running history
retention pass (summary-point thinning/purge or payload purge). Concurrent runs SHALL NOT serialize on each other
because of payload retention.

#### Scenario: Run writes while retention holds the linked points
- **WHEN** the retention pass is mid-transaction and has row-locked summary points linked to the payload a node's
  write would trim
- **THEN** that node's write commits without waiting for the retention pass, and the retention pass also completes
  without a deadlock error

#### Scenario: Two runs write concurrently
- **WHEN** two runs write opted-in nodes at the same time and no retention pass is running
- **THEN** both writes enforce the count cap and neither waits on the other for the retention guard
