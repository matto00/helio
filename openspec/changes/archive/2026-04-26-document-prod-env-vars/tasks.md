## 1. Documentation

- [x] 1.1 Add "Running in production" section to README.md with environment variables table (DATABASE_URL, AKKA_LICENSE_KEY)
- [x] 1.2 Add Docker image build instructions to the production section
- [x] 1.3 Add note that Flyway migrations run automatically on container start
- [x] 1.4 Add Cloud Run deployment instructions with gcloud run deploy command and env var flags
- [x] 1.5 Add log access instructions (Cloud Logging console and gcloud CLI)

## 2. Verification

- [x] 2.1 Verify all env vars listed match those in backend/src/main/resources/application.conf
- [x] 2.2 Verify Docker build command matches the Dockerfile at repo root
