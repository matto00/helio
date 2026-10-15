# scala-inline-fqn-guard Specification

## Purpose
Defines what the `check:scala-quality` inline fully-qualified-name guard covers (including java.sql, java.time, java.util and the whole scala namespace), its exemptions, and its failable selftest.

## Requirements

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

The check SHALL NOT report import or package declarations, plain text inside double-quoted string literals (including
the text portions of interpolated literals, `$$` escapes, and a `$ident` reference together with any text following it),
whole-line `//` comments, block and scaladoc comment lines, or the trailing `//` comment portion of a line after code.
Code before a trailing comment SHALL still be checked. Code inside a `${...}` splice of an interpolated literal is not
string text and SHALL NOT be exempt. The splice scan SHALL never add a finding on string text. Lines that the previous
string-blanking detection already reports remain reported (it matches each line of a multi-line `"""` literal on its
own, and text following a `$"` escape, as code): the string-text exemption is therefore guaranteed for the splice scan,
and applies to the legacy detection only as far as that detection already honoured it.

#### Scenario: Trailing comment is ignored but code before it is not

- **WHEN** a line is `val x = 1 // see java.time.Instant`
- **THEN** no violation is reported
- **WHEN** a line is `val t = java.time.Instant.now() // now`
- **THEN** a violation is reported

#### Scenario: String literal and scaladoc are ignored

- **WHEN** a line's only occurrence of an in-scope prefix is inside plain `"..."` text or on a scaladoc `*` line
- **THEN** no violation is reported

#### Scenario: A report of the previous detection is kept

- **WHEN** an inner text line of a multi-line `"""` literal is `  java.time.Instant`
- **THEN** a violation is still reported for that line (the splice scan adds nothing, nothing is removed)

#### Scenario: Plain-string security assertion stays unflagged

- **WHEN** a line is `src should not include "scala.util.Random"`
- **THEN** no violation is reported

### Requirement: Inline-FQN guard has a failable selftest

A selftest SHALL exercise the guard's pure scan function on red fixtures (each in-scope prefix) and green fixtures (each
exemption), and SHALL run every time `npm run check:scala-quality` runs.

#### Scenario: Selftest catches a regressed guard

- **WHEN** a prefix is removed from the guard or the guard's regex is broken
- **THEN** `npm run check:scala-quality` exits non-zero because the selftest fails

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

### Requirement: Inline-FQN guard scans interpolation splices

`npm run check:scala-quality` SHALL check the code inside every `${...}` splice of an interpolated string
literal (an identifier immediately followed by `"`, e.g. `s"..."`, `f"..."`, `raw"..."`, including a splice that spans
lines) as code, with nested braces and nested string literals inside the splice handled, and SHALL report an inline FQN
found there. The check SHALL additionally report every line the previous string-blanking detection reported (a line is
flagged if either detection flags it); the splice scan only adds findings and never flags plain string text.

#### Scenario: FQN inside a splice is flagged

- **WHEN** a line is `val s = s"id=${java.util.UUID.randomUUID()}"`
- **THEN** the check reports a violation for that line and exits non-zero

#### Scenario: FQN inside a splice with nested braces is flagged

- **WHEN** a line is `val s = s"${xs.map { x => 1 }.map(_ => java.time.Instant.now())}"`
- **THEN** a violation is reported

#### Scenario: Same text in a plain literal is not flagged

- **WHEN** a line is `val s = "${java.util.UUID.randomUUID()}"`
- **THEN** no violation is reported

#### Scenario: Unbraced identifier reference is not an FQN

- **WHEN** a line is `val s = s"$java.util.UUID and $$java.time.Instant"`
- **THEN** no violation is reported

#### Scenario: The repository passes the wider scan

- **WHEN** `npm run check:scala-quality` runs against the repository
- **THEN** it exits zero, every newly found splice violation having been replaced by an import

### Requirement: Splice scan honours nested block comments

The splice scan SHALL treat Scala block comments as nesting: a `/*` inside an open block comment opens a nested level,
each `*/` closes one level, and text is code again only after the `*/` that closes the outermost level, on one line
and across lines. A `${...}` splice inside any level of a block comment SHALL NOT be reported by the splice scan. A
splice in code after the outermost comment is closed SHALL still be reported. Reports of the previous string-blanking
detection are unaffected.

#### Scenario: Splice inside a nested comment on one line is not flagged

- **WHEN** a line is `/* a /* b */ s"${java.util.UUID.randomUUID()}" */`
- **THEN** no violation is reported

#### Scenario: Splice inside a multi-line nested comment is not flagged

- **WHEN** the text is `/* a` then ` /* b */ s"${java.util.UUID.randomUUID()}"` then `*/` on separate lines
- **THEN** no violation is reported

#### Scenario: Splice after a fully closed nested comment is flagged

- **WHEN** a line is `/* a /* b */ */ val s = s"${java.util.UUID.randomUUID()}"`
- **THEN** a violation is reported for that line
