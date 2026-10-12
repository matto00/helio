## MODIFIED Requirements

### Requirement: The guard applies uniformly regardless of trigger source
The system SHALL apply both the rate limit and the concurrency cap identically whether a pipeline
run was submitted via the manual run-submission API, an external hook trigger, a scheduled
trigger, a dataset-write auto-run trigger, or any future automated trigger — no trigger path SHALL
be able to bypass either guard. A dataset-write auto-run MAY be withheld BEFORE submission when a
read-only pre-check of the same in-flight count shows the owner already at the concurrency cap; that
withholding consumes no rate slot, is stricter than (never looser than) the guard, and leaves the
bound on created runs unchanged, because admission still happens only in the guarded submission path.

#### Scenario: A hook-triggered submission is subject to the same guards as a manual one
- **WHEN** an external hook trigger submits a run for a user already at their rate or concurrency limit
- **THEN** the submission is rejected exactly as a manual API submission would be

#### Scenario: A scheduled submission is subject to the same guards as a manual one
- **WHEN** a scheduled trigger fires a run for a user already at their rate or concurrency limit
- **THEN** the submission is rejected exactly as a manual API submission would be

#### Scenario: An auto-run submission is subject to the same guards as a manual one
- **WHEN** a dataset-write-triggered auto-run fires for a pipeline whose owner is already at their
  rate or concurrency limit, whether the debounce window collapsed a burst of writes into one fire
  or the burst was spread across multiple debounce windows (multiple individual fires)
- **THEN** each fire is rejected as a manual API submission would be, except that a fire that would
  hit the owner's concurrency cap may be withheld before submission by a read-only pre-check of the
  same count, consuming no rate slot; either way no run is created, and the total number of
  `pipeline_runs` rows created from the burst never exceeds the owner's configured budget
