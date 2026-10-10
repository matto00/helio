# output-history-retention Specification

## Purpose
Bounds Output history storage by thinning points into age-dependent time buckets and purging points older than the
pipeline owner's tier maximum age, on the existing scheduler tick.

## Requirements

### Requirement: Tiered time-bucket retention on the scheduler tick
The system SHALL, from the existing pipeline scheduler tick and at most once per configured purge interval (default
60 minutes) per process, except that a pass any part of which was skipped because the retention lock was held, and no
part of which raised an error, is retried after the lock retry window, and except that a pass that stopped because it
exhausted its thin batch budget continues on the next scheduler tick, thin Output history so that within 24 hours at
most one point per 5 minutes remains, between 1 and 7 days at most one point per hour remains, and beyond 7 days at
most one point per day remains, keeping the newest point of each bucket, and SHALL delete points older than the
pipeline owner's tier maximum age (free 30 days, beta 90 days, owner 365 days by default). Thinning SHALL NOT delete
any of an Output's newest 101 history points (ordered by capture time, then id, newest first — the alert `rolling_avg`
maximum `n` of 100 plus the triggering run), so bucket limits apply only to older points, each bucket keeping its
newest unprotected point. The tier maximum-age purge SHALL still delete a point older than the cap even when it is
among the newest 101. The protected count SHALL be a fixed constant derived from the alert `rolling_avg` maximum, not
configuration.

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
- **WHEN** the scheduler ticks again less than the purge interval after a pass that completed the thin cycle (every
  Output thinned), none of whose parts was skipped for the lock or raised an error, with new thinnable points present
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
A retention pass has two parts, the history batches (each age-purging then thinning a bounded set of Outputs) and the
node-payload purge, each guarded by the retention advisory lock in its own transaction(s). When any part of a pass is skipped because that lock
is held by another session (a run's write-time payload trim holding it shared, or another instance's retention pass)
and no part of the pass raised an error, the system SHALL make the next retention pass due after a short retry window
(default 2 minutes) rather than the full purge interval. A skip caused by the lock SHALL NOT be treated as a failure.
When any part of a pass raised an error, the next pass SHALL wait the full purge interval, even if another part of that
pass was skipped for the lock. Points and payloads eligible for thinning or purging that the skipped part would have
removed SHALL remain untouched by that skip (thin batches already committed earlier in the pass stay committed) and
SHALL be removed by the retry once the lock is free.

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
- **WHEN** one part of a due pass raises an error and another part finds the retention lock held
- **THEN** no pass runs again until the full purge interval has elapsed

#### Scenario: Genuine failure still retries at the purge interval
- **WHEN** the retention purge raises an error during a due pass
- **THEN** no pass runs again until the full purge interval has elapsed, including at the retry window

#### Scenario: Run trim while the real thin and age deletes hold rows
- **WHEN** the retention pass holds the lock exclusively in a history batch whose age or thin deletes have already
  removed points linked to a payload, and a run's write-time trim would delete that payload
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

### Requirement: Thinning runs in bounded batches
The history thin SHALL run as a sequence of statements, each over whole Outputs, at most the configured number of
Outputs and at most the configured number of history rows (except that a single Output whose own rows exceed the row
limit forms a batch by itself), each in its own transaction under the retention advisory lock, and SHALL leave, for
each Output, exactly the same surviving points as thinning all Outputs in one statement at the reference time of the
pass that thins that Output. A retention pass SHALL run at most the configured number of thin batches; when that
budget is exhausted before every Output was thinned, the pass SHALL report that more work remains and the following
pass SHALL resume with the Outputs not yet thinned in this cycle. Batches committed before a lock-held skip or an error
SHALL stay committed. Each batch SHALL first delete, for that batch's Outputs, the points older than their pipeline owner's tier maximum
age and then thin the batch, so the tier maximum-age purge is bounded by the same batch limits and deletes, at the
pass's reference time, exactly the points the unbounded purge would. A pass whose batch was skipped for the lock or
raised an error SHALL run no further batch. The node-payload purge SHALL run on every pass regardless of the history
part's outcome.

The next pass SHALL be due, in this order of precedence over every part of the pass (history batches, payload purge): after the full purge interval when any part raised an error; otherwise after the lock retry window when any
part was skipped because the retention lock was held; otherwise on the next scheduler tick when the thin batch budget
was exhausted with Outputs remaining; otherwise (the thin cycle completed) after the full purge interval.

#### Scenario: Batched thinning matches one-statement thinning
- **WHEN** Outputs of every tier hold points across all three age classes, including ties on capture time and points
  on both sides of the newest-101 boundary, and the retention pass thins them in batches of one or more Outputs
- **THEN** the surviving points are exactly those the single-statement thin leaves on the same data at the same
  reference time

#### Scenario: A backlog drains over several ticks
- **WHEN** more Outputs hold thinnable points than one pass's batch budget covers
- **THEN** the first pass thins only the Outputs its budget covers, reports more work remaining, the next scheduler
  tick thins the following Outputs without waiting the purge interval, and once every Output has been thinned the
  next pass is due a full purge interval later

#### Scenario: A deep backlog on many Outputs never forms one large transaction
- **WHEN** many Outputs each hold far more points than the steady state
- **THEN** every thin statement ranks at most the configured row limit, or the rows of one single Output when that
  Output alone exceeds it, and the backlog is fully thinned after enough passes

#### Scenario: A deep over-age backlog is purged in bounded transactions
- **WHEN** free and beta Outputs hold dense points far past their tier caps
- **THEN** each transaction reads at most the configured row limit of history rows (or one Output's rows when it alone
  exceeds it), and once the thin cycle is complete no point older than its tier cap remains

#### Scenario: A failure during a drain waits the full interval
- **WHEN** a pass exhausts its thin batch budget and its payload purge raises an error
- **THEN** the next pass is due after the full purge interval, not on the next scheduler tick, and it resumes with the
  Outputs not yet thinned

#### Scenario: A lock-held part during a drain uses the retry window
- **WHEN** a pass exhausts its thin batch budget and its payload purge is skipped because the lock is held, and no part
  raised an error
- **THEN** the next pass is due after the lock retry window

#### Scenario: Lock held part-way through a pass
- **WHEN** another session takes the retention lock after a pass committed some thin batches
- **THEN** the committed batches stay thinned, the remaining Outputs are untouched, the skip is not a failure, and the
  retry after the lock retry window resumes with the remaining Outputs

### Requirement: Thin batch configuration
The maximum Outputs per thin batch, the history-row limit per thin batch and the maximum thin batches per pass SHALL be
read once at startup from `OUTPUT_HISTORY_THIN_BATCH_OUTPUTS`, `OUTPUT_HISTORY_THIN_BATCH_ROWS` and
`OUTPUT_HISTORY_THIN_MAX_BATCHES_PER_PASS`, each falling back to its documented default when unset, non-numeric or not
positive.

#### Scenario: Unset or invalid batch values
- **WHEN** any thin batch environment variable is unset, non-numeric or not positive
- **THEN** the documented default is used for that value
