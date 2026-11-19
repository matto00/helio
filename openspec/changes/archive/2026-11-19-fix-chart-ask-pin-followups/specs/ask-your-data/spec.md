## MODIFIED Requirements

### Requirement: Pin hand-off without render
The response `pin` SHALL be non-null only when every cited Output is on one pipeline the caller can edit (owner or
editor grant); it SHALL carry that pipeline id, the node of the first cited Output, and a create body of kind
`insight` with `prompt` = the question, `reads.outputs` = the cited non-insight Output ids (at most 8), and
`refresh: "manual"`, and SHALL contain no answer text. The node SHALL be `nodeStepId` when the first cited Output is on
a step, else `rootId` = its root id; an Output with neither (a null root id, which the outputs table's CHECK makes
unreachable for a stored row) SHALL carry neither key, so the create route anchors the insight to the pipeline's root
as it does for any create without a node. Sending the body to `POST /api/pipelines/:id/outputs` SHALL create the
insight Output; creating it SHALL NOT trigger a render in this change; render-on-pin belongs to HEL-1743.

#### Scenario: Viewer gets no pin
- **WHEN** the asker holds only a viewer grant on the cited Outputs' pipeline
- **THEN** `pin` is `null`

#### Scenario: Root id distinct from the pipeline id
- **WHEN** the first cited Output is root-bound to a root whose id differs from the pipeline id
- **THEN** the pin's `rootId` is that root id, and sending the body to the real create route returns `201` with the
  insight bound to that root

#### Scenario: Output with no step and no root id
- **WHEN** the first cited Output has no step and no root id, on a single-root pipeline whose root id differs from the
  pipeline id
- **THEN** the pin's body carries neither `nodeStepId` nor `rootId`, and sending it to the real create route returns
  `201` with the insight bound to the pipeline's root
