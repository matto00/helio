## Purpose

Caps how many pipeline runs a single user can submit and have in flight at once, enforced
globally across every backend instance and every trigger path (manual, hook/external, scheduled,
and any future automated trigger), so no single user or automated trigger can exhaust compute.

## ADDED Requirements

### Requirement: Pipeline-run submission enforces a per-user rate limit
The system SHALL reject a pipeline-run submission (dry or real) with HTTP 429, a `Retry-After`
header, and a JSON `ErrorResponse` body when the submitting user has already submitted the
configured limit of runs within the current window, regardless of which backend instance or
trigger path (manual API, external hook, scheduled, or any future automated trigger) received the
submission. Dry-run submissions count toward this rate limit identically to real-run submissions.

#### Scenario: Under-limit submission succeeds
- **WHEN** a user has submitted fewer runs than the configured per-window limit
- **THEN** the submission proceeds to execution

#### Scenario: Over-limit submission is rejected
- **WHEN** a user has already submitted the configured limit of runs within the current window
- **THEN** the system responds with status 429, a `Retry-After` header, and a JSON `ErrorResponse` body
- **AND** the pipeline is never executed for the rejected submission

#### Scenario: The rate limit holds across backend instances
- **WHEN** a user's submissions are handled by different backend instances within the same window
- **THEN** the combined count across all instances is what the limit is enforced against, not each instance's own count independently

### Requirement: Pipeline-run submission enforces a per-user concurrency cap
The system SHALL reject a real (non-dry) pipeline-run submission with HTTP 429, a `Retry-After`
header, and a JSON `ErrorResponse` body when the submitting user already has the configured
maximum number of real runs in flight (not yet completed or failed), counted across every
pipeline they own, regardless of which backend instance or trigger path received the submission.
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

### Requirement: The guard applies uniformly regardless of trigger source
The system SHALL apply both the rate limit and the concurrency cap identically whether a pipeline
run was submitted via the manual run-submission API, an external hook trigger, a scheduled
trigger, or any future automated trigger — no trigger path SHALL be able to bypass either guard.

#### Scenario: A hook-triggered submission is subject to the same guards as a manual one
- **WHEN** an external hook trigger submits a run for a user already at their rate or concurrency limit
- **THEN** the submission is rejected exactly as a manual API submission would be

#### Scenario: A scheduled submission is subject to the same guards as a manual one
- **WHEN** a scheduled trigger fires a run for a user already at their rate or concurrency limit
- **THEN** the submission is rejected exactly as a manual API submission would be

### Requirement: Limits are configurable via environment variable with conservative defaults
The system SHALL read the rate limit, its window duration, the concurrency cap, and the
concurrency rejection's advisory `Retry-After` value from environment variables, applying
documented conservative defaults when unset.

#### Scenario: Defaults apply when env vars are unset
- **WHEN** the pipeline-run guard's environment variables are not set
- **THEN** the system applies its documented default rate limit, window duration, concurrency cap, and advisory retry-after value
