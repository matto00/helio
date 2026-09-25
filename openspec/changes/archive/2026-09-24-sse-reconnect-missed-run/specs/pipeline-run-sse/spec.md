## MODIFIED Requirements

### Requirement: SSE subscriber receives events published after connection opens
A client that connects to `run-events` before a run is posted SHALL receive all subsequent
status events for that pipeline in order. A subscriber whose connection is (re)established —
including the reconnect a fan-out consumer performs after every terminal event — SHALL also be
reconciled against the pipeline's actual latest persisted run outcome, so that a run which reaches
a terminal status while no subscriber was live (the gap between the old connection closing and the
new one registering, or before any subscriber ever connects) is never permanently lost. This
reconciliation SHALL be based on the durably persisted `pipeline_runs` record, not on the ephemeral
event stream, and SHALL hold when the run executed on a different backend instance than the one
serving the (re)connecting subscriber's stream (see the cross-instance-delivery requirement below).

A run outcome already delivered to a listener — whether via the live event stream or via
reconciliation — SHALL NOT be redelivered for the same run.

#### Scenario: Subscriber receives full event sequence for a run
- **WHEN** a client connects to `run-events`, then `POST /api/pipelines/:id/run` is called
- **THEN** the SSE stream delivers `queued`, `running`, and `succeeded` (or `failed`) events in order

#### Scenario: No events received for a different pipeline
- **WHEN** a client subscribes to pipeline A's run-events, and a run is posted for pipeline B
- **THEN** the client for pipeline A receives no events

#### Scenario: A run completing during a reconnect gap is still observed
- **GIVEN** a subscriber's connection has closed after a prior run's terminal event and has not
  yet reopened
- **WHEN** a second run is posted and reaches a terminal `succeeded` status entirely within that
  gap
- **THEN** the subscriber, once its connection is reestablished, still learns that the second run
  succeeded — without requiring a page reload or a third run

#### Scenario: A run's outcome is not redelivered
- **GIVEN** a subscriber already learned a given run's `succeeded` outcome
- **WHEN** the subscriber's connection reconnects again with no new run having completed
- **THEN** the subscriber's listener is not invoked again for that same run
