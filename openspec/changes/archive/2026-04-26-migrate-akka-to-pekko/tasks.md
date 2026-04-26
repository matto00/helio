## 1. Backend — Dependencies and Build

- [x] 1.1 In `backend/build.sbt`, replace all 7 `com.typesafe.akka` deps with `org.apache.pekko` equivalents at version 1.1.x (actor-typed, http, http-spray-json, slf4j, stream, testkit, http-testkit)
- [x] 1.2 In `backend/build.sbt`, delete the `loadAkkaLicenseKeyOptions()` function definition
- [x] 1.3 In `backend/build.sbt`, remove the two `loadAkkaLicenseKeyOptions(baseDirectory.value)` call sites from `Compile / run / javaOptions` and `Test / javaOptions`

## 2. Backend — Configuration

- [x] 2.1 In `backend/src/main/resources/application.conf`, rename root block `akka {` → `pekko {`
- [x] 2.2 In `backend/src/main/resources/application.conf`, update logger class `akka.event.slf4j.Slf4jLogger` → `org.apache.pekko.event.slf4j.Slf4jLogger`
- [x] 2.3 In `backend/src/main/resources/application.conf`, update logging-filter class `akka.event.slf4j.Slf4jLoggingFilter` → `org.apache.pekko.event.slf4j.Slf4jLoggingFilter`
- [x] 2.4 In `backend/src/main/resources/application.conf`, remove the `license-key` entries

## 3. Backend — Scala Import Rewrite

- [x] 3.1 Rewrite `import akka.` → `import org.apache.pekko.` in all 21 affected `.scala` files (main and test sources)

## 4. Tests

- [x] 4.1 Run `sbt compile` in `backend/` and confirm zero compilation errors
- [x] 4.2 Run `sbt test` in `backend/` and confirm all test suites pass
