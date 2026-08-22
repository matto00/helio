# Services — Proposals

Generating a NEW artifact: dashboard/pipeline authoring (NL -> DashboardProposal/PipelineProposal), the combined-proposal orchestrator, and the shared authoring-conversation substrate patchsets/Refinement reuses.

Holds: `AuthoringConversationTurns`, `AuthoringError`, `AuthoringHistoryBudget`, `AuthoringOutcomeHelpers`, `AuthoringTelemetry`, `CombinedProposalService`, `DashboardAuthoringParsing`, `DashboardAuthoringPrompt`, `DashboardAuthoringService`, `DashboardProposalService`, `ProposalPanelSupport`.

Does NOT hold: business logic for other domains, or persistence
(`infrastructure/persistence/proposals/`) — this directory's files call
repositories, never `db.run` directly (CONTRIBUTING.md). `private[services]`
members here stay reachable from every other domain subpackage (no
encapsulation implied by the split).
