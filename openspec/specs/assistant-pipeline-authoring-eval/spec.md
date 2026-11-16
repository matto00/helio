# assistant-pipeline-authoring-eval Specification

## Purpose
A measured, repeatable replay eval of the workspace assistant's pipeline-and-dashboard authoring, so prompt and
tool-schema changes are judged by failed-call rate and apply success rather than by inspection.

## Requirements

### Requirement: Replay eval set with a fixture workspace
The repository SHALL provide an assistant eval runner, excluded from the default test suite, that seeds a fixture
workspace mirroring the 2026-10-16 Standings transcript (rosters source, users source, a pipeline with a lookup and a
table Output, a "Standings" dashboard) plus at least three other cases, drives each case's single user message through
the real conversation loop, and records tool calls, failed tool calls, whether the final proposal applied, and token
cost per case.

#### Scenario: Standings case applies cleanly
- **WHEN** the eval runs the request "Can you add more charts to my Standings dashboard?" on the current prod model
- **THEN** the run has exactly one successful propose call, it previews and really applies, the hop budget is not exhausted, and
  at most 2 tool results are errors (`isError`, including decode errors and one-propose rejections)

#### Scenario: Default test suite never calls the model
- **WHEN** the backend suite runs via `sbt testFull`
- **THEN** no eval case runs and no request is sent to Anthropic

#### Scenario: Live spend is capped
- **WHEN** cumulative eval cost reaches the configured cap
- **THEN** the runner stops before the next model call and reports the spend so far
