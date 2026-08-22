# Persistence — Agents

Agent memory/preference persistence for HEL-661's find/get_resource tools.

Holds: `AgentMemoryRepository`, `AgentPreferencesRepository`.

Does NOT hold: repositories for other domains (this directory's tables only),
or business logic/validation (that belongs in `services/agents/`). The ACL
triad (`findById`/`findByIdOwned`/`findByIdInternal`, CONTRIBUTING.md)
applies here same as every other persistence subdirectory.
