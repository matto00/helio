# audit-event-recording Specification

## Purpose
The write path for security audit events — the `AuditService.record(...)` contract and its
guarantee that recording an audit event never fails, blocks, or otherwise perturbs the primary
request it describes.

## Requirements

### Requirement: AuditService records an event
The system SHALL provide an `AuditService` exposing
`record(actor, source, action, resourceType, resourceId, metadata)` returning `Future[Unit]`,
which appends a corresponding audit event carrying the supplied actor, source, action, resource
type, resource id, and metadata.

#### Scenario: A recorded event reaches the store
- **WHEN** `record` is called with an actor, source, action, resource type, resource id, and metadata
- **THEN** an audit event is appended carrying exactly those values

#### Scenario: A system event carries no actor
- **WHEN** `record` is called for a system-sourced event with no acting user or token
- **THEN** an audit event is appended with a null actor user id and a null actor token id

### Requirement: Audit recording never fails the caller
`AuditService.record(...)` SHALL isolate all failures of the underlying store. A failed append
SHALL be logged and SHALL NOT produce a failed `Future`, throw, or otherwise propagate to the
caller's request path.

#### Scenario: A failing store does not fail the caller
- **GIVEN** an `AuditEventRepository` whose `append` returns a failed `Future`
- **WHEN** `record` is called
- **THEN** the returned `Future` completes successfully and the failure is logged

#### Scenario: A throwing store does not fail the caller
- **GIVEN** an `AuditEventRepository` whose `append` throws synchronously
- **WHEN** `record` is called
- **THEN** the returned `Future` completes successfully and the failure is logged

### Requirement: The audit event model accommodates non-request producers
The audit event model SHALL be expressible for events that originate outside a user request —
including future rate-limit trip events — via the `system` source, a null actor user id, and the
`metadata` field, without requiring a schema or model change.

This change SHALL NOT instrument, import, or otherwise depend on any existing route, directive, or
service; accommodation is by model shape only.

#### Scenario: A rate-limit trip event is expressible
- **WHEN** an event describing a throttled principal is constructed with source `system` and
  limit details in `metadata`
- **THEN** it is a valid audit event requiring no schema or model change

#### Scenario: No existing component is instrumented
- **WHEN** `git diff <base>...HEAD` for this change is filtered for `ratelimit` or `rate_limit`,
  case-insensitively
- **THEN** the output is empty
- **AND** `files-modified.md` lists no route or directive file
- **AND** this is recorded as captured command output, not as a reviewer's assertion
