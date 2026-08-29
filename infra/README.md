# Helio — Production Deployment

Helio's backend is distributed as a Docker image. The frontend is bundled into
the same image and served as static files via the Pekko HTTP server.

## Environment variables

| Variable       | Required | Description                                                      |
| -------------- | -------- | ---------------------------------------------------------------- |
| `DATABASE_URL` | Yes      | JDBC connection string, e.g. `jdbc:postgresql://host:5432/helio` |

See `.env.example` at the repo root for the full list of optional env vars.

## Build the Docker image

From the repository root:

```bash
docker build -t helio-backend .
```

The multi-stage build compiles the fat JAR with sbt, then packages it into a
minimal JRE image. The resulting image exposes port `8080`.

## Database migrations

Flyway migrations run automatically when the server starts. No separate
migration command is required. Migrations are located in
`backend/src/main/resources/db/migration/`.

## Deploy to Cloud Run

The `infra/deploy-backend.sh` script deploys the backend to Cloud Run. It
requires three prerequisites before it can run.

### Prerequisites

#### 1. Private networking (Serverless VPC Access + Cloud SQL Private IP)

The backend connects to Cloud SQL over a **Serverless VPC Access connector +
Cloud SQL Private IP** — Google's recommended production setup for Cloud
Run → Cloud SQL traffic (HEL-749). This replaces the older
`postgres-socket-factory` connector library (`cloudSqlInstance` +
`socketFactory` JDBC params, `--add-cloudsql-instances`): that path paid for
a TLS handshake plus an ephemeral-cert fetch through the Cloud SQL Admin API
on every new physical connection, which was the confirmed failure point
behind repeated production connection-storm incidents.

Before running `deploy-backend.sh`, the following must already exist in the
`helio-493120` project (`us-west1`):

- A Serverless VPC Access connector named `helio-vpc-connector`, in `READY`
  state, on the `default` VPC network.
- Private IP enabled on the `helio-db` Cloud SQL instance, peered to the
  same VPC via a Private Services Access connection.

`deploy-backend.sh` passes `--vpc-connector=helio-vpc-connector
--vpc-egress=private-ranges-only` to `gcloud run deploy`, and sets
`DATABASE_URL` to `helio-db`'s private IP directly (e.g.
`jdbc:postgresql://<private-ip>:5432/helio?sslmode=require` — the
`sslmode=require` param is required because `helio-db`'s `sslMode` is
`ENCRYPTED_ONLY` and pgjdbc does not negotiate SSL by default). If either
prerequisite is missing, the deploy will fail or the resulting revision
will be unable to reach the database.

#### 2. Secret Manager secrets

The following secrets must exist in Google Secret Manager under the
`helio-493120` project before running the script:

| Secret name                  | Value                                    |
| ---------------------------- | ---------------------------------------- |
| `helio-db-password`          | PostgreSQL password for the `helio` user |
| `helio-google-client-secret` | Google OAuth 2.0 Client Secret           |

Note: the Google OAuth 2.0 **Client ID** (`GOOGLE_CLIENT_ID`) is not a secret —
it's a public identifier, not a confidential credential — and is passed to
Cloud Run as a plain `--set-env-vars` value in `deploy-backend.sh`, not via
Secret Manager. See "Run the deploy" below.

Create or update a secret:

```bash
echo -n "YOUR_VALUE" | gcloud secrets create helio-google-client-secret \
  --data-file=- --project=helio-493120
# or, to update an existing secret version:
echo -n "YOUR_VALUE" | gcloud secrets versions add helio-google-client-secret \
  --data-file=- --project=helio-493120
```

#### 3. `.env.deploy` file

Copy the example file and fill in environment-specific values:

```bash
cp infra/.env.deploy.example infra/.env.deploy
```

Then edit `infra/.env.deploy`:

| Variable               | Description                                                                                                                                                                                                            |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GOOGLE_CLIENT_ID`     | Google OAuth 2.0 Client ID, e.g. `522265251224-....apps.googleusercontent.com` — not a secret (a public identifier), but environment-specific config, so it lives here rather than as a literal in `deploy-backend.sh` |
| `GOOGLE_REDIRECT_URI`  | OAuth redirect URL, e.g. `https://helioapp.dev/auth/callback`                                                                                                                                                          |
| `CORS_ALLOWED_ORIGINS` | Comma-separated allowed origins, e.g. `https://helioapp.dev`                                                                                                                                                           |

`infra/.env.deploy` is gitignored and must never be committed.

### Run the deploy

`deploy-backend.sh` is a **manual/bootstrap deploy path** — it is not the
routine way production gets deployed. The automated deploy pipeline is
`.github/workflows/cd-backend.yml`, which builds and pushes a fresh
versioned image (`release-<version>-<8-char-sha>`, e.g.
`release-v0.8.0-4b1d794f`) and deploys it on every push of a `v*` **tag** —
not on a branch push. Cut a release with `/release <major.minor>`
(`scripts/release/cut-release.sh`); the tag push is what deploys. Use
`deploy-backend.sh` for one-off/manual deploys (e.g. redeploying an existing
image, a cutover deploy with extra flags) — not as a substitute for the CD
pipeline.

The script requires an explicit `--image=<full-image-path:tag>` flag; it
hardcodes no default image tag and will refuse to run without one:

```bash
bash infra/deploy-backend.sh --image=<full-image-path:tag>
```

To determine the correct tag to pass, use one of:

- **The currently-live tag** — query the running Cloud Run revision:

  ```bash
  gcloud run services describe helio-backend --region=us-west1 --project=helio-493120 \
    --format='value(spec.template.spec.containers[0].image)'
  ```

- **A CI-built tag for a specific commit** — find the matching run of
  `.github/workflows/cd-backend.yml` for that commit/branch; its "Build and
  push image" step logs the pushed tag (`<branch>-<8-char-sha>`).

The script:

1. Sources `infra/.env.deploy` to inject `GOOGLE_CLIENT_ID`, `GOOGLE_REDIRECT_URI`, and `CORS_ALLOWED_ORIGINS`.
2. Passes `DB_PASSWORD` and `GOOGLE_CLIENT_SECRET` to Cloud Run via `--set-secrets` (Secret Manager references — no plaintext on the command line). `GOOGLE_CLIENT_ID` is passed as a plain `--set-env-vars` value instead — Google OAuth client IDs are public identifiers, not secrets.
3. Guards against a missing `--image=` flag, exiting non-zero with guidance (both lookups above) before invoking `gcloud` if none is present.
4. Runs `gcloud run deploy` targeting the `helio-493120` GCP project in `us-west1`, forwarding any extra CLI arguments (including the required `--image=` flag) verbatim.

## Logs

The backend writes structured logs to stdout. On Cloud Run, stdout is
automatically forwarded to **Cloud Logging**.

- **Google Cloud console**: Navigate to Logging → Log Explorer, filter by
  `resource.type="cloud_run_revision"` and your service name.
- **gcloud CLI**:
  ```bash
  gcloud run services logs read helio-backend --region us-west1 --project helio-493120
  ```
