# Workflow State — HEL-462

TICKET_ID: HEL-462
CHANGE_NAME: pipeline-schema-drift-detection
WORKTREE_PATH: /home/matt/Development/helio/.claude/worktrees/feature/pipeline-schema-drift-detection/HEL-462
BRANCH: feature/pipeline-schema-drift-detection/HEL-462
PHASE: Execution
CYCLE: 1
DEV_PORT: 5894
BACKEND_PORT: 8801
EXECUTOR_AGENT_ID: —
EVALUATOR_AGENT_ID: —
LAST_EVAL_VERDICT: —
LAST_EVAL_REPORT: —
SKEPTIC_CYCLE: 0
LAST_SKEPTIC_VERDICT: —
AGENT_MERGE: false
TICKET_TYPE: feature
DESIGN_QUESTIONS: null
SPEED: default
EXECUTION_CYCLES: 3
SKEPTIC_DESIGN_ROUNDS: 3
SKEPTIC_FINAL_ROUNDS: 2
DEBUG_ATTEMPTS: 2
MODELS: {"orchestrator":"sonnet","executor":"sonnet","evaluator":"sonnet","skeptic":"sonnet","auditor":"sonnet"}
SECOND_FINAL_GATE_SKEPTIC: false
EVALUATOR_CLEAN_WORKTREE: false
PENDING_ESCALATION: null

# Run-specific notes (facts, not procedure):
# - Next available Flyway migration at branch time: V85 (both HEAD 6612e291 and
#   origin/main top out at V84__pipeline_run_assertions.sql). Ticket's "V59" is stale.
# - Migration-collision hazard: parallel deliveries in this repo have collided on
#   migration numbers before; final-gate skeptic must re-check origin/main for a
#   competing V85 before delivery and renumber if needed.
# - Shared dev Postgres across ALL worktrees (same DATABASE_URL). Any dev server
#   started for live checks MUST use this ticket's ports (5894/8801) via
#   scripts/concertino/start-servers.sh and MUST be stopped before any migration
#   renumber, or it poisons flyway_schema_history for concurrent tickets (HEL-521 incident).
# - Parallel delivery in flight: HEL-339 epic (currently HEL-410, frontend-only).
