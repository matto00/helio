# HEL-99: Verify Akka license for production (or plan Pekko migration)

## Description

Review Akka license status. Akka moved to BSL in 2022; commercial production use requires a paid license. If cost is a concern, plan a migration to Apache Pekko (drop-in fork, minimal code changes). Decide and document the path before deploying.

## Decision

The decision has been made to migrate from Akka to Apache Pekko (the open-source Apache fork). Pekko is a near drop-in replacement.

## Acceptance Criteria

### build.sbt
- Swap org from `com.typesafe.akka` to `org.apache.pekko` for all 7 Akka deps:
  - actor-typed, http, http-spray-json, slf4j, stream, testkit, http-testkit
- Pekko HTTP is 1.1.x and Pekko core is 1.1.x (as of early 2026)
- Remove `loadAkkaLicenseKeyOptions()` license key plumbing and all `AKKA_LICENSE_KEY` references

### Scala source files (21 files)
- `import akka.` → `import org.apache.pekko.` across all `.scala` files
- No logic changes — purely mechanical import replacements

### application.conf
- Rename `akka {}` block to `pekko {}`
- Remove license-key entries

### Environment / docs
- Remove `AKKA_LICENSE_KEY` from `.env.example` and any other env var documentation files

## Notes

- This is a purely mechanical migration — no behavioral changes
- The backend should compile cleanly and all existing tests should pass after migration
