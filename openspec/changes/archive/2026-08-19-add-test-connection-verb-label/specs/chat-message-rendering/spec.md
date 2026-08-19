## MODIFIED Requirements

### Requirement: Each tool call in the transcript is individually visible
A `tool_use` content block in the transcript SHALL render as its own distinct progress-indicator
row (naming the tool and a compact view of its input), and its paired `tool_result` SHALL render as
a collapsed, human-readable summary — never raw JSON dumped inline, and never a single global
indicator standing in for multiple distinct tool calls. Every tool the assistant can call SHALL
have a tool-specific verb in `ToolCallIndicator`'s verb map, rather than falling back to the
generic "Calling" label.

#### Scenario: Multiple tool calls in one turn each render distinctly
- **WHEN** a transcript turn contains two `tool_use` blocks (e.g. one `find` and one `get_resource`)
- **THEN** two distinct progress-indicator rows render, each naming its own tool

#### Scenario: A tool result renders as a collapsed summary, not raw JSON
- **WHEN** a `tool_result` block's `content` is a large JSON string
- **THEN** the rendered summary is a short, human-readable line behind a disclosure toggle, not the
  raw JSON string displayed inline

#### Scenario: A failed tool call renders with error-intent styling
- **WHEN** a `tool_result` block has `isError: true`
- **THEN** its rendering uses DESIGN.md's error-intent tokens, visually distinct from a successful
  result

#### Scenario: A test_connection call renders with a tool-specific verb
- **WHEN** a transcript turn contains a `tool_use` block whose `name` is `test_connection`
- **THEN** the progress-indicator row shows a tool-specific verb (e.g. "Verifying connection"),
  not the generic "Calling" fallback
