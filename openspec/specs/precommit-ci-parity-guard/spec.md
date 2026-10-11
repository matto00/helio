# precommit-ci-parity-guard Specification

## Purpose
Guarantees that every check the pre-commit hook runs is also run by CI on a merge-gating job, reading the workflow as
parsed YAML so YAML comments and string content outside a step's `run` can never stand in for structure.

## Requirements

### Requirement: Parity reads ci.yml as parsed YAML
The pre-commit/CI parity check SHALL take `ci-complete`'s `needs` and each job's commands from a YAML parse of
`.github/workflows/ci.yml`: `needs` from the parsed `ci-complete` mapping and commands only from the `run` strings of a
job's parsed `steps` list. YAML comments and YAML string content outside a step's `run` SHALL never count as a `needs` list or as a command.

#### Scenario: Comment decoy above the real needs
- **WHEN** a comment in `ci-complete` lists every job in `needs: [...]` form and the real `needs` omits the job that
  runs the hook's checks
- **THEN** the parity check exits non-zero naming the hook scripts that are no longer covered

#### Scenario: Command named only in a comment
- **WHEN** a hook script's `npm run` invocation appears in a needed job only inside a comment
- **THEN** that script is not counted as covered

### Requirement: Parity fails closed on unreadable topology
The parity check SHALL exit non-zero, rather than treat the covered set as empty or scan the whole file, when ci.yml does
not parse (including a duplicate key), has no `jobs` mapping, has no `ci-complete` job, or when `ci-complete`'s `needs`
is missing, not a list, contains a non-bare-id entry, or names an undefined job, or when a scanned job's `steps` is
neither absent/null nor a list (an empty `steps:` parses as null and contributes no commands).

#### Scenario: Unparseable workflow
- **WHEN** ci.yml is not valid YAML
- **THEN** the parity check exits non-zero with a parse error

#### Scenario: Scalar needs
- **WHEN** `ci-complete`'s `needs` is a scalar
- **THEN** the parity check exits non-zero

### Requirement: ci-complete's own steps count as merge-gating
The parity check SHALL scan the jobs in `ci-complete`'s `needs` and the `ci-complete` job itself.

#### Scenario: Hook script run only in ci-complete
- **WHEN** a hook script is run by a step of `ci-complete` and by no needed job
- **THEN** it is counted as covered
