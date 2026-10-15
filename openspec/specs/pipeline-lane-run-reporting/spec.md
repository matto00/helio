# pipeline-lane-run-reporting Specification

## Purpose
Defines how run results are surfaced across lanes: per-node row counts render on every lane.

Lane-path highlighting of a failing node is deliberately ABSENT from this capability. It is not a scope
trim: P2.1's Engine contract item 11 pins a lane-path format explicitly so this ticket could render it,
and `openspec/specs/pipeline-run-execution/spec.md:9` asserts it as a SHALL with an exact format -- but no
such field was ever shipped (`grep -rn 'lanePath' backend/src/main/scala` returns nothing; the engine's
structured `stepId` is flattened to free-text `runError` before reaching the client). The field and its
format are routed to HEL-913, which owns backend/engine and must resolve the same format's ambiguity under
multi-root. Deriving the path client-side was considered and REJECTED: a disabled node also reports no row
count (contract item 9), so the derivation would silently mis-highlight, and a wrong highlight is trusted.

## Requirements

### Requirement: Row counts render per node across every lane
Row counts streamed by a dry or live run SHALL render on the corresponding `StepCard` in whichever lane
that node occupies.

**Layout scope (HEL-1579).** The paragraphs above and the scenarios below describe the phone layout (at or below 768px, the river view), which is unchanged. On desktop the per-node row counts render as the count slot of every spine row in every lane (trunk and branches), from the in-session run's counts, else the persisted latest run's, else "—"; a disabled step shows "off".

#### Scenario: Counts in both lanes
- **WHEN** a run reports row counts for nodes in two different lanes
- **THEN** each node's count renders on its own card, in its own lane

#### Scenario: Desktop counts on every lane row
- **WHEN** a run completes on a pipeline with a branch lane on desktop
- **THEN** every spine row, in the trunk and in the branch, shows its node's row count
