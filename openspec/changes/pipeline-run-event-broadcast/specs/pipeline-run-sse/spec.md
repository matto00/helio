## ADDED Requirements

### Requirement: Every live subscriber for a pipeline receives every published event
`PipelineRunRegistry` SHALL support multiple concurrent subscribers per pipeline ID. A `publish` call
SHALL deliver the event to every currently-subscribed client for that pipeline, not only the most
recently subscribed one. Subscribing a second (or further) client for a pipeline ID that already has
live subscribers SHALL NOT remove or otherwise disrupt delivery to the existing subscriber(s).

#### Scenario: Two concurrent subscribers both receive a published event
- **GIVEN** two independent clients have each subscribed to the same pipeline's run-events
- **WHEN** an event is published for that pipeline
- **THEN** both subscribers' streams receive the event

#### Scenario: A third subscriber joining does not disrupt existing subscribers
- **GIVEN** two clients are already subscribed to a pipeline's run-events
- **WHEN** a third client subscribes to the same pipeline, then an event is published
- **THEN** all three subscribers' streams receive the event

### Requirement: A subscriber connected to a different backend instance still receives events
Pipeline run-status events SHALL be delivered to every live subscriber for a pipeline regardless of
which backend instance executed the run and which backend instance holds that subscriber's connection,
when multiple instances share the same database. This delivery mechanism SHALL NOT bypass or weaken the
existing subscribe-time access control (`pipelineExistsShared`): only clients who already passed that
check ever receive event data, on any instance. No externally-reachable input (request parameter,
header, or otherwise) SHALL influence the cross-instance delivery channel used.

#### Scenario: Event published on one instance reaches a subscriber connected to another instance
- **GIVEN** two backend instances share one database, and a client's run-events connection is held open
  on instance B
- **WHEN** a pipeline run is executed and its status events are published on instance A
- **THEN** the subscriber connected to instance B receives those events

#### Scenario: Cross-instance delivery does not leak across pipelines or tenants
- **GIVEN** two backend instances share one database, with a subscriber on instance B for pipeline X
  only
- **WHEN** an event is published on instance A for a different pipeline Y that instance B's subscriber
  never subscribed to
- **THEN** the subscriber for pipeline X receives no event data for pipeline Y

### Requirement: Subscribers are cleaned up when their connection closes
When a subscribed client's stream terminates (client disconnect, or normal completion), the registry
SHALL remove that subscriber from the pipeline's live-subscriber set. A subsequently published event for
that pipeline SHALL NOT be delivered to the removed subscriber, and its removal SHALL NOT affect delivery
to any other still-live subscriber of the same pipeline.

#### Scenario: A disconnected subscriber no longer receives events, other subscribers unaffected
- **GIVEN** two clients are subscribed to the same pipeline's run-events
- **WHEN** one client disconnects, then an event is published for that pipeline
- **THEN** the disconnected client's stream is not delivered the event, and the still-connected client's
  stream still receives it
