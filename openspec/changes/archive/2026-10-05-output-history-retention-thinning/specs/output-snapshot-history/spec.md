## MODIFIED Requirements

### Requirement: History repository primitives
The history repository SHALL provide listing the most recent points of an Output newest first, finding the nearest point at or before an instant, finding the earliest point's timestamp, and thinning plus purging history by age-dependent time buckets and per-tier maximum age, where the tier is the tier of the owner of the history point's pipeline and a tier absent from the supplied caps (including a tier unknown to the code) uses the strictest (shortest) supplied cap. Concurrent thinning/purge passes SHALL NOT run simultaneously: a pass that finds another in progress deletes nothing.

#### Scenario: Nearest point at or before
- **WHEN** points exist at t1 < t2 < t3 and the lookup instant falls between t2 and t3
- **THEN** the point at t2 is returned, and no point is returned for an instant before t1

#### Scenario: Thinning keeps the newest point per bucket
- **WHEN** several points fall in the same age-dependent bucket
- **THEN** only the newest point in that bucket remains, points older than the pipeline owner's tier maximum age are deleted, and a second thinning pass deletes nothing

#### Scenario: Tier missing from the caps falls back to the strictest cap
- **WHEN** the caps name only some tiers and a pipeline owner's tier is not among them
- **THEN** that owner's history points older than the shortest supplied cap are deleted

#### Scenario: A pass that finds another in progress deletes nothing
- **WHEN** another session holds the purge lock and thinning is invoked with thinnable points present
- **THEN** it returns 0 and no point is deleted, and a later pass after the lock is released thins them

#### Scenario: A tier unknown to the code is still age-purged
- **WHEN** the caps name some tiers and a pipeline owner has a tier not among them, even one the code has never heard of
- **THEN** that owner's points older than the shortest supplied cap are deleted
