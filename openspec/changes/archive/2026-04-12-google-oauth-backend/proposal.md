## Why

Helio currently supports email/password authentication but has no social login. Adding Google OAuth2 allows users to sign in with their existing Google account, reducing friction for new users and enabling automatic profile data (avatar) without a separate upload flow.

## What Changes

- New endpoint `GET /api/auth/google` — redirects the browser to the Google OAuth2 consent screen
- New endpoint `GET /api/auth/google/callback` — handles the OAuth2 authorization code exchange, fetches the Google user profile, upserts a user record, creates a session, and returns a session token
- New DB columns on the `users` table: `google_id` (unique, nullable) and `avatar_url` (nullable)
- New config variables: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` in `.env`
- New Flyway migration to add the Google columns and index
- New Scala library dependency for OAuth2 HTTP client (sttp or plain akka-http client calls — no large OAuth framework needed)

## Capabilities

### New Capabilities

- `google-oauth-login`: Redirect-based Google OAuth2 login flow — consent screen redirect, authorization code exchange, profile fetch, user upsert, session creation, and session token response

### Modified Capabilities

- `email-password-auth`: The `users` table gains two nullable columns (`google_id`, `avatar_url`). No requirement-level behavior changes; existing login/register flows are unaffected.

## Impact

- **Backend**: New `AuthGoogleRoutes.scala` (or extension to existing auth routes), new `UserRepository` methods for upsert-by-google-id, new Flyway migration
- **API**: Two new public routes added to the auth whitelist in the request authentication middleware
- **Config**: Three new required environment variables for Google OAuth credentials
- **Database**: `users` table schema change (additive, non-breaking)
- **Dependencies**: Requires an HTTP client capable of making server-side requests to Google's token and userinfo endpoints — the existing Akka HTTP client stack satisfies this; no new library needed
