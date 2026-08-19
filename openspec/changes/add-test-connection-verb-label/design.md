## Context

`ToolCallIndicator.tsx` renders a per-`tool_use` progress-indicator row and looks up a
tool-specific verb ("Searching", "Proposing", etc.) from the `VERB_BY_TOOL_NAME` record, falling
back to the generic "Calling" for any tool not in the map. HEL-756 added the `test_connection`
tool to the assistant's tool set but never added a corresponding map entry, so its calls render
with the generic fallback instead of a tool-specific verb.

## Goals / Non-Goals

**Goals:**
- Give `test_connection` calls the same tool-specific verb treatment every other assistant tool
  already gets.

**Non-Goals:**
- No change to `verbFor`'s fallback behavior, to any other tool's verb, or to the
  `test_connection` tool itself.

## Decisions

- Verb text: "Verifying connection" — matches the existing gerund-phrase convention ("Searching",
  "Looking up", "Proposing") and reads naturally in the rendered
  `{verb}: {toolName}({compactInput})` line.
- Implementation: a single new key in the existing `VERB_BY_TOOL_NAME` object literal — no new
  abstraction, no change to `verbFor`'s lookup-with-fallback logic, since the existing pattern
  already generalizes cleanly to a 7th entry.

## Planner Notes

- Self-approved: this is a single-line, self-contained UI-label addition with no architectural,
  dependency, or migration surface — no escalation warranted.

## Risks / Trade-offs

- None of substance. [Risk] Verb wording bikeshed → [Mitigation] "Verifying connection" is the
  exact phrasing suggested in the ticket's own Fix section.
