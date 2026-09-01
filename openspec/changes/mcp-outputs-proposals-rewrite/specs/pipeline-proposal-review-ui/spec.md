## MODIFIED Requirements

### Requirement: Review pages render Output previews
`ProposalReviewPage` and the patch-set, pipeline-proposal, and combined review pages SHALL render
each proposed Output's live preview rather than a "panel bound to type X" summary.

#### Scenario: Reviewing a pipeline proposal shows Output previews
- **WHEN** a user opens the review page for a pipeline proposal containing outputs
- **THEN** each proposed Output is rendered with its own preview, not a DataType-binding summary
