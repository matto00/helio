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
requires two prerequisites before it can run.

### Prerequisites

#### 1. Secret Manager secrets

The following secrets must exist in Google Secret Manager under the
`helio-493120` project before running the script:

| Secret name                  | Value                                    |
| ---------------------------- | ---------------------------------------- |
| `helio-db-password`          | PostgreSQL password for the `helio` user |
| `helio-google-client-secret` | Google OAuth 2.0 Client Secret           |
| `helio-google-client-id`     | Google OAuth 2.0 Client ID               |

Create or update a secret:

```bash
echo -n "YOUR_VALUE" | gcloud secrets create helio-google-client-id \
  --data-file=- --project=helio-493120
# or, to update an existing secret version:
echo -n "YOUR_VALUE" | gcloud secrets versions add helio-google-client-id \
  --data-file=- --project=helio-493120
```

#### 2. `.env.deploy` file

Copy the example file and fill in environment-specific values:

```bash
cp infra/.env.deploy.example infra/.env.deploy
```

Then edit `infra/.env.deploy`:

| Variable               | Description                                                   |
| ---------------------- | ------------------------------------------------------------- |
| `GOOGLE_REDIRECT_URI`  | OAuth redirect URL, e.g. `https://helioapp.dev/auth/callback` |
| `CORS_ALLOWED_ORIGINS` | Comma-separated allowed origins, e.g. `https://helioapp.dev`  |

`infra/.env.deploy` is gitignored and must never be committed.

### Run the deploy

```bash
bash infra/deploy-backend.sh
```

The script:

1. Sources `infra/.env.deploy` to inject `GOOGLE_REDIRECT_URI` and `CORS_ALLOWED_ORIGINS`.
2. Passes `DB_PASSWORD`, `GOOGLE_CLIENT_SECRET`, and `GOOGLE_CLIENT_ID` to Cloud Run via `--set-secrets` (Secret Manager references — no plaintext on the command line).
3. Runs `gcloud run deploy` targeting the `helio-493120` GCP project in `us-west1`.

## Logs

The backend writes structured logs to stdout. On Cloud Run, stdout is
automatically forwarded to **Cloud Logging**.

- **Google Cloud console**: Navigate to Logging → Log Explorer, filter by
  `resource.type="cloud_run_revision"` and your service name.
- **gcloud CLI**:
  ```bash
  gcloud run services logs read helio-backend --region us-west1 --project helio-493120
  ```
