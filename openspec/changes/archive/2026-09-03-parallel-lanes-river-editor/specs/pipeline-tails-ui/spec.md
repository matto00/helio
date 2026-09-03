## MODIFIED Requirements

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

## REMOVED Requirements

### Requirement: Editor refuses a second branch
**Reason**: P2.1 (HEL-911) deleted the single-branch-per-node structural fence at all three enforcement
sites; the engine accepts any number of step children. Refusing a second branch in the editor is now a
UI-invented restriction with no contract behind it, and it is exactly the capability this change ships.
**Migration**: The refusal message and the child-count-based disabling of the branch affordance are
removed. "+ lane" is offered unconditionally on every step — see `pipeline-lane-editor-ui`.
