#!/usr/bin/env bash
set -euo pipefail

gcloud run deploy helio-backend \
  --image=us-west1-docker.pkg.dev/helio-493120/helio-backend/helio-backend:v3 \
  --region=us-west1 \
  --platform=managed \
  --add-cloudsql-instances=helio-493120:us-west1:helio-db \
  --service-account=helio-backend-sa@helio-493120.iam.gserviceaccount.com \
  --set-env-vars="^|^DATABASE_URL=jdbc:postgresql:///helio?cloudSqlInstance=helio-493120:us-west1:helio-db&socketFactory=com.google.cloud.sql.postgres.SocketFactory|DB_USER=helio|GOOGLE_CLIENT_ID=522265251224-eannmal9699u40d7d6f0gqpd733gm5hk.apps.googleusercontent.com|GOOGLE_REDIRECT_URI=https://helio-493120.web.app/auth/callback|CORS_ALLOWED_ORIGINS=http://localhost:5173,https://helio-493120.web.app" \
  --set-secrets=DB_PASSWORD=helio-db-password:latest,GOOGLE_CLIENT_SECRET=helio-google-client-secret:latest \
  --memory=1Gi \
  --cpu=1 \
  --concurrency=80 \
  --max-instances=3 \
  --min-instances=0 \
  --allow-unauthenticated \
  --project=helio-493120
