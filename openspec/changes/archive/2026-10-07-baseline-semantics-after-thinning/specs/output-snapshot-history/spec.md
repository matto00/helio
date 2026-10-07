## MODIFIED Requirements

### Requirement: History repository primitives
The history repository SHALL provide listing the most recent points of an Output newest first, finding the nearest point at or before an instant, finding the earliest point's timestamp, and thinning plus purging history by age-dependent time buckets and per-tier maximum age (thinning SHALL NOT delete any of an Output's newest 101 points, ordered by capture time then id, newest first, so bucketing applies only to older points, each bucket keeping its newest unprotected point; the tier maximum-age purge still deletes a point older than the cap even when it is among the newest 101), where the tier is the tier of the owner of the history point's pipeline and a tier absent from the supplied caps (including a tier unknown to the code) uses the strictest (shortest) supplied cap. Concurrent thinning/purge passes SHALL NOT run simultaneously, and a pass SHALL NOT wait on the retention lock: a pass that finds the retention lock held (by another retention pass, or shared by a run's write-time payload trim) deletes nothing and reports a lock-held skip that is distinguishable from a pass that ran and deleted nothing.

#### Scenario: Nearest point at or before
- **WHEN** points exist at t1 < t2 < t3 and the lookup instant falls between t2 and t3
- **THEN** the point at t2 is returned, and no point is returned for an instant before t1

#### Scenario: Thinning keeps the newest point per bucket
- **WHEN** several points older than an Output's newest 101 points fall in the same age-dependent bucket
- **THEN** only the newest of them remains, none of the Output's newest 101 points is deleted, points older than the pipeline owner's tier maximum age are deleted, and a second thinning pass deletes nothing

#### Scenario: Tier missing from the caps falls back to the strictest cap
- **WHEN** the caps name only some tiers and a pipeline owner's tier is not among them
- **THEN** that owner's history points older than the shortest supplied cap are deleted

#### Scenario: A pass that finds another in progress deletes nothing
- **WHEN** another session holds the retention lock (exclusively or shared) and thinning is invoked with thinnable points present
- **THEN** it reports a lock-held skip (not a zero-delete result) and no point is deleted, and a later pass after the lock is released thins them

#### Scenario: A tier unknown to the code is still age-purged
- **WHEN** the caps name some tiers and a pipeline owner has a tier not among them, even one the code has never heard of
- **THEN** that owner's points older than the shortest supplied cap are deleted
