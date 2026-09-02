# pipeline-tails-ui Specification

## Purpose
Defines the tail rendering and editing rules for the Phase-1 river: an indented dashed mini-chain
under a trunk step, ending in the tail's own Output chip, with branching refused within it.

## Requirements

### Requirement: Tail renders as an indented dashed chain
A step with a position ≥ 1 child SHALL render that child and all of its descendants (reached, per
the Phase-1 invariant, through position-0 edges from that child) as an indented, dashed-connector
mini-chain beneath the parent trunk step, visually distinct from the trunk connector style.

#### Scenario: Tail ends in an Output chip
- **WHEN** a tail's leaf step has one or more Outputs
- **THEN** the tail chain visually terminates in those Output chip(s)

### Requirement: Tail accepts the same step operations as the trunk
Drag-reorder, insert, duplicate, and enable/disable SHALL function identically on tail steps and
trunk steps.

#### Scenario: Reorder within a tail
- **WHEN** a user drags a tail step to a new position within the same tail
- **THEN** the tail's step order updates and persists exactly as trunk reordering does

### Requirement: Editor refuses a second branch
The editor SHALL prevent creating a second position ≥ 1 child on any node that already has one,
surfacing an explanatory message rather than allowing the action.

#### Scenario: Attempt to add a second tail off the same step
- **WHEN** a user attempts to add a tail step off a trunk step that already has a tail
- **THEN** the editor blocks the action and explains that a step may have at most one tail (Phase 1)
