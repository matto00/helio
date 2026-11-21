## ADDED Requirements

### Requirement: The tool-loop-outcome record SHALL carry hop, failure and stop counters
The `assistant_tool_loop_outcome` record SHALL additionally carry `hopsUsed` (tool-executing round trips in the
turn), `failedToolCalls` (failed tool calls counted toward the failure budget) and `stopReason` (`final`,
`failure_budget`, `hop_ceiling` or `input_budget`), as integers and a fixed token only, never tool input or error
text.

#### Scenario: A failure-budget stop is recorded
- **WHEN** a converse turn stops after 3 failed tool calls
- **THEN** the emitted record has `failedToolCalls` 3, `stopReason` `failure_budget`, and `hopsUsed` equal to the
  round trips that ran

#### Scenario: A normal multi-hop turn is recorded
- **WHEN** a converse turn runs 6 round trips with no failures and then answers
- **THEN** the emitted record has `hopsUsed` 6, `failedToolCalls` 0 and `stopReason` `final`

#### Scenario: A final answer after two failures is recorded with its failures
- **WHEN** a converse turn makes 2 failed tool calls and then answers
- **THEN** the emitted record has `failedToolCalls` 2 and `stopReason` `final`
