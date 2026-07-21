# concertino-worktree-safety Specification

## Purpose
Guarantees a Concertino review agent (evaluator/skeptic) cannot destroy a live worktree via the Phase-4 teardown script, and that canonical-script fixes propagate to consuming repos through `concertino sync`.
## Requirements
### Requirement: Teardown script refuses to run without an explicit Phase-4 opt-in

The canonical `cleanup.sh` teardown script SHALL NOT perform its destructive steps
(stopping dev servers, `git worktree remove --force`, `git worktree prune`) unless an
explicit Phase-4 opt-in is supplied — either a `--phase4` flag as the first argument
or a `CONCERTINO_PHASE4=1` environment sentinel. When the opt-in is absent, the script
SHALL make no filesystem or git changes and SHALL exit without error (a safe no-op),
emitting a message to stderr explaining that it is a Phase-4-only teardown.

#### Scenario: Stray mid-review invocation is a harmless no-op

- **WHEN** an agent runs `cleanup.sh <WORKTREE_PATH> <DEV_PORT> <BACKEND_PORT>` without
  the `--phase4` flag or `CONCERTINO_PHASE4=1`
- **THEN** the script removes no worktree, prunes nothing, kills no server, prints a
  refusal to stderr, and exits 0

#### Scenario: Phase-4 orchestrator invocation performs teardown

- **WHEN** the orchestrator runs `cleanup.sh --phase4 <WORKTREE_PATH> <DEV_PORT> <BACKEND_PORT>`
- **THEN** the script stops the dev servers on those ports, removes the worktree, prunes,
  and prints `READY cleaned worktree=<WORKTREE_PATH>`

### Requirement: Review agents are prohibited from invoking the teardown script

The rendered evaluator and skeptic agent definitions SHALL explicitly prohibit invoking
`cleanup.sh`, stating that teardown is a Phase-4 orchestrator-only step whose mid-review
execution destroys the live worktree.

#### Scenario: Evaluator and skeptic definitions carry the prohibition

- **WHEN** the concertino agent definitions are rendered for a consuming repo
- **THEN** both the evaluator and skeptic definitions contain a guardrail forbidding any
  invocation of `cleanup.sh` during review

### Requirement: Canonical script fixes propagate through sync

`concertino sync` SHALL refresh the canonical `scripts/concertino/*.sh` scripts in the
consuming repo (not only at `init`), so that a fix to a source script template reaches
the consuming repo via the mandated sync mechanism.

#### Scenario: Sync refreshes canonical scripts

- **WHEN** a source script template changes and `concertino sync` is run against a
  consuming repo
- **THEN** the consuming repo's `scripts/concertino/` copy of that script reflects the
  change

