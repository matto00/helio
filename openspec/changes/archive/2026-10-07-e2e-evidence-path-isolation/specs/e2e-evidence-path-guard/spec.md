## Purpose

Keeps e2e evidence screenshots inside one gitignored per-worktree directory outside `openspec/`, so running any
committed spec from any lane never creates OpenSpec change directories or depends on the process working directory.

## ADDED Requirements

### Requirement: E2E evidence screenshots resolve to one gitignored per-worktree location

Every e2e spec that saves an evidence screenshot SHALL resolve its path through a single shared helper. The helper
SHALL resolve the path from its own source location (never from the process working directory) to
`<worktree root>/e2e-evidence/<TICKET>/<file>`, SHALL create the directory, and SHALL reject a ticket id or file
name that would escape that directory. The `e2e-evidence/` directory SHALL be gitignored.

#### Scenario: Spec run from a different working directory

- **WHEN** an e2e spec saves an evidence screenshot while the process working directory is not the worktree root
- **THEN** the file lands under that worktree's `e2e-evidence/<TICKET>/`
- **AND** nothing is created under `openspec/changes/` and `git status` stays clean

#### Scenario: Path-escaping input rejected

- **WHEN** the helper is called with a ticket id or file name containing a path separator or `..`
- **THEN** it throws instead of writing

### Requirement: Guard against reintroducing ad-hoc evidence paths

A `check:e2e-evidence-paths` check SHALL scan e2e source files and fail, naming file and line, when a screenshot
call's `path` is not produced by the shared helper, or when a non-comment line references the `openspec/` tree (the substring `openspec/` or a standalone quoted `"openspec"` path segment). A
line carrying an explicit reviewed escape-hatch comment SHALL be exempt. The check SHALL run in pre-commit and in
CI, and SHALL have a selftest that proves each violation shape is caught and the clean shape passes.

#### Scenario: Spec writes a screenshot into a change directory

- **WHEN** an e2e file calls `screenshot({ path: resolve(__dirname, "../openspec/changes/x/screenshots/a.png") })`
- **THEN** the check exits non-zero and names that file and line

#### Scenario: Spec writes a screenshot to a cwd-relative path

- **WHEN** an e2e file calls `screenshot({ path: ".concertino/runs/HEL-1/evidence/a.png" })`
- **THEN** the check exits non-zero and names that file and line

#### Scenario: Spec creates a directory under openspec by path segments

- **WHEN** an e2e file calls `mkdirSync(join(__dirname, "..", "openspec", "changes", "x"))`
- **THEN** the check exits non-zero and names that file and line

#### Scenario: Spec writes a non-screenshot file under openspec

- **WHEN** an e2e file calls `writeFileSync(resolve(__dirname, "../openspec/specs/foo/a.png"), buf)`
- **THEN** the check exits non-zero and names that file and line

#### Scenario: Spec uses the helper

- **WHEN** every screenshot call in e2e passes `path: evidencePath(...)`
- **THEN** the check exits zero
