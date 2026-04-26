# Helio — Production Deployment

Helio's backend is distributed as a Docker image. The frontend is bundled into
the same image and served as static files via the Akka HTTP server.

## Environment variables

| Variable           | Required | Description                                                      |
| ------------------ | -------- | ---------------------------------------------------------------- |
| `DATABASE_URL`     | Yes      | JDBC connection string, e.g. `jdbc:postgresql://host:5432/helio` |
| `AKKA_LICENSE_KEY` | Yes      | Akka commercial license key (required by Akka HTTP)              |

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

```bash
gcloud run deploy helio \
  --image gcr.io/<PROJECT_ID>/helio-backend \
  --platform managed \
  --region <REGION> \
  --port 8080 \
  --set-env-vars "DATABASE_URL=jdbc:postgresql://<HOST>:5432/helio,AKKA_LICENSE_KEY=<KEY>" \
  --allow-unauthenticated
```

Replace `<PROJECT_ID>`, `<REGION>`, `<HOST>`, and `<KEY>` with your values.
Push the image to Container Registry before deploying:

```bash
docker tag helio-backend gcr.io/<PROJECT_ID>/helio-backend
docker push gcr.io/<PROJECT_ID>/helio-backend
```

## Logs

The backend writes structured logs to stdout. On Cloud Run, stdout is
automatically forwarded to **Cloud Logging**.

- **Google Cloud console**: Navigate to Logging → Log Explorer, filter by
  `resource.type="cloud_run_revision"` and your service name.
- **gcloud CLI**:
  ```bash
  gcloud run services logs read helio --region <REGION>
  ```
