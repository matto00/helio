## ADDED Requirements

### Requirement: Modal renders its full content visibly at phone viewport widths
At a 390px-wide viewport (and phone widths generally), an open `Modal` SHALL render its header,
body, and footer (when present) fully visible and positioned within the viewport — never collapsed
to zero/near-zero body height, and never positioned such that only its header or top edge is
visible with the rest of the dialog off-screen.

#### Scenario: Quick-launcher Modal renders visibly on phone
- **WHEN** the user opens the assistant quick-launcher (`QuickLauncherOverlay`) at a 390×844
  viewport
- **THEN** the dialog's header, the active-conversation content, and the message composer are all
  visible on screen, not collapsed or clipped

#### Scenario: A size="lg" review Modal renders visibly on phone
- **WHEN** a proposal review page (e.g. `ProposalReviewPage`, `PipelineProposalReviewPage`,
  `CombinedProposalReviewPage`, `PatchSetReviewPage`) renders its `Modal` at a 390×844 viewport
- **THEN** the dialog's header, body content, and footer actions are all visible on screen, not
  collapsed or clipped
