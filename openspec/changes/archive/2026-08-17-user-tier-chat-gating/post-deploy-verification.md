# HEL-703 — Post-deploy verification checklist (AC #3, manual step)

AC #3 ("the owner's account has unlimited access, verified end-to-end against the real deployed
config") closes in two tracked steps (design.md D10):

- **(a) In-run, local** — done as part of this change's own delivery (tasks.md 6.8): the same
  env-var mechanism prod uses (`HELIO_OWNER_EMAILS`), exercised locally against a real signup/login
  and a real converse call past the beta limit.
- **(b) Post-deploy, prod** — this checklist. A human/operator step, not implied or automated by
  this PR's own gates. Paste this section verbatim into the PR body and the Linear closing comment,
  and check each box as it's completed against the real deployed environment.

## Checklist

- [ ] Set `HELIO_OWNER_EMAILS=mattheworr018@gmail.com` in `infra/.env.deploy` (gitignored,
      operator-local — copy from `infra/.env.deploy.example` if not already present).
- [ ] Run `infra/deploy-backend.sh` to deploy the backend carrying this change, with
      `HELIO_OWNER_EMAILS` set on the Cloud Run service.
- [ ] Log in to the deployed frontend as `mattheworr018@gmail.com` (register or Google OAuth login
      — either auth path).
- [ ] Confirm `GET /api/auth/me` (or the logged-in UI) shows `tier: "owner"` for that account.
- [ ] Confirm chat/assistant access works normally for that account (no request-access prompt).
- [ ] Confirm converse continues to work for that account past the configured
      `HELIO_BETA_DAILY_MESSAGE_LIMIT` (default 50) — i.e. genuinely unlimited, not just
      "under the beta cap".

Non-blocking notes:

- No demotion is implemented — if `HELIO_OWNER_EMAILS` is ever unset or changed, an already-`owner`
  account is NOT automatically demoted (design.md's own documented non-goal).
- Assigning `beta` tier to a specific account (for manual QA of the cap) has no admin UI yet —
  it's a direct `UPDATE users SET tier = 'beta' WHERE email = '...'` against the prod database, or
  wait for HEL-704's invite-code flow.
