## Skeptic Report — final gate (round 1)

### What I verified (with evidence)

**(a) No hardcoded GOOGLE_CLIENT_ID value in deploy-backend.sh**

Command: `grep "GOOGLE_CLIENT_ID=" infra/deploy-backend.sh`

Output:
```
  --set-secrets=DB_PASSWORD=helio-db-password:latest,GOOGLE_CLIENT_SECRET=helio-google-client-secret:latest,GOOGLE_CLIENT_ID=helio-google-client-id:latest \
```

The only occurrence is `GOOGLE_CLIENT_ID=helio-google-client-id:latest` in `--set-secrets` — a Secret Manager mapping key, not a literal OAuth credential. The former hardcoded value `522265251224-eannmal9699u40d7d6f0gqpd733gm5hk.apps.googleusercontent.com` is confirmed absent.

Additional scan for the literal value across infra/:
```
grep -rn "522265251224\|apps.googleusercontent.com" infra/
(no output — exit 1)
```

**(b) Script syntax validity**

Command: `bash -n infra/deploy-backend.sh`

Output:
```
exit code: 0
```

Syntax is valid. The `set -a; source "$(dirname "$0")/.env.deploy"; set +a` pattern is idiomatic; under `set -euo pipefail`, a missing `.env.deploy` will cause a clean error exit rather than silently expanding unset vars as empty strings.

**(c) README note accurate and complete**

Read `infra/README.md`. Confirmed it documents:
- Secret Manager secrets table: `helio-db-password`, `helio-google-client-secret`, `helio-google-client-id` with descriptions
- `.env.deploy` variables table: `GOOGLE_REDIRECT_URI`, `CORS_ALLOWED_ORIGINS` with descriptions and example values
- Step-by-step run instructions (`bash infra/deploy-backend.sh`)
- Explicit note: "`infra/.env.deploy` is gitignored and must never be committed"
- gcloud CLI example for creating/updating secrets

All three required documentation items are present and accurate relative to the actual script behavior.

**(d) infra/.env.deploy is gitignored**

Command: `grep -n "env.deploy" .gitignore`

Output:
```
20:infra/.env.deploy
```

Entry is present and scoped correctly. Confirmed `backend/.env` (which carries the local dev `GOOGLE_CLIENT_ID`) is also gitignored and not tracked by git (`git ls-files backend/.env` returns empty, exit 0).

**(e) infra/.env.deploy.example exists with correct placeholder vars**

`ls -la infra/` confirms the file exists (440 bytes). Contents read directly:
```
GOOGLE_REDIRECT_URI=https://your-domain.example.com/auth/callback
CORS_ALLOWED_ORIGINS=https://your-domain.example.com
```

Both variables that the script expands (`${GOOGLE_REDIRECT_URI}`, `${CORS_ALLOWED_ORIGINS}`) are present in the example file. Placeholder values use `your-domain.example.com` — not real values.

**Scope check on the broader worktree scan**

A wide scan (`grep -rn "522265251224\|apps.googleusercontent.com"`) found three hits outside the deploy script:
- `docs/deployment.md:25` — contains `helio-backend-522265251224.us-west1.run.app`, which is the GCP project number embedded in a Cloud Run service URL, not the OAuth client ID. Different identifier, different security concern, outside ticket scope. This file has zero diff against main (pre-existing, not modified by this change).
- `backend/.env:4` — local dev env file, gitignored, not tracked by git. Expected and correct.
- Archive files (`evaluation-1.md`, `design.md`) — internal change documentation, not committed as code.

None of these represent a scope gap or a leak of the OAuth client ID in a tracked file.

**Diff reviewed**

`git diff main...HEAD -- infra/` shows exactly the intended change:
- `deploy-backend.sh`: removed `GOOGLE_CLIENT_ID=522265251224-...` from `--set-env-vars`, removed hardcoded `GOOGLE_REDIRECT_URI` and `CORS_ALLOWED_ORIGINS` values, added `.env.deploy` sourcing, added `GOOGLE_CLIENT_ID=helio-google-client-id:latest` to `--set-secrets`
- `infra/.env.deploy.example`: new file with correct placeholder vars
- `infra/README.md`: deploy section expanded with full prerequisites documentation

### Verdict: CONFIRM

All three acceptance criteria are satisfied by independently verified ground truth:

1. `deploy-backend.sh` contains no hardcoded `GOOGLE_CLIENT_ID` value — the only occurrence is the Secret Manager mapping key in `--set-secrets`.
2. The script is syntactically valid (`bash -n` exit 0) and structurally correct for a Cloud Run deploy: env vars sourced from `.env.deploy`, secrets passed via `--set-secrets`.
3. `infra/README.md` documents the required Secret Manager secrets, `.env.deploy` variables, and how to run the script. `infra/.env.deploy` is gitignored and `.env.deploy.example` provides correct placeholder scaffolding.

### Non-blocking notes

- `docs/deployment.md` line 25 contains the GCP project number (`522265251224`) in a Cloud Run service URL — this is distinct from the OAuth client ID and outside ticket scope, but a future hygiene pass could replace it with a generic placeholder to reduce indexed project identifiers.
- The README uses `https://helioapp.dev/auth/callback` as a sample URL while `.env.deploy.example` uses `https://your-domain.example.com/auth/callback`. These are intentionally different (README illustrates a real deployment shape; example file shows a generic placeholder). This is fine but could trip up a first-time deployer if they diff the two files expecting exact correspondence.
