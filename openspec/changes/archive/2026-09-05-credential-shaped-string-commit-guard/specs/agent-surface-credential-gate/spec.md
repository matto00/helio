## MODIFIED Requirements

### Requirement: Declared scan surfaces

The gate SHALL derive every file it scans from a single, in-script surface table. Each surface SHALL declare an
identifier, a root directory relative to the repository root, the file-inclusion rule for that root, and the set of
checks that apply to it. The table SHALL be the sole source of truth for the gate's coverage; no check may scan a
path that no surface declares. The declared surfaces SHALL include the trees into which delivery agents write
evidence, planning artifacts and notes, so that a credential minted for live verification cannot be committed into
a transcript without failing the gate.

#### Scenario: The MCP client surface is scanned

- **WHEN** the gate runs against the repository
- **THEN** files under `helio-mcp/` (excluding `node_modules/` and `dist/`) are among the files it scans
- **AND** the success line reports a per-surface file count that includes that surface by name

#### Scenario: The delivery-evidence surfaces are scanned

- **WHEN** the gate runs against the repository
- **THEN** files under the planning-artifact, documentation and notes trees are among the files it scans
- **AND** each is reported by name with its own file count in the per-surface breakdown
- **AND** each is classified as covered by the coverage-drift guard rather than acknowledged-unscanned

#### Scenario: Coverage is reported, not asserted in prose

- **WHEN** the gate completes without violations
- **THEN** it prints the total number of files scanned and a per-surface breakdown, so the number is checkable
  against the surface table

### Requirement: False positives are resolved by convention

Legitimate synthetic values SHALL be accepted on the basis of stated, followable conventions rather than
per-value allowlist entries. Placeholder email domains SHALL be the reserved domains (`example.com`, `example.org`,
`example.net`, `example.invalid`, and any `.test` domain). A credential-shaped literal SHALL be accepted when it is
empty or carries a documented synthetic marker. Marker matching SHALL normalize word separators, so that a marker
written with underscores is recognized identically to the same marker written with hyphens. No check SHALL be
applied to a surface where it produces a false positive against the already-committed tree; where an existing rule
would require rewriting immutable archived evidence to pass, a narrower rule SHALL be used for that surface
instead.

#### Scenario: A future author adds a test fixture

- **WHEN** an author writes a new placeholder email on a reserved domain, or a credential-shaped literal carrying a
  documented synthetic marker
- **THEN** the gate passes without any edit to the gate script

#### Scenario: A marker written with underscores is recognized

- **WHEN** a credential-shaped literal carries a documented synthetic marker whose words are separated by
  underscores rather than hyphens
- **THEN** the gate passes, without that value being added to any allowlist

#### Scenario: The already-committed tree is clean

- **WHEN** the gate runs against the repository with no planted value
- **THEN** it exits zero, reporting zero violations across every declared surface

#### Scenario: A real-looking value is committed

- **WHEN** an author writes an email on a non-reserved domain, or a credential-shaped literal with no synthetic
  marker, on a scanned surface
- **THEN** the gate exits non-zero

## ADDED Requirements

### Requirement: Credential-shape detection on the delivery-evidence surfaces

The gate SHALL fail when a file on a delivery-evidence surface contains a credential-shaped string: a
vendor-prefixed value whose prefix is followed by a credential-length run of token characters, or a high-entropy
value of at least thirty-two characters drawn from the base64/hexadecimal alphabet that is assigned to an
identifier whose name ends in `KEY`, `SECRET`, `TOKEN` or `PASSWORD`. The failure message SHALL name the file and
line, and SHALL state the synthetic-marker convention by which a legitimate fixture value is exempted.

#### Scenario: A minted token is committed into an evidence transcript

- **WHEN** an evidence file records a vendor-prefixed credential of credential length
- **THEN** the gate exits non-zero, naming the file and line

#### Scenario: A base64 key blob is committed into an evidence transcript

- **WHEN** an evidence file assigns a thirty-two-character-or-longer base64 value to an identifier ending in `KEY`,
  `SECRET`, `TOKEN` or `PASSWORD`
- **THEN** the gate exits non-zero, naming the file and line

#### Scenario: Placeholders, prose and elided forms are not violations

- **WHEN** an evidence, documentation or planning file mentions the token prefix in prose, documents a
  repeated-character or elided placeholder, or quotes a fixture value carrying a synthetic marker
- **THEN** the gate passes, without any edit to the gate script and without rewriting the file

#### Scenario: Short low-entropy prose values are not violations

- **WHEN** a committed planning or evidence file contains a short, human-readable value assigned to a
  credential-named identifier — a binding key, a passphrase written as prose, or a documentation placeholder
- **THEN** the gate passes, because the high-entropy rule structurally excludes it rather than allowlisting it

### Requirement: The gate is enforced where it cannot be skipped

The gate and its self-test SHALL run as merge-blocking continuous-integration steps, in addition to any local
pre-commit hook. A local hook alone SHALL NOT be treated as sufficient enforcement, because the hook chain is
bypassable and because the repository's hook-invoked test step is vacuous inside the linked worktrees where
delivery runs execute.

#### Scenario: A commit bypasses the local hook

- **WHEN** a change carrying a credential-shaped string is committed with the pre-commit hook bypassed and pushed
  as a pull request
- **THEN** the continuous-integration run fails, blocking the merge

#### Scenario: The self-test is enforced alongside the gate

- **WHEN** continuous integration runs
- **THEN** it runs both the gate and the gate's self-test, so a gate silently degraded into examining nothing is
  caught by the same merge-blocking run

### Requirement: Minted verification credentials are redacted and revoked

The repository's contributor documentation SHALL state that any credential, token or secret minted to drive live
verification is redacted from the transcript before that transcript is committed, and revoked when the run ends.
That rule SHALL live in a durable, tracked location that is not a render target of an external tool, so that it
cannot be silently erased by a regeneration step.

#### Scenario: An agent looks for the rule before committing evidence

- **WHEN** a contributor or delivery agent reads the repository's contributing guidance
- **THEN** the redact-and-revoke rule is present there, stating both the redaction obligation and the revocation
  obligation

#### Scenario: A review report quotes a credential-shaped value

- **WHEN** an evidence, review or archived transcript file on a delivery-evidence surface needs to record that a
  credential-shaped value was observed
- **THEN** the documentation states that the value must be elided or carry a documented synthetic marker, and that
  the gate's own failure output is safe to quote verbatim because it names only the file and line and never echoes
  the matched value

#### Scenario: The rule survives a tool regeneration

- **WHEN** the external orchestration tool regenerates its rendered agent and script directories
- **THEN** the rule is unaffected, because it is not stored in a rendered directory
