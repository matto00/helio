## MODIFIED Requirements

_Retargeted from DataTypes/Metrics to the outputs-model (Output, node_snapshot, pipeline-step-tree) per HEL-903 decisions 1/2/4/11. Scenario titles are preserved verbatim from the live spec even where they still name "DataType"/"Metric" (they describe the same test case); only the body text is retargeted to the new mechanism._

### Requirement: The NL authoring prompt includes the caller's agentContext
`DashboardAuthoringPrompt.userMessage`'s rendered prompt text SHALL include a compact rendering
of the grounded `agentContext` (preferences summary and memory entries) in addition to the
existing Output grounding section.

#### Scenario: Prompt includes preferences and memory
- **WHEN** `DashboardAuthoringService` assembles grounded context for a first-turn authoring
  request, and the caller has stored preferences and memory entries
- **THEN** the rendered prompt text sent to Claude includes a section describing those
  preferences and memory entries

#### Scenario: Prompt omits the section cleanly when agentContext is empty
- **WHEN** the caller has no stored preferences and no stored memory entries
- **THEN** the rendered prompt text does not include a misleading or empty-looking
  preferences/memory section (e.g. no bare headers with nothing under them)
