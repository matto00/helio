## Purpose

Bounds Output history storage by thinning points into age-dependent time buckets and purging points older than the
pipeline owner's tier maximum age, on the existing scheduler tick.

## ADDED Requirements

### Requirement: Tiered time-bucket retention on the scheduler tick
The system SHALL, from the existing pipeline scheduler tick and at most once per configured purge interval (default
60 minutes) per process, thin Output history so that within 24 hours at most one point per 5 minutes remains, between
1 and 7 days at most one point per hour remains, and beyond 7 days at most one point per day remains, keeping the newest
point of each bucket, and SHALL delete points older than the pipeline owner's tier maximum age (free 30 days, beta 90
days, owner 365 days by default).

#### Scenario: Forty days of history for free and owner Outputs
- **WHEN** a free-tier and an owner-tier Output each hold points spread across 40 days and the scheduler ticks
- **THEN** the free Output keeps exactly the newest point per bucket no older than 30 days, and the owner Output keeps
  exactly the newest point per bucket across all 40 days

#### Scenario: Second tick within the interval is a no-op
- **WHEN** the scheduler ticks again less than the purge interval after a purge, with new thinnable points present
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
