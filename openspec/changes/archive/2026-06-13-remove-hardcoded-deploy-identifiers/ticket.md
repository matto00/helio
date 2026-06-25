# HEL-231 — Remove hardcoded identifiers from deploy-backend.sh

## Context

`deploy-backend.sh` is committed to a public GitHub repo and contains hardcoded values in `--set-env-vars` that shouldn't be indexed publicly — most notably the Google OAuth Client ID (`GOOGLE_CLIENT_ID`). While not a credential, OAuth Client IDs in public repos are a phishing vector (someone could build a lookalike login page using the real client ID). Keeping the deploy script free of any identifiers is good hygiene.

## What

Replace hardcoded values in `--set-env-vars` (at minimum `GOOGLE_CLIENT_ID`, and any other environment-specific identifiers) with either:

* Google Secret Manager secrets referenced via `--set-secrets`, or
* Shell variables sourced from a local, gitignored `.env.deploy` file at deploy time

The `DB_PASSWORD` and `GOOGLE_CLIENT_SECRET` are already correctly using `--set-secrets` — extend that pattern.

## Acceptance criteria

- [ ] `deploy-backend.sh` contains no hardcoded `GOOGLE_CLIENT_ID` value (or any other environment-specific identifier)
- [ ] The script still works end-to-end for a Cloud Run deploy with all required env vars present at runtime
- [ ] Any secrets/identifiers are sourced from Secret Manager references or a gitignored local file, with a README note explaining what's needed to run the script

## Verification notes (autonomous run)

This is an infra/deploy-script + docs change. There is NO running-app UI to verify. Verification must be:
(a) Static review that no hardcoded identifier remains in the script (grep)
(b) The script is internally consistent and syntactically valid (`bash -n`)
(c) The README note exists and is accurate

Do NOT block on a live Cloud Run deploy or dev-server walkthrough — no credentials, would be a side-effecting external action.
