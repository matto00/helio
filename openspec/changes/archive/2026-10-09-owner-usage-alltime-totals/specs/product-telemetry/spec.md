## ADDED Requirements

### Requirement: Monthly active users rollup
The daily active-users rollup SHALL also record, per UTC day, the number of distinct users with any product event in the trailing 30 UTC days ending that day. The value SHALL be written as `null` when the 30-day window's first day is not inside raw-event retention at rollup time (partial raw rows would under-count); a later re-roll of the same day that cannot compute it SHALL keep a value previously computed while the window was inside retention (never overwrite it with null). A computable re-roll SHALL recompute it idempotently with the rest of the day's rollup. Days rolled up before this value existed are not backfilled.

#### Scenario: Thirty-day distinct count
- **WHEN** fixture users emit events on days spread across a 30-day window and the rollup runs for its last day
- **THEN** the stored 30-day value equals the hand-counted distinct users across that window, counting a user active on several days once

#### Scenario: Not computable outside retention
- **WHEN** a day is rolled up for the first time and its 30-day window starts at or before the retention cutoff
- **THEN** its 30-day value is `null`

#### Scenario: Re-roll after the window left retention keeps the earlier value
- **WHEN** a day's 30-day value was computed inside retention and the day is re-rolled after the window's first day has left retention
- **THEN** the stored 30-day value is unchanged, not null
