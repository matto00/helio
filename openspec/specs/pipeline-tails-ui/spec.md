# pipeline-tails-ui Specification

## Purpose
Defines the tail rendering and editing rules for the Phase-1 river: an indented dashed mini-chain
under a trunk step, ending in the tail's own Output chip, with branching refused within it.

## Requirements

### Requirement: Tail renders as an indented dashed chain
A one-step lane whose steps carry Outputs — the Phase-1 "tail" — SHALL keep its existing indented,
dashed-connector rendering beneath its parent step, visually distinct from the primary-lane connector
style. Generalizing the grouping to n lanes SHALL NOT change how this shape renders.

#### Scenario: Tail ends in an Output chip
- **WHEN** a tail's leaf step has one or more Outputs
- **THEN** the tail chain visually terminates in those Output chip(s)

#### Scenario: A tail renders as it did before lanes
- **WHEN** a pipeline whose only branching is a single tail off one step is rendered
- **THEN** the rendered output is unchanged from the pre-lanes rendering of the same pipeline

### Requirement: Tail accepts the same step operations as the trunk
Drag-reorder, insert, duplicate, and enable/disable SHALL function identically on tail steps and
trunk steps.

#### Scenario: Reorder within a tail
- **WHEN** a user drags a tail step to a new position within the same tail
- **THEN** the tail's step order updates and persists exactly as trunk reordering does
