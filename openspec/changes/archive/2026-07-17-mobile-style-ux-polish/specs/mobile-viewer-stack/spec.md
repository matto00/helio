## ADDED Requirements

### Requirement: Phone-width edit affordances are honest
At viewports narrower than 768px, every edit affordance that is reachable SHALL work end-to-end
(open → edit → save → persisted) with interactive targets of at least 44 CSS px, and no affordance
SHALL imply or reach desktop-only layout actions (panel drag, panel resize, grid layout editing).
Content edits reachable from the stack (via the panel detail modal) are legitimate — HEL-304 makes
them persist width-independently — but any affordance that cannot complete its action at phone
width MUST NOT be rendered there.

#### Scenario: Reachable content edit completes end-to-end

- **WHEN** a user at a 390×844 viewport opens a panel's detail modal, edits its content or
  configuration, and saves
- **THEN** the edit persists (visible after reload) and every control used in the flow measures
  ≥ 44px via its bounding client rect

#### Scenario: Layout actions are unreachable and unimplied

- **WHEN** a dashboard renders at a viewport narrower than 768px
- **THEN** no drag handle, resize handle, or layout-editing control is rendered or implied anywhere
  in the stack or its modals

#### Scenario: No dead-end edit affordances

- **WHEN** any button or control presented below 768px is activated
- **THEN** it performs its full action at that width — no control leads to a flow that silently
  fails or requires a wider viewport to complete
