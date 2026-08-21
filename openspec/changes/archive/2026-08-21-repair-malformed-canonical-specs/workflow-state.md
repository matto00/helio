# Workflow State — HEL-775

TICKET_ID: HEL-775
CHANGE_NAME: repair-malformed-canonical-specs
TICKET_TYPE: feature
PHASE: Evaluation
CYCLE: 1
SKEPTIC_DESIGN_ROUND: 3 of 5 = CONFIRM (rounds 1-2 REFUTE). Design gate CLEARED.
SKEPTIC_CYCLE: 1
BRANCH: task/repair-malformed-canonical-specs/hel-775
WORKTREE_PATH: /home/matt/Development/helio/.claude/worktrees/task/repair-malformed-canonical-specs/hel-775
DEV_PORT: 6207
BACKEND_PORT: 9114
BASE_SHA: 8432f280  # re-merged mid-gate; main advanced twice (HEL-773, HEL-554/#413). Corpus N=317.
AGENT_MERGE: true
DESIGN_QUESTIONS: null
PENDING_ESCALATION: null
RESOLVED_ESCALATION:
  question: schema-inference scenario-less requirement blocks archive once repaired
  answer: add-minimal-scenario (human, directly in chat, after reading all four options)
  channel: chat fallback; --await returned non-zero (timeout) and was correctly NOT treated as approval
  applied: design.md decision 3a + Non-Goals, proposal.md Non-goals, tasks.md section 10

SPEED: default
EXECUTION_CYCLES: 3
SKEPTIC_DESIGN_ROUNDS: 5
SKEPTIC_FINAL_ROUNDS: 2
DEBUG_ATTEMPTS: 2
SECOND_FINAL_GATE_SKEPTIC: false
EVALUATOR_CLEAN_WORKTREE: false
HARNESS: claude-code

MODELS: {"orchestrator":"opus","executor":"sonnet","evaluator":"opus","skeptic":"opus","auditor":"sonnet"}
# NOTE: setup-worktree.sh resolved all-sonnet. The per-spawn `model` override is the ONLY
# thing keeping evaluator/skeptic on opus. Every Agent call MUST pass it explicitly,
# including re-spawns. A dropped override downgrades a gate silently, with no error.

AGENT_IDS: {"executor":"warm (cycle 1)","evaluator":"warm (cycle 1)"}
EXEC_COMMIT: a8234482
EVAL_CYCLE_1: PASS (evaluation-1.md)

## Notes
- Merged origin/main (785e0af9, incl. HEL-773) at TOP of Planning, before reading any spec for
  enumeration, per coordinator correction: this ticket rewrites spec files, so a stale-base overwrite
  would be indistinguishable from intended repair work. Verified mobile-dashboard-sheet carries
  HEL-773 content and is byte-identical to origin/main.
- Enumeration is pinned to 785e0af9: 26 malformed files in 4 classes (21 carry the stray heading,
  reconciling with HEL-548's refined 21/19; 5 were unreported by either prior run).
- PROVEN by real archive: bare heading rename is INSUFFICIENT (aborts on missing Purpose).
  ADDED-only deltas also abort, contradicting the ticket.
- openspec v1.2.0 CLI: `openspec validate <name> --type change`, NOT `--change`.
- Fence: touch nothing in openspec/changes/ except this change dir. HEL-554 live elsewhere.
- ENV (found by skeptic): the WORKTREE's scripts/concertino/ has only 4 scripts. emit-event.sh,
  persist-evidence.sh and next-report-number.sh are untracked and exist ONLY in the main checkout at
  /home/matt/Development/helio/scripts/concertino/. Invoke them by ABSOLUTE main-checkout path or
  agents hit exit 127.
- Design gate round 3 = CONFIRM. Skeptic executed the plan literally against a sandbox: 317 passed /
  0 failed, exactly ONE differing requirement block corpus-wide (the approved exception), real archive
  succeeds for MODIFIED vs Class A and REMOVED vs Class B, guard fails red on all 5 fixtures + a
  duplicate-name fixture and passes a well-formed control. 9 non-blocking notes applied.
- Design gate round 2 = REFUTE (4 blocking, all verification-wording; NO round-1 item survived, so no
  escalation trigger). Applied: byte-stable blank-line deletion in 3.3, unambiguous block boundary
  /^(##|###)\s/ with scenarios INSIDE, 6.2 exception carve-out, corpus size derived as N not literal.
- Design gate round 1 = REFUTE, 5 blocking findings, all reproduced twice. CR2/3/4/5 + all
  non-blocking notes applied to artifacts. CR1 blocked on human decision (see PENDING_ESCALATION).
- openspec archive EXITS 0 EVEN WHEN IT ABORTS. Never trust its exit code; assert on stdout.
