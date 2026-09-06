# agent-surface-credential-gate Specification

## Purpose
Defines the commit-time credential-leak gate's declared scan surfaces, the checks that apply to each, and the
failure behaviors that keep a green result from ever meaning "nothing was examined".

## Requirements

### Requirement: Declared scan surfaces

The gate SHALL derive every file it scans from a single, in-script surface table. Each surface SHALL declare an
identifier, a root directory relative to the repository root, the file-inclusion rule for that root, and the set of
checks that apply to it. The table SHALL be the sole source of truth for the gate's coverage; no check may scan a
path that no surface declares.

#### Scenario: The MCP client surface is scanned

- **WHEN** the gate runs against the repository
- **THEN** files under `helio-mcp/` (excluding `node_modules/` and `dist/`) are among the files it scans
- **AND** the success line reports a per-surface file count that includes that surface by name

#### Scenario: Coverage is reported, not asserted in prose

- **WHEN** the gate completes without violations
- **THEN** it prints the total number of files scanned and a per-surface breakdown, so the number is checkable
  against the surface table

### Requirement: A vacuous run fails

The gate SHALL fail with a non-zero exit status when any declared surface resolves to zero scannable files. A
surface that matches nothing indicates the root has moved, been renamed, or been deleted, and SHALL NOT be reported
as a passing contribution of zero violations.

#### Scenario: A declared surface root no longer exists

- **WHEN** a declared surface's root directory is absent or contains no scannable files
- **THEN** the gate exits non-zero
- **AND** the message names the surface and its root, and states that it matched zero files

### Requirement: Coverage drift fails

Every top-level directory in the repository SHALL be classified into exactly one of three states: fully covered by
a declared surface root at, inside, or beneath it; partially covered, requiring a recorded entry naming the scanned
subtree and why the remainder is not scanned; or acknowledged unscanned, requiring a recorded one-line reason. The
gate SHALL fail when it finds a top-level directory in none of the three states. Directories that are never
committed — build and tooling output, and dot-prefixed directories — SHALL be excluded from classification, and the
basis for that exclusion SHALL be documented in the script.

#### Scenario: A new top-level directory appears

- **WHEN** a top-level directory exists that is in none of the three classified states
- **THEN** the gate exits non-zero
- **AND** the message names the directory and states which list to add it to

#### Scenario: A partially covered directory is not misreported as unscanned

- **WHEN** a top-level directory contains a declared surface root but is not wholly covered by it
- **THEN** it is recorded as partially covered, distinctly from an acknowledged-unscanned directory, so a future
  loss of that surface root is not indistinguishable from a deliberate acknowledgment

#### Scenario: The guard is stable across checkouts

- **WHEN** the gate runs from a linked worktree and from the main checkout, whose top-level contents differ by
  uncommitted build and tooling output
- **THEN** the classification and the verdict are the same in both

### Requirement: Secret-literal detection on the MCP surface

The gate SHALL fail when a file on the MCP surface contains a hardcoded credential-shaped string literal — a
personal-access-token or vendor-API-key-shaped value, or a string literal assigned to an identifier whose name ends
in `KEY`, `SECRET`, `TOKEN`, or `PASSWORD`. A vendor-prefixed value SHALL match only when the prefix is followed by
a credential-length run of token characters, so that a bare prefix constant, a short test value, and a
documentation placeholder are structurally excluded rather than requiring an exemption.

#### Scenario: A hardcoded token literal is committed

- **WHEN** a file under `helio-mcp/` assigns a credential-shaped string literal of credential length
- **THEN** the gate exits non-zero, naming the file and line

#### Scenario: A prefix constant and a documentation placeholder are not violations

- **WHEN** a file declares the token prefix alone as a named constant, or documents a placeholder such as an
  elided or repeated-character token
- **THEN** the gate passes, without that value being added to any allowlist and without renaming the constant

### Requirement: False positives are resolved by convention

Legitimate synthetic values SHALL be accepted on the basis of stated, followable conventions rather than
per-value allowlist entries. Placeholder email domains SHALL be the reserved domains (`example.com`, `example.org`,
`example.net`, `example.invalid`, and any `.test` domain). A credential-shaped literal SHALL be accepted when it is
empty or carries a documented synthetic marker.

#### Scenario: A future author adds a test fixture

- **WHEN** an author writes a new placeholder email on a reserved domain, or a credential-shaped literal carrying a
  documented synthetic marker
- **THEN** the gate passes without any edit to the gate script

