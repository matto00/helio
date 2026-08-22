# Persistence — Proposals

Authoring-conversation persistence (NL dashboard/pipeline authoring turns).

Holds: `AuthoringConversationRepository`.

Does NOT hold: repositories for other domains (this directory's tables only),
or business logic/validation (that belongs in `services/proposals/`). The ACL
triad (`findById`/`findByIdOwned`/`findByIdInternal`, CONTRIBUTING.md)
applies here same as every other persistence subdirectory.
