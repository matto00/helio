# HEL-759: Add test_connection verb label to ToolCallIndicator.tsx's VERB_BY_TOOL_NAME map

## Description

Follow-up from HEL-756 (assistant `test_connection` tool).

`frontend/src/features/assistant/ui/ToolCallIndicator.tsx`'s `VERB_BY_TOOL_NAME` map has no entry for the `test_connection` tool the assistant now calls (added in HEL-756), so it falls back to the generic "Calling" verb instead of a tool-specific label like the other 6 tools get (e.g. "Searching" for `find`, "Proposing" for `propose_*`).

## Fix

Add a `test_connection` entry to `VERB_BY_TOOL_NAME`, e.g. "Verifying connection" or similar, matching the existing naming convention for the other tool verbs.

## Acceptance Criteria

* `VERB_BY_TOOL_NAME` includes a `test_connection` entry with a tool-specific verb.
* The assistant chat UI shows that verb (not the generic "Calling" fallback) while a `test_connection` tool call is in flight.

## Context

Cosmetic, non-blocking — flagged by both the evaluator and final-gate skeptic during HEL-756's review, triaged `standalone` (not required by HEL-756's acceptance criteria, small effort, no file overlap with that change).
