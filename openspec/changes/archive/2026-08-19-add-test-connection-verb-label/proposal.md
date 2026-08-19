## Why

HEL-756 added the assistant's `test_connection` tool, but `ToolCallIndicator.tsx`'s
`VERB_BY_TOOL_NAME` map was never updated with an entry for it. As a result the chat UI shows the
generic "Calling" fallback verb instead of a tool-specific label like the other six tools get
(e.g. "Searching" for `find`, "Proposing" for `propose_*`). This was flagged by both the evaluator
and the final-gate skeptic during HEL-756's review and triaged `standalone`.

## What Changes

- Add a `test_connection` entry to `VERB_BY_TOOL_NAME` in
  `frontend/src/features/assistant/ui/ToolCallIndicator.tsx`, using a tool-specific verb
  ("Verifying connection") consistent with the existing naming convention.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `chat-message-rendering`: the existing "Each tool call in the transcript is individually
  visible" requirement's tool-naming behavior gains an explicit scenario covering the
  `test_connection` tool's verb label, so the fallback-to-"Calling" gap can't silently regress.

## Impact

- `frontend/src/features/assistant/ui/ToolCallIndicator.tsx` — one map entry added.
- No API, schema, or backend changes. No new dependencies.

## Non-goals

- No change to any other tool's verb, to `compactInput`/`summarizeResult`, or to the
  `test_connection` tool's own implementation (HEL-756).
