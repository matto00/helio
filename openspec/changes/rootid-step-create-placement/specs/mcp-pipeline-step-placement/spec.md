## MODIFIED Requirements

### Requirement: MCP step-adding tools never silently re-parent existing steps
`add_pipeline_step` SHALL accept an optional `attachAsTail` boolean. `true` creates a new sibling lane and moves nothing; `false` performs the splice-insert deliberately; omitted SHALL send `rejectIfReparents: true` so an insert that would re-parent existing steps fails with the backend's error naming them (nothing written). The tool description SHALL state this. `attachAsTail: true` without `parentStepId` (that is, with `rootId` or with no anchor) SHALL be rejected by the tool before any request, because the backend only honours attachAsTail with `parentStepId`; the message points to `parentStepId` of an existing step. An invalid anchor SHALL continue to fail with the backend's reason. The result SHALL pass through `reparentedStepIds`.

A `rootId` anchor SHALL resolve to that root's trunk-last step (or the empty root itself), the same placement the backend gives a `rootId` create with no `position`. The tool description SHALL state that `rootId` appends at the end of that root's trunk, and is refused by the default guard only when that trunk-last step already has children.

`add_outputs_from_shape`, when `stepId` has existing children, SHALL attach the shape's first expanded step as a sibling (`attachAsTail: true`); when `stepId` is absent it SHALL send `rejectIfReparents: true`. A childless `stepId` appends as before.

#### Scenario: Second same-root branch without an explicit choice
- **WHEN** a step is added with `parentStepId=X`, or with `rootId=R` where R's trunk-last step already has children, and `attachAsTail` is omitted
- **THEN** the tool returns an error naming the children that would move; no step is created and no parent changes

#### Scenario: A rootId add appends at that root's trunk tail
- **WHEN** a step is added with `rootId=R`, `attachAsTail` omitted, and R's trunk is A, B where B has no children
- **THEN** the step is created as B's child, R's trunk is A, B, NEW, and no existing step's parent changes

#### Scenario: Sibling lane via attachAsTail
- **WHEN** a step is added with `parentStepId=X`, `attachAsTail: true`
- **THEN** it is a sibling of X's existing children and no existing step's parent changes

#### Scenario: attachAsTail without parentStepId
- **WHEN** `attachAsTail:true` is given with `rootId`, or with no anchor at all
- **THEN** the tool errors before calling the backend

#### Scenario: Shape output off a node that already has children
- **WHEN** `add_outputs_from_shape` is called with a `stepId` that has children
- **THEN** no existing step is re-parented

#### Scenario: Childless anchor unaffected
- **WHEN** the anchor has no children and `attachAsTail` is omitted
- **THEN** the step is appended exactly as before
