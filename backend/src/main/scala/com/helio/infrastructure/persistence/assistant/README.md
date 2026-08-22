# Persistence — Assistant

Assistant conversation transcripts and daily usage counters.

Holds: `AssistantConversationRepository`, `AssistantDailyUsageRepository`.

Does NOT hold: repositories for other domains (this directory's tables only),
or business logic/validation (that belongs in `services/assistant/`). The ACL
triad (`findById`/`findByIdOwned`/`findByIdInternal`, CONTRIBUTING.md)
applies here same as every other persistence subdirectory.
