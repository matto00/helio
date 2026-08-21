# Workflow State — HEL-548

TICKET_ID: HEL-548
CHANGE_NAME: empty-state-ctas-primary-sections
WORKTREE_PATH: /home/matt/Development/helio/.claude/worktrees/feature/empty-state-ctas-primary-sections/hel-548
BRANCH: feature/empty-state-ctas-primary-sections/hel-548
PHASE: Delivery
CYCLE: 2
DEV_PORT: 5980
BACKEND_PORT: 8887
EXECUTOR_AGENT_ID: concertino-executor (cycle 1, sonnet)
EVALUATOR_AGENT_ID: concertino-evaluator (cycle 1, opus)
LAST_EVAL_VERDICT: PASS
LAST_EVAL_REPORT: openspec/changes/empty-state-ctas-primary-sections/evaluation-1.md
SKEPTIC_CYCLE: 2 (final gate round 2 of 2)
LAST_SKEPTIC_VERDICT: CONFIRM (final gate round 2)
AGENT_MERGE: true
TICKET_TYPE: feature
DESIGN_QUESTIONS: null
SPEED: default
EXECUTION_CYCLES: 3
SKEPTIC_DESIGN_ROUNDS: 5
SKEPTIC_FINAL_ROUNDS: 2
DEBUG_ATTEMPTS: 2
# NOTE: setup-worktree.sh resolved all-sonnet. The user's launch brief OVERRIDES
# that: evaluator and skeptic run on opus. Every Agent spawn/re-spawn MUST pass
# `model` explicitly — a dropped override silently downgrades a gate with no error.
MODELS: {"orchestrator":"opus","executor":"sonnet","evaluator":"opus","skeptic":"opus","auditor":"sonnet"}
SECOND_FINAL_GATE_SKEPTIC: false
EVALUATOR_CLEAN_WORKTREE: false
PENDING_ESCALATION: null

# Run-specific notes (see ticket.md for full detail)
# - HEL-770 ABSORBED into this change (same PanelList branch, same primitive).
# - HEL-528 D11 terminal-idle PanelList gap is owned here; must not re-create the
#   cold-boot flash (do NOT widen the skeleton gate to idle).
# - Parallel runs: HEL-772 (ports 6204/9111), HEL-774. Never touch their worktrees.
#   DESIGN.md is READ-ONLY this session (HEL-774 owns it).
# - MCP Playwright is shared/single-instance: evaluator+skeptic must launch their OWN
#   headless Chromium at ~/.cache/ms-playwright/chromium-1208.
# - agent-merge expected to fail on permissions; present PR and stop.
# - MID-RUN REQUIREMENT (coordinator, during cycle 1 execution):
#   If `git commit -n` is used, the commit body MUST enumerate EVERY gate the
#   bypass actually skips, established by running each hook individually.
#   Only check:openspec's HEL-657 false positive is pre-approved; anything else
#   failing is a real defect to fix, not bypass. `npm run format:check` runs
#   REPO-WIDE. Evaluator MUST verify the disclosure by RE-RUNNING the hooks,
#   not by reading the executor's claim (a sibling run's disclosure was false).
#   Also: never cite a DESIGN.md section/rule/exception without confirming it
#   exists; DESIGN.md is read-only this session (HEL-774 owns it).
