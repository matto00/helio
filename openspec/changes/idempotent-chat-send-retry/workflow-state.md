# Workflow State — HEL-698

PHASE: Execution
TICKET_ID: HEL-698
TICKET_TYPE: feature
CHANGE_NAME: idempotent-chat-send-retry
BRANCH: bug/chat-send-idempotent-retry/HEL-698
WORKTREE_PATH: /home/matt/Development/helio/.claude/worktrees/bug/chat-send-idempotent-retry/HEL-698
DEV_PORT: 6130
BACKEND_PORT: 9037
AGENT_MERGE: false
DESIGN_QUESTIONS: null

SPEED: default
EXECUTION_CYCLES: 3
SKEPTIC_DESIGN_ROUNDS: 3
SKEPTIC_FINAL_ROUNDS: 2
DEBUG_ATTEMPTS: 2
MODELS: {"orchestrator":"sonnet","executor":"sonnet","evaluator":"sonnet","skeptic":"sonnet","auditor":"sonnet"}
SECOND_FINAL_GATE_SKEPTIC: false
EVALUATOR_CLEAN_WORKTREE: false
HARNESS: claude-code

CYCLE: 1
SKEPTIC_CYCLE: 0
SKEPTIC_DESIGN_ROUND: 2 (round 1 REFUTE — both change requests applied; round 2 CONFIRM)
EXECUTOR_AGENT_ID: null
EVALUATOR_AGENT_ID: null
PENDING_ESCALATION: null

## Notes

- Concurrent orchestrator threads: HEL-693 (ports 6125/9032) — ports here (6130/9037) do not collide.
- Shared local dev Postgres across worktrees: if a new Flyway migration is needed, check current highest V-number on main first and report collision risk.
- Parent session ("main") monitoring; report Planning-complete summary + escalations via SendMessage to "main".
