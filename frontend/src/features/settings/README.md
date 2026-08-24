# Settings

Account settings: `state/settingsSlice.ts`, services for preferences/API
tokens (`settingsService.ts`, `apiTokenService.ts`), `types/` (preferences,
API token, agent-memory wire shapes), and `ui/` — the settings page and its
sections (`ApiTokensSection`, `MfaSecuritySection` + enrollment modal/backup
codes, `PreferencesEditor`, `AgentMemoryList`, `BetaAccessSection`).

**Belongs here:** user-account configuration — preferences, MFA, PATs, agent
memory, beta access.
**Does not belong here:** the sign-in/sign-up flow itself, which lives in
`auth`.
