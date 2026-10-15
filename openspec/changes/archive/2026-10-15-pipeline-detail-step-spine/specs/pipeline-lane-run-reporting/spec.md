## MODIFIED Requirements

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
