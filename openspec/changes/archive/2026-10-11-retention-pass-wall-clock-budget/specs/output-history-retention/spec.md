## MODIFIED Requirements

### Requirement: Retention failures never fail the tick
A failure of the retention purge SHALL be logged at error level and SHALL NOT fail the scheduler tick or prevent the
tick's other work. The scheduler tick SHALL start the retention pass without waiting for it to finish, so the tick's
completion, and therefore the next scheduler tick and every scheduled pipeline fire, SHALL NOT be delayed by the
duration of a retention pass. Wherever a retention requirement says that a pass continues or is due "on the next scheduler
tick", that SHALL mean the first scheduler tick at or after the end of that pass.

#### Scenario: Purge throws
- **WHEN** the history purge fails during a tick
- **THEN** the tick completes successfully, its scheduled-run work still runs, and the failure is logged

#### Scenario: A slow retention pass does not hold the tick
- **WHEN** a retention pass is due and has not finished
- **THEN** the scheduler tick completes once its own work (due schedules, cleanup, auto-run, telemetry) is done, and a
  due schedule fires without waiting for the retention pass

## ADDED Requirements

### Requirement: At most one retention pass in flight per process
The system SHALL run at most one retention pass at a time within a process. A scheduler tick that finds a pass still in
flight SHALL NOT start another pass and SHALL NOT consume or move the next-due time, regardless of the configured purge
interval. The in-flight state SHALL be released when the pass ends by success, failure or a synchronous error.

#### Scenario: Tick during an in-flight pass
- **WHEN** a retention pass is still running and a later tick finds retention due
- **THEN** no second pass starts, and once the first pass ends the next pass is due exactly as that pass's outcome
  determines

#### Scenario: A failed pass releases the guard
- **WHEN** a retention pass fails with an error
- **THEN** the failure is logged and a later tick at or after the next-due time starts a new pass
