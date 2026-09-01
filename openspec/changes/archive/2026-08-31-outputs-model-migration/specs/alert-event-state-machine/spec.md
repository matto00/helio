## MODIFIED Requirements

### Requirement: AlertEvent domain model
The system SHALL define an `AlertEvent` domain model with `id: AlertEventId`,
`alertRuleId: AlertRuleId`, `ownerId: UserId`, `targetOutputId: OutputId`, `value: JsValue` (the
evaluated value that triggered/updated the event), `pipelineRunId: Option[String]`,
`severity: Severity`, `state` (one of `firing`/`resolved`/`acknowledged`/`snoozed`),
`firstFiredAt: Instant`, `lastEvaluatedAt: Instant`, `resolvedAt: Option[Instant]`,
`acknowledgedAt: Option[Instant]`, and `snoozedUntil: Option[Instant]`.

#### Scenario: Model round-trips all fields
- **WHEN** an `AlertEvent` is constructed with every optional field populated
- **THEN** each field is preserved unchanged through repository insert and read-back
