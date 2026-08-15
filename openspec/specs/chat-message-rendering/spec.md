# chat-message-rendering Specification

## Purpose
Real, DESIGN.md-compliant message rendering for HEL-659's chat surface — role-based turn bubbles,
per-tool-call progress indication, a streaming-capable text component, and a proposal hand-off
affordance into the existing dashboard/patch-set review pages.
## Requirements
### Requirement: Message turns render with role-based visual differentiation
`ActiveConversationPanel` SHALL render each transcript turn's role visually distinctly — user turns
and assistant turns SHALL use different alignment and surface/accent treatment, per DESIGN.md's
token set, rather than one undifferentiated card style.

#### Scenario: A user turn and an assistant turn render with distinct treatment
- **WHEN** a loaded transcript contains both a `user` turn and an `assistant` turn
- **THEN** the two render with visually distinct alignment and background/border treatment, both
  built from DESIGN.md tokens (no hardcoded colors)

### Requirement: Each tool call in the transcript is individually visible
A `tool_use` content block in the transcript SHALL render as its own distinct progress-indicator
row (naming the tool and a compact view of its input), and its paired `tool_result` SHALL render as
a collapsed, human-readable summary — never raw JSON dumped inline, and never a single global
indicator standing in for multiple distinct tool calls.

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

### Requirement: A streaming-text component exists, tested against mock incremental data
The frontend SHALL provide a `StreamingText` component capable of revealing text incrementally with
a visible in-progress affordance (e.g. a cursor), verified in tests against scripted mock chunk
sequences. This ticket does not wire it to any live data source.

#### Scenario: Incremental chunks reveal in order
- **WHEN** `StreamingText` is given a scripted sequence of text chunks
- **THEN** the rendered text reflects each chunk in order, with an in-progress affordance visible
  until the sequence completes

### Requirement: A completed propose_* tool call offers a hand-off into its existing review page
The active conversation panel SHALL offer a "Review proposal" action when a transcript contains a
successful `propose_dashboard` or `propose_patch_set` tool result, navigating to that proposal
type's existing review page and passing the parsed proposal via router state, exactly matching the
mechanism `AuthoringChatDrawer` already uses. When the successful tool is `propose_pipeline` or
`propose_combined` (which have no existing review page), the panel SHALL show an informational,
non-navigating notice instead of a broken or silent link.

#### Scenario: A successful propose_dashboard result offers a working review hand-off
- **WHEN** a transcript contains a successful `propose_dashboard` tool result
- **THEN** a "Review proposal" action is shown, and activating it navigates to the dashboard
  proposal review page with the parsed `DashboardProposal` in router state

#### Scenario: A successful propose_patch_set result offers a working review hand-off
- **WHEN** a transcript contains a successful `propose_patch_set` tool result
- **THEN** a "Review proposal" action is shown, and activating it navigates to the patch-set review
  page with the parsed `PatchSet` in router state

#### Scenario: A pipeline or combined proposal shows an honest limitation, not a broken link
- **WHEN** a transcript contains a successful `propose_pipeline` or `propose_combined` tool result
- **THEN** an informational notice is shown stating no review page exists yet for that proposal
  type, with no navigation action offered

