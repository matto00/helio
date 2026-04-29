# backend-runtime Specification

## Purpose
Specifies Apache Pekko as the backend actor and HTTP runtime, replacing Akka to eliminate the commercial license requirement.
## Requirements
### Requirement: Backend uses Apache Pekko as its actor and HTTP runtime
The backend SHALL use Apache Pekko (org.apache.pekko) for all actor, HTTP, and stream functionality instead of Akka (com.typesafe.akka). No Akka license key SHALL be required to build or run the backend.

#### Scenario: Backend starts without AKKA_LICENSE_KEY in environment
- **WHEN** the backend is started without an `AKKA_LICENSE_KEY` environment variable
- **THEN** the server SHALL start successfully and serve HTTP requests on the configured port

#### Scenario: Backend build succeeds with Pekko dependencies
- **WHEN** `sbt compile` is run
- **THEN** all sources SHALL compile against `org.apache.pekko` packages with no unresolved `com.typesafe.akka` references

#### Scenario: All existing API tests pass after migration
- **WHEN** `sbt test` is run
- **THEN** all test suites SHALL pass, confirming behavioral equivalence with the pre-migration Akka runtime

