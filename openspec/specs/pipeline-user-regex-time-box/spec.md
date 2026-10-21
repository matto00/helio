# pipeline-user-regex-time-box Specification

## Purpose
Bounded-time evaluation of user-supplied regex patterns (stringops extractRegex, assert regex) in pipeline steps: a fixed 2 s budget per step, shared by all rows, ending in a step error naming the step.

## Requirements

### Requirement: User regex evaluation is time-boxed per step
The backend SHALL evaluate every user-supplied regex pattern in a pipeline step (stringops operation `extractRegex`, assert rule kind `regex`) under a fixed wall-clock budget of 2 seconds per step evaluation, shared by all rows that step evaluates. The budget SHALL NOT be configurable by environment variable. When the budget is exhausted the step SHALL fail with a step error that names the step's id and kind and the pattern, and it SHALL NOT be reported as an assertion rule result. The same behaviour SHALL apply to draft preview, saved preview and real runs.

#### Scenario: Catastrophic pattern ends within the budget
- **WHEN** a stringops `extractRegex` step with pattern `^(.*a){12}$` evaluates a row whose value is 40 or more `a` characters followed by `b`
- **THEN** the step fails with a step error naming the step within the 2 second budget plus scheduling slack, instead of running for minutes

#### Scenario: Assert regex timeout is a step error
- **WHEN** an assert step's `regex` rule exhausts the budget
- **THEN** the step fails with a step error naming the assert step, and no assertion result is recorded for the timed-out evaluation

#### Scenario: Budget is shared across rows
- **WHEN** a step's pattern takes a moderate time per row (well under 2 seconds) over enough rows that the total exceeds 2 seconds
- **THEN** the step fails with the time-budget step error once the shared budget is spent

#### Scenario: Draft-preview slots are free afterwards
- **WHEN** a draft-preview request whose stringops step times out has finished
- **THEN** its in-flight slot is released and two further draft-preview requests on the same instance are both admitted

#### Scenario: Normal regexes behave identically
- **WHEN** a pattern completes within the budget
- **THEN** the result (match, non-match, extracted group 1, assertion pass/fail counts) is identical to evaluating the same `java.util.regex.Pattern` without the time box
