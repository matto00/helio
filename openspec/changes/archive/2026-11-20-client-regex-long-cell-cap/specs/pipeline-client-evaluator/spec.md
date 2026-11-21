## ADDED Requirements

### Requirement: Accepted regex patterns are declined on input too long for the main thread
The client evaluator SHALL decline, with the reason `regexInputCost` and without producing rows, a stringops
`extractRegex` step whose pattern it accepts when the step's predicted regex work over its actual input frame exceeds
a fixed budget. The predicted work SHALL charge every accepted pattern: per input cell, a per-character charge for each alternative of the pattern plus, for
each maximal run of characters that some atom of the pattern can consume, the run's length times the number of
alternatives times the smaller of that length and the per-start-position work (counted atoms and a wide quantifier's minimum included), plus, for
a pattern with an unbounded or wide quantifier followed by further pattern items, a pattern multiplier times the
run's length squared; per-character work SHALL be weighted by a factor that grows with the width (range count) of the character classes
used, and a class wider than 64 ranges SHALL be declined as `unsafeRegex`; and the budget SHALL be calibrated so
that, for every shape on the recorded calibration list, a step at the budget runs in at most 20 milliseconds on the
reference machine, except shapes recorded as accepted risk, none of which SHALL exceed 50 milliseconds. The decision SHALL depend only on the pattern and the input frame, never on elapsed time. A
declined step SHALL be evaluated by the server draft preview, and the shared parity corpus SHALL remain unchanged.

#### Scenario: A single unbounded quantifier over long cells is declined
- **WHEN** a draft stringops `extractRegex` step uses `(a*)b` over 1,000 rows of 500-character `a` cells
- **THEN** the client evaluator returns `needsServer` with the reason `regexInputCost` and produces no rows for it

#### Scenario: The same pattern over short cells stays client-side
- **WHEN** a draft stringops `extractRegex` step uses `(a*)b` over input whose predicted work is within the budget
- **THEN** the client evaluator evaluates the step and produces the same rows as the server engine

#### Scenario: Large counted atoms over long cells are declined
- **WHEN** a draft stringops `extractRegex` step uses `(a{1000})b` or `(a{1000,})` over 1,000 rows of 2,000-character
  cells on which each start position scans close to 1,000 characters
- **THEN** the client evaluator returns `needsServer` with the reason `regexInputCost`

#### Scenario: Ordinary text stays client-side
- **WHEN** a draft stringops `extractRegex` step uses `(\d+\.\d+)` or `([A-Z]+)-(\d+)` over 1,000 rows of
  200-character mixed text cells whose digit and capital-letter runs are short
- **THEN** the client evaluator evaluates the step client-side

#### Scenario: A cheap pattern stays client-side on long cells
- **WHEN** a draft stringops `extractRegex` step uses `(a+)` or `(\d+)` over 1,000 rows of 2,000-character cells
- **THEN** the client evaluator evaluates the step client-side

#### Scenario: Main thread stays responsive on long cells
- **WHEN** a user enters a single-quantifier pattern with a tail into a draft extractRegex step over sample rows of
  long cells on which the browser's regex engine would take over half a second
- **THEN** no main-thread task during the edit lasts longer than 100 milliseconds and the step is evaluated by the
  server draft preview
