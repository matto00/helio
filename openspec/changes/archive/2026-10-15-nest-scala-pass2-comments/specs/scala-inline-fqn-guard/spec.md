## ADDED Requirements

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
