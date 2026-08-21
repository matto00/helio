# Workflow State — HEL-683

TICKET_ID: HEL-683
TICKET_TYPE: feature
CHANGE_NAME: close-type-check-gate
PHASE: Evaluation
CYCLE: 1
SKEPTIC_CYCLE: 1
DESIGN_GATE_ROUND: 4

BRANCH: task/close-typecheck-gate-gap/HEL-683
WORKTREE_PATH: /home/matt/Development/helio/.claude/worktrees/task/close-typecheck-gate-gap/HEL-683
DEV_PORT: 6115
BACKEND_PORT: 9022
BASE_COMMIT: 8432f280

AGENT_MERGE: true
SPEED: default
EXECUTION_CYCLES: 3
SKEPTIC_DESIGN_ROUNDS: 5
SKEPTIC_FINAL_ROUNDS: 2
DEBUG_ATTEMPTS: 2
SECOND_FINAL_GATE_SKEPTIC: false
EVALUATOR_CLEAN_WORKTREE: false
HARNESS: claude-code

# Models: setup-worktree.sh resolved all-sonnet; the operator override below is
# authoritative and MUST be passed per-spawn on every Agent call.
MODELS: {"orchestrator":"opus","executor":"sonnet","evaluator":"opus","skeptic":"opus","auditor":"sonnet"}

DESIGN_QUESTIONS: null
PENDING_ESCALATION: null

EXECUTOR_AGENT_ID: null
EVALUATOR_AGENT_ID: null

## Planning findings (measured, base 8432f280)
- `npx tsc --noEmit -p frontend` exits 0 today: AC 1 already satisfied by prior work.
- At 12fae281 (ticket-filing tip) the same command exited 2 with 60 error lines
  (58 toastListeners.ts, 1 listenerMiddleware.ts, 1 config/env.ts).
- Errors already gone at d7815d15; fixed incidentally within 12fae281..d7815d15.
- Gate gap confirmed: neither .husky/pre-commit nor ci.yml frontend job runs tsc.
- tsc runtime measured 5s x3. Including vite.config.ts/pwa-assets.config.ts measured clean.
- Remaining deliverable is the gate + red-before-green proof.

## DELIVERY_OBLIGATIONS (Phase 3 — durable; survives compaction)
<!-- Deliberate exception to workflow-state.template.md's "ids/paths/counters, never prose
     procedure" rule — see design.md D5. Do not tidy this away. -->
- [ ] After `gh pr create`, WAIT for CI to complete, then confirm the new gate step actually
      executed in the frontend job:
        gh run view --job <frontend job id> --log | grep -F "npm run typecheck"
      (or `gh pr checks`). The orchestrator does NOT poll CI by default — `check-merge-readiness.sh`
      is the auditor's, and only checks overall SUCCESS, never that a NAMED step ran.
- [ ] APPEND the result to the PR body. NOTE: `gh pr edit --body` REPLACES the body (gh 2.97 has
      no append flag), and the body holds this change's honesty disclosures — so read-modify-write:
        gh pr view <n> --json body -q .body > /tmp/body.md
        printf '\n\n## CI confirmation\n<result>\n' >> /tmp/body.md
        gh pr edit <n> --body-file /tmp/body.md
      Ticking a box here is NOT the deliverable; the appended PR body is the durable record (these
      ticks land on the archived copy after the archive commit and die with the worktree).
- [ ] NOTE for a resumed/compacted run: after Phase 3 step 2 this file lives at
      openspec/changes/archive/<date>-close-type-check-gate/workflow-state.md, not the pre-archive
      path the orchestrator's recovery instruction names.
- [ ] Assumes CI actually triggers: ci.yml has paths-ignore for "**.md", so a docs-only PR runs no
      CI at all. This change touches package.json/tsconfig.json/.husky/ci.yml, so it does trigger.
- [ ] State plainly in the PR that CI *redness* was never observed (only inferred from the
      mechanical YAML assertions + the observed local red of the identical command).

## Operator constraints (this run)
- CON-128: NEVER run `concertino sync`, for any reason. Not to be recorded as owed.
- CON-129: merge `origin/main` into this branch BEFORE the evaluation gates, not at Delivery.
- AGENT_MERGE resolved true, but check-agent-merge-permission.sh FAILS
  (missing `Bash(gh pr merge:*)` and `Task(concertino-auditor)`). Operator pre-authorized the
  fallback path: present the PR, state agent-merge was permission-blocked, do NOT burn an
  escalation cycle, wait for the operator's "merged".
- Design-gate budget is 5 rounds; on exhaustion STOP and escalate. Never self-authorize a 6th.

## Concurrency fences
- HEL-775 live in its own worktree; owns openspec/specs/ and may edit
  scripts/check-openspec-hygiene.mjs. Do not touch either. Archive with --skip-specs.
- Do not touch .claude/worktrees/task/setup-concertino-codex.
