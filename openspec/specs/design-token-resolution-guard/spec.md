# design-token-resolution-guard Specification

## Purpose
Defines the mechanical guarantee that every CSS custom-property reference in the frontend stylesheet
set resolves to a defined token — the resolution rule, comment handling, the runtime-injection
allowlist and its evidence requirement, and the guard's own continuously-demonstrated failability.

## Requirements

### Requirement: Every var() reference must resolve to a defined token
A check SHALL scan the frontend stylesheet set and fail when any `var(--*)` reference does not
resolve to a custom property defined somewhere in that same set. The failure output SHALL name each
unresolved reference with its file and line. An undefined custom property fails open at runtime —
the element renders with an inherited or initial value rather than erroring — so this check is the
only mechanism that can detect the class.

#### Scenario: An undefined token reference fails the check
- **WHEN** a stylesheet references a custom property that is defined nowhere in the scanned set
- **THEN** the check fails and names that reference's file and line

#### Scenario: A defined token reference passes
- **WHEN** every referenced custom property is defined somewhere in the scanned set
- **THEN** the check passes

#### Scenario: Tokens defined outside the primary theme file still resolve
- **WHEN** a custom property is defined in a stylesheet other than the primary theme file and
  referenced from anywhere in the scanned set
- **THEN** that reference resolves and does not fail the check

### Requirement: References inside comments are not treated as references
The check SHALL disregard `var()` occurrences appearing inside CSS comments, and SHALL preserve line
numbering when doing so, so that reported locations remain accurate. A comment may wrap mid-token
across a line break, producing a fragment that resembles an undefined reference.

#### Scenario: A var() inside a comment does not fail the check
- **WHEN** a stylesheet comment contains text resembling a `var(--*)` reference, including one that
  wraps across a line break mid-token
- **THEN** the check does not report it

#### Scenario: Reported line numbers survive comment handling
- **WHEN** the check reports an unresolved reference in a file that also contains comments
- **THEN** the reported line number matches the reference's true line in the original file

### Requirement: The check passes against the unmodified codebase
The check SHALL pass against the repository with no outstanding token defects. A guard that fails on
first installation against correctly-defined tokens is bypassed rather than fixed, so a first-run
pass is a requirement of the guard itself, not merely an expectation.

#### Scenario: A clean codebase produces no findings
- **WHEN** the check runs against the codebase with the known token defects corrected
- **THEN** it reports no findings and exits successfully

### Requirement: Only declarations count as definitions
A custom property SHALL be treated as defined only where it appears as a DECLARATION — in a position
where a property may appear — and SHALL NOT be treated as defined merely because the same text
appears elsewhere, such as within a selector. A modifier segment of a class selector followed by a
pseudo-class or pseudo-element colon resembles a declaration textually and MUST NOT be accepted as
one; accepting it would let an undefined reference resolve against a selector fragment, so the check
would fail open on the class it exists to detect.

Because an over-permissive definition matcher produces no visible symptom — every genuine token is
still recognised, and the check still passes — the guard's own verification SHALL include an
assertion that an over-permissive definition matcher would fail. That assertion SHALL NOT be
expressed as a fixed count of the live codebase's tokens, because such a count would fail on every
legitimate token addition and invite being bumped rather than investigated.

#### Scenario: A selector fragment is not accepted as a definition
- **WHEN** a stylesheet contains a class selector whose modifier segment is followed by a
  pseudo-class colon, and a reference names that modifier segment as if it were a token
- **THEN** the check fails for that reference, because the selector never defined it

#### Scenario: An over-permissive definition matcher is detected
- **WHEN** the definition extractor is exercised over a controlled input containing one real
  declaration alongside selector constructs that resemble declarations
- **THEN** the extracted definition set is exactly the one real declaration, and a matcher that also
  admitted the selector constructs would fail this assertion

#### Scenario: Verification does not depend on the live token count
- **WHEN** a legitimate new token is added to the codebase
- **THEN** the guard's verification still passes without being edited

### Requirement: Runtime-injected tokens are allowlisted with their setter named
A custom property that is assigned at runtime rather than declared in a stylesheet SHALL be
allowlisted, and each allowlist entry SHALL name the source file that assigns it. An entry that
merely asserts a justification, without identifying the assigning code, SHALL NOT be considered
adequate — the claim must be checkable, so that an entry becomes obviously stale when its setter is
removed.

#### Scenario: An allowlisted runtime token does not fail the check
- **WHEN** a token is assigned at runtime and carries an allowlist entry naming its setter
- **THEN** references to it resolve and do not fail the check

#### Scenario: An undefined token that is not allowlisted still fails
- **WHEN** a token is neither defined in the scanned set nor allowlisted
- **THEN** the check fails for it

### Requirement: The guard demonstrates its own failability continuously
A companion self-test SHALL introduce a reference that must fail, run the check, and assert it
fails. The self-test SHALL run wherever the check runs, so the guard's failability is re-proven on
every execution rather than once at review time. A guard verified failable only once can silently
stop being failable through a later change.

#### Scenario: The self-test proves the check rejects an undefined reference
- **WHEN** the self-test runs
- **THEN** it introduces a reference that cannot resolve, observes the check fail, and reports
  success only on that failure

#### Scenario: The self-test leaves no residue when it fails partway
- **WHEN** the self-test is interrupted or fails partway through
- **THEN** no planted reference remains in any tracked file, and the working tree is left as it was
  found

### Requirement: The guard behaves identically in a linked worktree
The check SHALL produce the same result whether invoked from a primary checkout or a linked
worktree, and SHALL NOT depend on repository-metadata layout that differs between them.

#### Scenario: The check produces the same verdict from a linked worktree
- **WHEN** the check runs from a linked worktree over the same sources
- **THEN** its verdict matches the verdict from a primary checkout
