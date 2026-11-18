## ADDED Requirements

### Requirement: Backend shard packing weights reflect current suites
The per-suite weights used to pack backend test suites into CI shards SHALL be regenerated from measured CI suite
timings, cover every suite that exists in the tree at regeneration time, and be reproducible by a documented command,
so that no shard leg's predicted test time drifts toward its in-step deadline because new suites were packed at a
placeholder weight.

#### Scenario: weights cover the current suites
- **WHEN** the weights are regenerated
- **THEN** every backend test suite discovered by the build has a measured weight, and the regeneration command and the
  CI runs it read are recorded

#### Scenario: the heaviest leg has headroom
- **WHEN** the shard partition is computed from the regenerated weights
- **THEN** the predicted test time of the heaviest leg plus its measured compile time is within the headroom budget
  stated in the change's design, and a real CI run of the change shows every leg finishing inside the in-step deadline
