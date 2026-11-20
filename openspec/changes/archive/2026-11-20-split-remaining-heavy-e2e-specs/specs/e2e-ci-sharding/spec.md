## ADDED Requirements

### Requirement: Each e2e CI leg records the runner it ran on
Each e2e CI leg SHALL record, as an artifact separate from its test report, the runner's CPU model, vCPU count and total
memory, and a sample of the runner's load at least once per second while the suite runs (CPU busy, steal and iowait
percentages and run queue), from the start of the job's setup to the end of the suite. The record SHALL never fail a
leg, its sampler SHALL be started before setup with a fixed self-stop bound shorter than the job limit (so it exits
before the job limit even if never stopped), and its artifact
name SHALL NOT match the name pattern of the per-leg test reports used to regenerate shard weights. The record SHALL NOT
include environment variables or secrets.

#### Scenario: A slow leg can be attributed
- **WHEN** one e2e leg of a run is markedly slower than the others
- **THEN** that leg's artifact shows its CPU model and its load and steal over the suite, so the slowdown can be compared
  with the runner of every other leg of the run

#### Scenario: The record cannot fail or extend a leg
- **WHEN** the runner record step or the load sampler fails or is not stopped
- **THEN** the leg's result is decided by the test suite alone, and the sampler, started before setup with a self-stop
  bound shorter than the job limit, exits by itself before that limit

#### Scenario: Weight regeneration is unaffected
- **WHEN** the shard weights are regenerated from a run's artifacts
- **THEN** the runner records are not read as test reports, and each leg still has exactly one test report
