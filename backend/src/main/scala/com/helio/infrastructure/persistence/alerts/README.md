# Persistence — Alerts

Alert rule and alert event persistence — the state alert evaluation reads/writes.

Holds: `AlertEventRepository`, `AlertRuleRepository`.

Does NOT hold: repositories for other domains (this directory's tables only),
or business logic/validation (that belongs in `services/alerts/`). The ACL
triad (`findById`/`findByIdOwned`/`findByIdInternal`, CONTRIBUTING.md)
applies here same as every other persistence subdirectory.
