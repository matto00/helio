## ADDED Requirements

### Requirement: The auto-run eligibility verdict is re-evaluated when the debounced run fires

When the scheduler claims a due auto-run debounce row, it SHALL re-evaluate the same eligibility verdict the write-time trigger computes (cost verdict plus schema-independent step-config check over enabled steps) before submitting. If the pipeline is denied at fire time, the scheduler SHALL NOT submit a run, SHALL log the denial reasons, and SHALL release the claim so the debounce row is removed. No failed run is recorded for a fire-time auto-run denial. Schema-derived analyze errors SHALL NOT deny.

#### Scenario: Config made invalid during the debounce window
- **WHEN** an allowed dataset write schedules a debounced auto-run and an enabled step is made misconfigured before the debounce row fires
- **THEN** the claimed row is not submitted, the denial is logged, and the debounce row is removed

#### Scenario: Cost verdict flips to denied before fire
- **WHEN** an allowed dataset write schedules a debounced auto-run and the pipeline fails the cost verdict by the time the row is claimed
- **THEN** the claimed row is not submitted and the debounce row is removed

#### Scenario: Pending row from an earlier allowed write after a later denied write
- **WHEN** an allowed write leaves a pending debounce row, the pipeline is then made misconfigured, and a later write is denied at write time
- **THEN** the pending row does not submit a run when it fires

#### Scenario: Fire-time evaluation fails
- **WHEN** the fire-time evaluation of a claimed debounce row fails with an error (including a stored step config that cannot be decoded)
- **THEN** no run is submitted, the error is logged, and the claim is released, so it is not retried in a loop
