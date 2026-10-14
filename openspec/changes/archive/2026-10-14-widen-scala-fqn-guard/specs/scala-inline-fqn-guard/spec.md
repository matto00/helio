## ADDED Requirements

### Requirement: Inline-FQN guard covers the whole scala namespace

`npm run check:scala-quality` SHALL fail on any non-exempt line in `backend/src/main/scala` or `backend/src/test/scala`
that contains an inline qualified reference beginning with `scala.` followed by a word character — including, but not
limited to, `scala.util.`, `scala.collection.`, `scala.io.`, `scala.concurrent.` and `scala.annotation.`. The existing
exemptions (import/package declarations, string literals, comments) SHALL apply unchanged. The repository's own Scala
sources SHALL pass the widened check, each previously inline use being replaced by an import.

#### Scenario: Inline scala.util.Try fails the check

- **WHEN** a Scala source line outside an import/package declaration contains `scala.util.Try(x)`
- **THEN** the check reports a violation for that line and exits non-zero

#### Scenario: Inline scala.collection.mutable fails the check

- **WHEN** a Scala source line contains `scala.collection.mutable.LinkedHashMap.empty[String, Int]`
- **THEN** the check reports a violation for that line

#### Scenario: Inline scala.io.Source fails the check

- **WHEN** a Scala source line contains `scala.io.Source.fromFile(f)`
- **THEN** the check reports a violation for that line

#### Scenario: An import of a scala member is not reported

- **WHEN** a line is `import scala.collection.mutable` or `import scala.util.{Failure, Success, Try}`
- **THEN** no violation is reported

#### Scenario: The repository passes the widened check

- **WHEN** `npm run check:scala-quality` runs against the repository
- **THEN** it exits zero with no inline `scala.` violations
