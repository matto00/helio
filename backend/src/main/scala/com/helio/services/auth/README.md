# Services — Auth

Authentication, authorization, entitlement and secret-redaction logic: login/session, API tokens, MFA, resource permissions/ACL, tier/beta-access and chat-access gating, secret-field redaction.

Holds: `AccessChecker`, `ApiTokenService`, `AuthService`, `BetaAccessError`, `BetaAccessService`, `ChatAccessError`, `ChatAccessService`, `MfaService`, `PermissionService`, `PipelinePermissionService`, `SecretField`, `UserTierConfig`.

Does NOT hold: business logic for other domains, or persistence
(`infrastructure/persistence/auth/`) — this directory's files call
repositories, never `db.run` directly (CONTRIBUTING.md). `private[services]`
members here stay reachable from every other domain subpackage (no
encapsulation implied by the split).
