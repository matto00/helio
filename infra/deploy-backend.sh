#!/usr/bin/env bash
set -euo pipefail

# Load environment-specific configuration (GOOGLE_REDIRECT_URI, CORS_ALLOWED_ORIGINS).
# Copy infra/.env.deploy.example to infra/.env.deploy and fill in your values.
set -a; source "$(dirname "$0")/.env.deploy"; set +a

gcloud run deploy helio-backend \
  --image=us-west1-docker.pkg.dev/helio-493120/helio-backend/helio-backend:v3 \
  --region=us-west1 \
  --platform=managed \
  --add-cloudsql-instances=helio-493120:us-west1:helio-db \
  --service-account=helio-backend-sa@helio-493120.iam.gserviceaccount.com \
  --set-env-vars="^|^DATABASE_URL=jdbc:postgresql:///helio?cloudSqlInstance=helio-493120:us-west1:helio-db&socketFactory=com.google.cloud.sql.postgres.SocketFactory|DB_USER=helio|GOOGLE_REDIRECT_URI=${GOOGLE_REDIRECT_URI}|CORS_ALLOWED_ORIGINS=${CORS_ALLOWED_ORIGINS}" \
  --set-secrets=DB_PASSWORD=helio-db-password:latest,GOOGLE_CLIENT_SECRET=helio-google-client-secret:latest,GOOGLE_CLIENT_ID=helio-google-client-id:latest \
  --memory=1Gi \
  --cpu=1 \
  --concurrency=80 \
  --max-instances=3 \
  --min-instances=0 \
  --allow-unauthenticated \
  --project=helio-493120
