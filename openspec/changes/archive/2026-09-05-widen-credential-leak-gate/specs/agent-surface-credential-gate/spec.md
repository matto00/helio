## Purpose

Defines the commit-time credential-leak gate's declared scan surfaces, the checks that apply to each, and the
failure behaviors that keep a green result from ever meaning "nothing was examined".

## ADDED Requirements

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

Each surface, check, and structural guard introduced or newly applied by this change SHALL have a corresponding
self-test case that plants a violating condition, asserts the gate exits non-zero, removes it, and asserts the gate
exits zero. Planted values SHALL be obviously synthetic. This requirement is scoped to new coverage: the
pre-existing assistant-surface import-graph and credential-property checks carry no self-test case and are not
brought into scope here.

#### Scenario: The self-test proves the MCP surface is genuinely scanned

- **WHEN** the self-test runs
- **THEN** it plants a credential-shaped literal under `helio-mcp/`, observes a non-zero exit, removes the planted
  file, and observes a zero exit
- **AND** it removes the planted file even when an assertion fails
