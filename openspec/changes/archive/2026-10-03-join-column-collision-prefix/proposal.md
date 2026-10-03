## Why

`JoinStep` merges rows as `leftRow ++ rightRow`; on a column-name collision the right value silently overwrites the left, and analyze-time `inferJoin` mirrors that "right wins" rule. A join can therefore silently drop data (HEL-1069 scenario H). The owner ruled: auto-prefix colliding right-side columns, never error, never drop a value.

## What Changes

- A single pure helper defines the collision rule (which right columns collide, and the deterministic new names) and is used by BOTH the runtime row merge and analyze-time schema inference, so they cannot drift.
- Left columns keep their names. The join key (`joinKey`, a single column present on both sides by definition) keeps ONE copy (left's) and is never renamed.
- Every other right column whose name exists on the left is renamed `right_<name>`; if that name is already taken (by any left column, any non-colliding right column, or an earlier renamed column) append `_2`, `_3`, ... until unique.
- Analyze/infer for join renders renamed fields (incl. types) for lane-kind secondary inputs, and for source-kind secondary inputs wherever the right schema can be resolved; where it cannot, this is documented explicitly (see design).
- BREAKING (owner-accepted): existing pipelines with colliding columns now expose the right value under a new prefixed name.

## Capabilities

### New Capabilities
- `pipeline-join-column-collision`: collision semantics for join steps (naming rule, key-column rule, runtime/analyze parity).

### Modified Capabilities

## Impact

`backend/.../steps/JoinStep.scala`, `backend/.../engine/PipelineAnalyzeService.scala` (`inferJoin`, and source-kind secondary resolution if feasible), possibly the Spark path/`PipelineCostEstimator`, frontend editor column display, helio-mcp `analyze_pipeline` output (should flow from backend analyze unchanged), tests, PR body notes on bound Outputs/panels.
