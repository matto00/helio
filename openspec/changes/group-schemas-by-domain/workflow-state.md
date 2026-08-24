# Workflow State — HEL-636

TICKET_ID: HEL-636
BRANCH: task/group-schemas-by-domain/HEL-636
WORKTREE_PATH: /home/matt/Development/helio/.claude/worktrees/task/group-schemas-by-domain/HEL-636
DEV_PORT: 6068
BACKEND_PORT: 8975
PHASE: Delivery
CYCLE: 1
SKEPTIC_CYCLE: 0
AGENT_MERGE: true
TICKET_TYPE: feature
DESIGN_QUESTIONS: null
SPEED: default
EXECUTION_CYCLES: 3
SKEPTIC_DESIGN_ROUNDS: 5
SKEPTIC_FINAL_ROUNDS: 2
DEBUG_ATTEMPTS: 2
MODELS: {"orchestrator":"sonnet","executor":"sonnet","evaluator":"sonnet","skeptic":"opus","auditor":"sonnet"}
SECOND_FINAL_GATE_SKEPTIC: false
EVALUATOR_CLEAN_WORKTREE: false
PREMISE_VALIDATION: material-drift (see .concertino/runs/HEL-636/evidence/premise-validation.md); escalation answered proceed-with-restated-scope
NOTES: MODELS.skeptic manually overridden to opus per user instruction (setup-worktree.sh default resolved skeptic=sonnet for this speed/harness). Restated scope: re-enumerate schemas/ from live tree (76 files), use ticket's 8 domain names as starting vocabulary, extend for ~34 unlisted schemas. Second part: move orchestration-flow.html + development-plan.md out of repo root.
