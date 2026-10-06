## MODIFIED Requirements

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

## ADDED Requirements

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
