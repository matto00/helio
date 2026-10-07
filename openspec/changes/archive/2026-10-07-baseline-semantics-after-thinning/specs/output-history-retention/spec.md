## MODIFIED Requirements

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
