# Email

Outbound transactional email: `EmailConfig` (Resend credentials/from-address,
loaded from env), `EmailSender` (trait), `HttpResendEmailSender` (the Resend
REST API implementation).

**Belongs here:** email-sending configuration and delivery logic.
**Does not belong here:** the routes/services that decide _when_ to send an
email (e.g. beta-access notifications) — those live in `api/routes` and the
relevant service layer, which call into this package.
