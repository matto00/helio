## MODIFIED Requirements

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

## ADDED Requirements

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
