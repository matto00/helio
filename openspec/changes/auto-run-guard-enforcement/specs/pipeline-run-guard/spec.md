## MODIFIED Requirements

### Requirement: The guard applies uniformly regardless of trigger source
The system SHALL apply both the rate limit and the concurrency cap identically whether a pipeline
run was submitted via the manual run-submission API, an external hook trigger, a scheduled
trigger, a dataset-write auto-run trigger, or any future automated trigger — no trigger path SHALL
be able to bypass either guard.

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
- **THEN** each fire is rejected exactly as a manual API submission would be, and the total number
  of `pipeline_runs` rows created from the burst never exceeds the owner's configured budget
