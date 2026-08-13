## MODIFIED Requirements

### Requirement: The endpoint authors, validates, but never applies a proposal
`POST /api/authoring/dashboard` SHALL accept `{ goal: String, contextOptions: Option[...],
conversationId: Option[String] }` and return either `{ proposal: DashboardProposal, warnings:
[String], conversationId: String }` on success or a structured error response. It SHALL NOT create a
dashboard, panel, or any other persisted resource — applying stays the caller's explicit, separate
action via the existing apply endpoint. `conversationId` is additive: omitting it SHALL behave
exactly as before this capability existed (single-shot, no continuation).

#### Scenario: A successful call returns a proposal without creating anything
- **WHEN** `POST /api/authoring/dashboard` is called with a goal against a non-empty workspace and
  the model returns a structurally valid proposal
- **THEN** the response is `200` with `{ proposal, warnings, conversationId }`, and no dashboard or
  panel exists in the database as a result of this call

#### Scenario: Omitting conversationId behaves exactly as the original single-shot contract
- **WHEN** `POST /api/authoring/dashboard` is called without a `conversationId`, exactly as any
  caller predating conversation support would call it
- **THEN** the call succeeds or fails identically to how it would have before conversation support
  was added, with the only difference being an additive `conversationId` present in a successful
  response body
