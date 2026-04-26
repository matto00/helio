## Context

The backend currently depends on `com.typesafe.akka` at versions 2.8.8 (core) and 10.5.3 (HTTP). Akka's BSL license requires a paid license for commercial production use. `build.sbt` contains a `loadAkkaLicenseKeyOptions()` helper that injects `-Dakka.license-key=<value>` from the `.env` file's `AKKA_LICENSE_KEY` entry. `application.conf` has a corresponding `akka { license-key }` stanza.

Apache Pekko is the ASF-governed fork that diverged at Akka 2.6. Pekko 1.1.x is API-compatible with Akka 2.6/2.8 at the import level for the subset of modules used here (actor-typed, http, http-spray-json, slf4j, stream, testkit, http-testkit). The migration is mechanical.

## Goals / Non-Goals

**Goals:**
- Replace all 7 Akka library dependencies with Pekko 1.1.x equivalents.
- Rewrite all `import akka.` statements to `import org.apache.pekko.` across the 21 affected `.scala` files.
- Rename `akka {}` → `pekko {}` in `application.conf` and remove license-key config entries.
- Remove `loadAkkaLicenseKeyOptions()` and all `AKKA_LICENSE_KEY` references from `build.sbt`.

**Non-Goals:**
- No Pekko API usage beyond what mirrors the current Akka usage.
- No configuration tuning or actor-system restructuring.
- No changes to the frontend, database layer, or any non-Akka backend code.

## Decisions

### D1 — Use Pekko 1.1.x for all modules
Pekko 1.1.x is the current stable line as of early 2026. Core (`pekko-actor-typed`, `pekko-stream`, `pekko-slf4j`) and HTTP (`pekko-http`, `pekko-http-spray-json`) are both at 1.1.x. Test modules (`pekko-testkit`, `pekko-http-testkit`) follow the same versioning.

**Alternative considered**: Stay on Pekko 1.0.x — rejected; 1.1.x is the active branch and matches the stable artifact names.

### D2 — Rename `akka {}` to `pekko {}` in application.conf
Pekko reads its configuration from the `pekko` namespace, not `akka`. A direct key rename is sufficient; no other config values need to change. The loggers class path also changes from `akka.event.slf4j.*` to `org.apache.pekko.event.slf4j.*`.

### D3 — Remove license-key infrastructure entirely
`loadAkkaLicenseKeyOptions()` in `build.sbt` injected `-Dakka.license-key` as a JVM flag. Pekko has no license requirement. The function and its call sites in `Compile / run / javaOptions` and `Test / javaOptions` should be deleted. `loadDotEnv()` itself is retained — it also loads `DATABASE_URL` and other env vars.

## Risks / Trade-offs

- **Import collision if Akka JARs linger** → `build.sbt` dependency swap ensures Akka JARs are not on the classpath; `sbt reload` + clean build confirms.
- **Pekko spray-json module name** → `pekko-http-spray-json` retains the same artifact suffix; the package path changes from `akka.http.scaladsl.marshallers.sprayjson` to `org.apache.pekko.http.scaladsl.marshallers.sprayjson`.
- **application.conf logger class paths** → Must also update `akka.event.slf4j.Slf4jLogger` → `org.apache.pekko.event.slf4j.Slf4jLogger` and the logging-filter class.

## Planner Notes

This change was self-approved. No external dependencies beyond the public Apache Pekko Maven artifacts. No spec-level behavior changes — proposal declares zero new or modified capabilities, so no spec files are created.
