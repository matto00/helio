## MODIFIED Requirements

### Requirement: Pipeline-run submission enforces a per-user concurrency cap
The system SHALL reject a real (non-dry) pipeline-run submission with HTTP 429, a `Retry-After`
header, and a JSON `ErrorResponse` body when the pipeline's owner already has the configured
maximum number of real runs in flight (not yet completed or failed), counted across every
pipeline that owner owns, regardless of which backend instance or trigger path received the submission
and regardless of whether the submitter is the owner or an editor grantee of the pipeline. A real run
submitted by an editor grantee SHALL count toward, and be limited by, the pipeline owner's budget.
Dry-run submissions are NOT subject to this concurrency cap (see the pipeline-run-guard's design
documentation for why); they remain subject to the rate limit above.

#### Scenario: Under-cap submission succeeds
- **WHEN** a user has fewer than the configured maximum number of in-flight runs
- **THEN** the submission proceeds to execution

#### Scenario: Over-cap submission is rejected
- **WHEN** a user already has the configured maximum number of in-flight runs
- **THEN** the system responds with status 429, a `Retry-After` header, and a JSON `ErrorResponse` body
- **AND** the pipeline is never executed for the rejected submission

#### Scenario: Completing a run frees a concurrency slot
- **WHEN** one of a user's in-flight runs reaches a terminal state (succeeded, failed, or completed as a dry run)
- **THEN** that run no longer counts toward the user's concurrency cap, and a subsequent submission that would otherwise be rejected can succeed

#### Scenario: The concurrency cap holds across backend instances
- **WHEN** two submissions from the same user, that together would exceed the cap, are handled concurrently by different backend instances
- **THEN** at most the configured maximum number of them succeed — never more, regardless of instance

#### Scenario: A dry-run submission is not subject to the concurrency cap
- **WHEN** a user already has the configured maximum number of real runs in flight
- **THEN** a dry-run submission from that same user still proceeds to execution, unaffected by the concurrency cap

#### Scenario: An editor grantee's real run is rejected when the pipeline owner is at the cap
- **WHEN** a pipeline's owner already has the configured maximum number of real runs in flight
- **AND** an editor grantee submits a real run of that owner's pipeline
- **THEN** the system responds with status 429 and a `Retry-After` header, and the pipeline is never executed

#### Scenario: An editor grantee's in-flight real run occupies one of the owner's slots
- **WHEN** an editor grantee's real run of an owner's pipeline is in flight
- **THEN** it counts toward that owner's concurrency cap, so the owner can start at most one fewer real run until it completes
