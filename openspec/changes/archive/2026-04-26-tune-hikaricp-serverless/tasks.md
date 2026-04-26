## 1. Backend

- [x] 1.1 In `backend/src/main/resources/application.conf`, replace `numThreads = 10` and `maxConnections = 10` with `numThreads = 5` and `maximumPoolSize = 5`
- [x] 1.2 Add `minimumIdle = 0`, `idleTimeout = 30000`, `maxLifetime = 60000` to the `helio.db` block
- [x] 1.3 Add a comment block above the pool settings documenting the Cloud Run / Cloud SQL connection-exhaustion rationale

## 2. Tests

- [x] 2.1 Verify `sbt test` passes with no regressions after the config change
