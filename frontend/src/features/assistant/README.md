# Assistant

Top-level workspace assistant chat surface: conversation state
(`state/assistantConversationsSlice.ts`), the API client
(`services/assistantConversationsService.ts`), proposal extraction from
assistant replies (`proposalExtraction.ts`), and the chat UI (`ui/`:
`ChatPage`, `MessageComposer`, `MessageTurn`, `StreamingText`,
`ToolCallIndicator`, `QuickLauncherOverlay`, `ProposalHandoff`,
`ActiveConversationPanel`).

**Belongs here:** the assistant conversation surface and its wire types
(`types.ts`).
**Does not belong here:** the dashboard/pipeline proposal shapes it hands off
to, which live in `dashboards/types` and `pipelines/types`.
