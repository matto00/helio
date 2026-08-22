# Persistence — Auth

User/session/API-token/MFA/invite-code persistence, plus the shared `resource_permissions` sharing-grant table (`ResourcePermissionRepository`) and TOTP crypto primitives (`TotpSupport`).

Holds: `ApiTokenRepository`, `InviteCodeRepository`, `MfaRepository`, `ResourcePermissionRepository`, `TotpSupport`, `UserPreferenceRepository`, `UserRepository`, `UserSessionRepository`.

Does NOT hold: repositories for other domains (this directory's tables only),
or business logic/validation (that belongs in `services/auth/`). The ACL
triad (`findById`/`findByIdOwned`/`findByIdInternal`, CONTRIBUTING.md)
applies here same as every other persistence subdirectory.
