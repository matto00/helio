## ADDED Requirements

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
