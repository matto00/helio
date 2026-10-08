# output-history-retention Specification

## Purpose
Bounds Output history storage by thinning points into age-dependent time buckets and purging points older than the
pipeline owner's tier maximum age, on the existing scheduler tick.

## Requirements

### Requirement: Tiered time-bucket retention on the scheduler tick
The system SHALL, from the existing pipeline scheduler tick and at most once per configured purge interval (default
60 minutes) per process, except that a pass any part of which was skipped because the retention lock was held, and no part of which raised
an error, is retried after the lock retry window, thin Output history so that within 24 hours at most one point per 5 minutes remains, between 1 and 7 days at
most one point per hour remains, and beyond 7 days at most one point per day remains, keeping the newest point of each
bucket, and SHALL delete points older than the pipeline owner's tier maximum age (free 30 days, beta 90 days, owner 365
days by default). Thinning SHALL NOT delete any of an Output's newest 101 history points (ordered by capture time, then
id, newest first — the alert `rolling_avg` maximum `n` of 100 plus the triggering run), so bucket limits apply only to
older points, each bucket keeping its newest unprotected point. The tier maximum-age purge SHALL still delete a point older than the cap even when it is among the newest
101. The protected count SHALL be a fixed constant derived from the alert `rolling_avg` maximum, not configuration.

#### Scenario: Forty days of history for free and owner Outputs
- **WHEN** a free-tier and an owner-tier Output each hold more than 101 points spread across 40 days and the scheduler
  ticks
- **THEN** each Output keeps its newest 101 points within its tier cap, plus exactly the newest point per bucket among
  its older points; the free Output keeps nothing older than 30 days and the owner Output keeps points across all 40
  days

#### Scenario: Newest points survive a sub-bucket cadence
- **WHEN** an Output holds 110 points captured one minute apart within the last two hours and the retention pass runs
- **THEN** its newest 101 points all remain, and among the 9 older points exactly the newest point of each 5-minute
  bucket remains, including a bucket that also holds protected points

#### Scenario: Age cap overrides protection
- **WHEN** a free-tier Output's only points are 5 points older than 30 days
- **THEN** the retention pass deletes all 5, although they are among the Output's newest 101

#### Scenario: Second tick within the interval is a no-op
- **WHEN** the scheduler ticks again less than the purge interval after a purge none of whose parts was skipped for the
  lock, with new thinnable points present
- **THEN** no history point is deleted, and the next tick at or after the interval thins them

#### Scenario: Shared pipeline follows the pipeline owner's tier
- **WHEN** an Editor grantee on a free tier created an Output on an owner-tier user's pipeline
- **THEN** that Output's history is retained for the owner tier's maximum age

### Requirement: Retention failures never fail the tick
A failure of the retention purge SHALL be logged at error level and SHALL NOT fail the scheduler tick or prevent the
tick's other work.

#### Scenario: Purge throws
- **WHEN** the history purge fails during a tick
- **THEN** the tick completes successfully, its scheduled-run work still runs, and the failure is logged

### Requirement: Retention runs on the privileged pool
The retention purge SHALL run on the privileged (BYPASSRLS) database pool, because no user context exists on the
scheduler tick and history is protected by forced row-level security.

#### Scenario: Two-role topology
- **WHEN** the purge runs with an app pool as a non-BYPASSRLS role and a privileged pool as `helio_privileged`
- **THEN** the purge deletes the expected points, while the same delete on the app pool without a user context
  deletes nothing

### Requirement: Env-driven retention configuration
Retention SHALL be configured from environment variables read once at startup, each falling back to its documented
default when unset, non-numeric or not positive.

#### Scenario: Unset or invalid values
- **WHEN** a retention environment variable is unset, non-numeric or not positive
- **THEN** the documented default is used for that value

### Requirement: Lock-held retention skip retries within a short window
A retention pass has two parts, the history thin/purge and the node-payload purge, each guarded by the retention
advisory lock. When any part of a pass is skipped because that lock is held by another session (a run's write-time
payload trim holding it shared, or another instance's retention pass) and no part of the pass raised an error, the
system SHALL make the next retention pass due after a short retry window (default 2 minutes) rather than the full
purge interval. A skip caused by the lock SHALL NOT be treated as a failure. When any part of a pass raised an error,
the next pass SHALL wait the full purge interval, even if another part of that pass was skipped for the lock. Points and payloads eligible for thinning or purging SHALL remain untouched by a
lock-held skip and SHALL be removed by the retry once the lock is free.

#### Scenario: Skipped once while a run holds the lock, then succeeds within the retry window
- **WHEN** a retention pass is due while another session holds the retention lock shared, and the lock is released
  before the retry window elapses
- **THEN** the first pass deletes nothing and reports a skip, a pass before the retry window elapses does not run,
  the pass at the retry window thins and age-purges the eligible points, and the following pass is due only a full
  purge interval after that successful pass

#### Scenario: Only the payload purge is skipped for the lock
- **WHEN** a due pass thins history successfully but its payload purge finds the retention lock held, and no part
  raised an error
- **THEN** the next pass is due after the retry window, not the full purge interval

#### Scenario: A failure and a lock-held skip in the same pass
- **WHEN** one part of a due pass raises an error and the other part finds the retention lock held
- **THEN** no pass runs again until the full purge interval has elapsed

#### Scenario: Genuine failure still retries at the purge interval
- **WHEN** the retention purge raises an error during a due pass
- **THEN** no pass runs again until the full purge interval has elapsed, including at the retry window

#### Scenario: Run trim while the real thin and age deletes hold rows
- **WHEN** the retention pass holds the lock exclusively and has already age-deleted points linked to a payload, and a
  run's write-time trim would delete that payload
- **THEN** the run commits within a short bound with the trim skipped, and the retention pass completes without a
  deadlock, leaving exactly the expected survivors

#### Scenario: Thin and age deletes under the guard on the two-role topology
- **WHEN** a run's write-time payload trim holds the lock shared on the privileged pool while the retention pass, also
  on the privileged pool, is due with both thin-eligible and over-age points (some linked to payloads)
- **THEN** the retention pass skips without deleting or waiting, the run commits without failing, and after the run
  commits the retried pass deletes exactly the thin-eligible and over-age points and unreferenced payloads, while the
  non-BYPASSRLS app role without a user context sees none of those rows

### Requirement: Retention lock retry window configuration
The lock-held retry window SHALL be read once at startup from `OUTPUT_HISTORY_LOCK_RETRY_SECONDS` (default 120),
falling back to the default when unset, non-numeric or not positive, and SHALL be capped at the purge interval.

#### Scenario: Retry window values
- **WHEN** `OUTPUT_HISTORY_LOCK_RETRY_SECONDS` is unset, invalid, or larger than the purge interval
- **THEN** the default 120 seconds is used for unset or invalid values, and a value larger than the purge interval is
  capped to the purge interval
