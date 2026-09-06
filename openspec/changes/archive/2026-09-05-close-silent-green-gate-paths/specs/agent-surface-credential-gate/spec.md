## ADDED Requirements

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

## MODIFIED Requirements

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
