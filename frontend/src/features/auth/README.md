# Auth

Authentication: login/register/MFA/OAuth pages (`ui/`), session state
(`state/authSlice.ts`), the API client (`services/authService.ts`), user
types (`types/user.ts`), and post-login redirect handling
(`utils/postLoginReturnTo.ts`).

**Belongs here:** sign-in/sign-up flows, session state, and route guards
(`ProtectedRoute`, `PublicOnlyRoute`).
**Does not belong here:** account settings/API tokens/MFA management once a
user is signed in, which live in `settings`.
