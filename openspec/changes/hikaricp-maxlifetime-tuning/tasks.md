## 1. ### Backend

- [x] 1.1 In `backend/src/main/resources/application.conf`, raise `maxLifetime` from `60000` to
      `1800000` on the `helio.db` pool.
- [x] 1.2 In the same file, raise `maxLifetime` from `60000` to `1800000` on the
      `helio.db.privileged` pool.
- [x] 1.3 Update the tuning comment block above both stanzas to explain the corrected
      rationale (housekeeper-driven idle-connection recycling vs. actual Cloud SQL/connector
      constraints), replacing the stale "well within Cloud SQL's idle-connection timeout,
      preventing unexpected connection reset errors" framing.

## 2. ### Tests

- [x] 2.1 Run `sbt test` from `backend/` — confirm the full suite still passes with no
      behavioral regression (this is a config-only value change; no new test is expected to be
      required, but existing DB-pool-adjacent tests, if any, must still pass).
- [x] 2.2 Run `sbt scalafmtCheckAll` / the project's configured backend lint gate — confirm the
      touched files pass formatting/lint cleanly.
- [x] 2.3 Manually inspect the final `application.conf` diff to confirm only the intended
      `maxLifetime` values and comment text changed — no accidental edits to `minimumIdle`,
      `maximumPoolSize`, or `idleTimeout`.
