## ADDED Requirements

### Requirement: Inline-FQN guard covers java.sql, java.time, java.util and scala.annotation

`npm run check:scala-quality` SHALL fail on any non-exempt line in `backend/src/main/scala` or `backend/src/test/scala`
that contains an inline qualified reference beginning with `java.sql.`, `java.time.`, `java.util.` or `scala.annotation.`,
in addition to the prefixes it already covered. Every configured prefix SHALL end in `.`, so that each one can fire.

#### Scenario: java.util.UUID inline reference fails the check

- **WHEN** a Scala source line outside an import/package declaration contains `java.util.UUID.randomUUID()`
- **THEN** the check reports a violation for that line and exits non-zero

#### Scenario: Inline annotation fails the check

- **WHEN** a Scala source line contains `@scala.annotation.tailrec`
- **THEN** the check reports a violation for that line

#### Scenario: A prefix not ending in a dot is rejected

- **WHEN** the configured prefix list contains an entry that does not end in `.`
- **THEN** the script fails at load time instead of silently never matching

### Requirement: Inline-FQN guard exemptions

The check SHALL NOT report import or package declarations, text inside double-quoted string literals, whole-line `//`
comments, block and scaladoc comment lines, or the trailing `//` comment portion of a line after code. Code before a
trailing comment SHALL still be checked.

#### Scenario: Trailing comment is ignored but code before it is not

- **WHEN** a line is `val x = 1 // see java.time.Instant`
- **THEN** no violation is reported
- **WHEN** a line is `val t = java.time.Instant.now() // now`
- **THEN** a violation is reported

#### Scenario: String literal and scaladoc are ignored

- **WHEN** a line's only occurrence of an in-scope prefix is inside `"..."` or on a scaladoc `*` line
- **THEN** no violation is reported

### Requirement: Inline-FQN guard has a failable selftest

A selftest SHALL exercise the guard's pure scan function on red fixtures (each in-scope prefix) and green fixtures (each
exemption), and SHALL run every time `npm run check:scala-quality` runs.

#### Scenario: Selftest catches a regressed guard

- **WHEN** a prefix is removed from the guard or the guard's regex is broken
- **THEN** `npm run check:scala-quality` exits non-zero because the selftest fails
