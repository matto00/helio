# Orchestrator procedure scripts

Canonical, deterministic procedures for the Linear ticket-delivery flow
(`linear-orchestrator` / `linear-evaluator` agents). These exist so the agents
**call a script** instead of recalling a multi-step procedure from prose — which
is where hallucination (wrong worktree path, missed `.env` copy, forgotten CORS
flag) creeps in, especially after context compaction.

Part of the "Iron Laws" effort — see `notes/orchestration-iron-laws-handoff.md`.

## Contract

- Each script is idempotent and re-runnable.
- Success prints machine-parseable `READY <key>=<value>` lines on stdout.
- Failure prints `FAIL <reason>` on stderr and exits non-zero.
- `assert-phase.sh` prints `PASS <phase>` / `FAIL <reason>` — it is the
  postcondition gate the orchestrator runs before leaving a phase.

## Scripts

| Script              | Purpose                                                           | Args                                                        |
| ------------------- | ----------------------------------------------------------------- | ----------------------------------------------------------- |
| `setup-worktree.sh` | Create worktree, copy `backend/.env`, derive ports, husky install | `<TICKET_ID> <BRANCH>`                                      |
| `start-servers.sh`  | Start backend (CORS-aware) + frontend, health-wait                | `<WORKTREE_PATH> <DEV_PORT> <BACKEND_PORT>`                 |
| `assert-phase.sh`   | Postcondition gate per phase                                      | `<setup\|servers\|delivery\|cleanup> <WORKTREE_PATH> [...]` |
| `cleanup.sh`        | Stop servers, remove worktree                                     | `<WORKTREE_PATH> <DEV_PORT> <BACKEND_PORT>`                 |

## Ports

Derived from the ticket number so parallel orchestrators never collide:
`DEV_PORT = 5173 + N`, `BACKEND_PORT = 8080 + N` (e.g. `HEL-55` → 5228 / 8135).

## Not (yet) scripted

Delivery (squash, archive, PR) stays in the orchestrator because its commit
messages and PR body are content, not procedure. The mechanical archive steps
are candidates for a future `archive-change.sh`.
