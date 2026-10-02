# HEL-1069: Multi-branch pipeline construction can silently re-parent a step and zero out a real count

## Description

Found while building a dashboard entirely through the MCP agent path. Constructing a pipeline with two sibling branches (two `rootId`-anchored aggregate lanes intended to be joined), one `add_pipeline_step` call silently re-parented a step onto the wrong branch. A real aggregate count collapsed to zero. The run summary reported success; the zeroed count was visible only via `get_output_rows`. The "re-parenting" mechanism is a relayed claim; the observable (summary clean, rows zeroed) is the reliable part. Reproduce before designing.

Repro shape: source root; two aggregate branches anchored to the same `rootId` via `add_pipeline_step`; `join` across lanes; run; compare `get_output_rows` with the run summary.

## Acceptance Criteria

1. `add_pipeline_step` must never move a step it was not asked to move. If a requested parent is invalid, fail loudly with the reason rather than silently re-anchoring.
2. The run summary carries enough shape information (per-step row counts) that a zeroed branch is visible without a separate `get_output_rows` call.
3. Schemas/openspec/MCP tool descriptions updated in the same change.
