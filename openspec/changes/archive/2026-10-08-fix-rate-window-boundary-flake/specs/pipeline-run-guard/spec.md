## MODIFIED Requirements

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

#### Scenario: Windows are fixed and aligned to the epoch
- **WHEN** a user reached the configured limit in one window and submits again after the next epoch-aligned window boundary (a whole multiple of the configured window duration since the Unix epoch)
- **THEN** the submission counts against a fresh budget for the new window, even if only seconds have passed since the previous submission