#### Scenario: A real-looking value is committed

- **WHEN** an author writes an email on a non-reserved domain, or a credential-shaped literal with no synthetic
  marker, on a scanned surface
- **THEN** the gate exits non-zero

### Requirement: New coverage is proven by the self-test

Each surface, check, and structural guard the gate applies SHALL have a corresponding self-test case that plants a
violating condition, asserts the gate exits non-zero, removes it, and asserts the gate exits zero. Planted values
SHALL be obviously synthetic. Every self-test case SHALL itself be mutation-verified: breaking the behavior under
test in the shipped gate script SHALL turn that case red, so a case can never silently degrade into a test of a
copy or of nothing. This requirement is no longer scoped to newly added coverage: the assistant-surface
import-graph and credential-property checks are within it.

#### Scenario: The self-test proves the MCP surface is genuinely scanned

- **WHEN** the self-test runs
- **THEN** it plants a credential-shaped literal under `helio-mcp/`, observes a non-zero exit, removes the planted
  file, and observes a zero exit
- **AND** it removes the planted file even when an assertion fails

#### Scenario: The self-test proves the import-graph check is live

- **WHEN** the self-test plants a non-test module on the assistant surface that transitively imports a banned
  credential-carrying component
- **THEN** the gate exits non-zero naming the banned module and the import chain
- **AND** removing the planted module returns the gate to exit zero

#### Scenario: The self-test proves the credential-property check is live

- **WHEN** the self-test plants a non-test module on the assistant surface declaring a property literally named
  `credential`
- **THEN** the gate exits non-zero naming the file and line
- **AND** removing the planted module returns the gate to exit zero

#### Scenario: The self-test proves an unreadable imported module fails the walk

- **WHEN** the self-test makes a module transitively imported from the assistant surface unreadable
- **THEN** the gate exits non-zero naming that module, rather than reporting a completed walk that found nothing

#### Scenario: A self-test case is proven against the shipped script

- **WHEN** the behavior a self-test case exercises is disabled in the shipped gate script
- **THEN** that case fails

### Requirement: An unreadable file or unlistable directory fails the gate

A file collected by a declared surface that the gate cannot read, and a directory under a declared surface root
that the gate cannot list, SHALL each cause the gate to exit non-zero, naming the path and the underlying error.
Such an error SHALL be reported before any other structural finding, so that a surface left empty by unreadable
files is never reported only as a vacuous surface. Such a file SHALL NOT be counted in the reported scan total or per-surface
breakdown: the reported count SHALL be the number of files the gate actually examined. The same SHALL hold for a
file reached through the import-graph walk from a scanned surface file, whose unreadability means the walk was
incomplete and therefore proves nothing.

#### Scenario: A scanned file cannot be read

- **WHEN** a file under a declared surface root exists but cannot be read (for example, its mode denies read
  access, or it is a directory entry that reads as `EISDIR`)
- **THEN** the gate exits non-zero
- **AND** the message names the file and the read error
- **AND** no success line reporting that file as scanned is printed

#### Scenario: A directory cannot be listed

- **WHEN** a directory beneath a declared surface root cannot be listed
- **THEN** the gate exits non-zero naming that directory and the error, rather than silently scanning none of the
  files beneath it

#### Scenario: Every file of a surface is unreadable

- **WHEN** all of a surface's collected files are unreadable
- **THEN** the failure message names those files and their read errors, and is not reduced to a bare
  vacuous-surface report

#### Scenario: A credential hidden behind an unreadable file is not reported green

- **WHEN** a credential-shaped literal is planted on a scanned surface in a file the gate cannot read
- **THEN** the gate exits non-zero rather than reporting a passing scan whose count includes that file

### Requirement: The entry guard fails closed

When this module is the process entry point, the gate SHALL either run its full CLI body or exit non-zero with a
diagnostic. It SHALL NOT be possible for the module to be the process entry, produce no output, and exit zero. The
determination that the module was the process entry SHALL be made independently of the comparison being guarded, so
that a defect in that comparison is detected rather than masked by it.

#### Scenario: The entry comparison is false while the module is the process entry

- **WHEN** the guard's comparison evaluates false even though this module is the process entry
- **THEN** the process exits non-zero with a message stating the CLI body never ran
- **AND** it does not exit zero silently

#### Scenario: The module is imported rather than executed

- **WHEN** another module imports this one for its exported helpers
- **THEN** no scan runs, nothing is printed, and the import does not fail
