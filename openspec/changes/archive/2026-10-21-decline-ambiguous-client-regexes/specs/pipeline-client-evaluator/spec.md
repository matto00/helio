## ADDED Requirements

### Requirement: Backtracking-prone regex patterns are declined to the server
The client evaluator SHALL decline, with the reason `unsafeRegex` and without producing rows, any stringops
`extractRegex` pattern whose structure permits super-linear backtracking per start position, so that the pattern is
evaluated by the server draft preview under the server's per-step regex time budget. Such a pattern in a draft
SHALL NOT block the browser main thread for more than 100 milliseconds. Every pattern the client evaluator still
accepts SHALL have a per-cell evaluation cost that grows at most quadratically with the cell's length. Every pattern
the shared parity corpus evaluates client-side today SHALL remain client-evaluated with unchanged results, and a
pattern declined by this rule SHALL produce, via the server, the same rows a real run produces.

#### Scenario: Stacked unbounded quantifiers are declined
- **WHEN** a draft stringops `extractRegex` step uses `^(a*a*a*a*a*a*a*a*a*a*)$`
- **THEN** the client evaluator declines the step as `unsafeRegex` and produces no rows for it

#### Scenario: Stacked bounded choices are declined
- **WHEN** a draft stringops `extractRegex` step uses 25 consecutive `a?` atoms, or 30 consecutive `(a|a)` groups
- **THEN** the client evaluator declines the step as `unsafeRegex`

#### Scenario: Bounded choices multiplying an unbounded quantifier are declined
- **WHEN** a draft stringops `extractRegex` step uses `a*a?a?a?a?a?a?b` or `a?a?a?a?a?a?a*b`
- **THEN** the client evaluator declines the step as `unsafeRegex`

#### Scenario: A long tail re-matched by every retry is declined
- **WHEN** a draft stringops `extractRegex` step uses `a*a{20}b`, `.*.{60}z` or `a?a?a?a?a?a?a{50}b`
- **THEN** the client evaluator declines the step as `unsafeRegex`

#### Scenario: End-of-input anchors re-checked by every retry are declined
- **WHEN** a draft stringops `extractRegex` step uses `\d?\d?(\d+)$`, `.?.?.*$x`, or `.*` followed by 50 `$` and `x`
- **THEN** the client evaluator declines the step as `unsafeRegex`

#### Scenario: Fenced quantifiers stay client-side
- **WHEN** a draft stringops `extractRegex` step uses `([a-z]+)-([a-z]+)`, `(\d+\.\d+)`, `(\d+) items` or
  `(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})`
- **THEN** the client evaluator evaluates the step and produces the same rows as the server engine

#### Scenario: Main thread stays responsive
- **WHEN** a user enters a backtracking-prone pattern into a draft extractRegex step over sample rows on which the
  browser's regex engine would take seconds
- **THEN** no main-thread task during the edit lasts longer than 100 milliseconds

#### Scenario: Server overrun surfaces as the server's step error
- **WHEN** a declined pattern is evaluated by the server draft preview
- **THEN** the draft shows the server's result for that step, and when the pattern exhausts the server's 2 second
  regex time budget that result is the server's time-budget step error naming the step
