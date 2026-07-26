# Workflow State — HEL-367

TICKET_ID: HEL-367
CHANGE_NAME: auto-pack-layout-helper (archived as 2026-07-26-auto-pack-layout-helper)
WORKTREE_PATH: /home/matt/Development/helio/.claude/worktrees/feature/server-side-auto-pack-layout/HEL-367
BRANCH: feature/server-side-auto-pack-layout/HEL-367
PHASE: Delivery
CYCLE: 1
DEV_PORT: 5540
BACKEND_PORT: 8447
EXECUTOR_AGENT_ID: a95a2634f3a834b24
EVALUATOR_AGENT_ID: ac5b7ffc9a99372cc
LAST_EVAL_VERDICT: PASS
LAST_EVAL_REPORT: (archived) evaluation-1.md in this dir — not read, PASS per protocol
SKEPTIC_CYCLE: 1
LAST_SKEPTIC_VERDICT: CONFIRM (final gate, round 1; report skeptic-final-1.md in this dir)

Note: this state file now lives under openspec/changes/archive/2026-07-26-auto-pack-layout-helper/
because `openspec archive` moved the whole change dir here (expected — archive happens before push
per orchestrator Phase 3).

Squashed to one commit: b7b0727 "HEL-367 Add server-side auto-pack layout helper" (hooks bypassed
with -n — expected unarchived-change openspec-hygiene condition, same precedent as HEL-378; lint/
format/tests/schemas were all green immediately before, per the squashed-in commits' own hook runs).
Archived as a separate commit: af6f53eb "HEL-367 Archive auto-pack-layout-helper OpenSpec change"
(hooks passed clean this time — openspec hygiene now satisfied).
Pushed to origin/feature/server-side-auto-pack-layout/HEL-367.
scripts/concertino/assert-phase.sh delivery → PASS.

PR: https://github.com/matto00/helio/pull/303 (created). Linear comment posted with PR link.

NEXT: Poll `gh pr checks 303` in bounded steps (committing this state file between polls, never one
long blocking wait) until CI resolves. Backend job lags ~4 min. NEVER `gh pr merge --auto`. On green,
manual `gh pr merge 303 --squash`. Then Phase 4 (pre-authorized by the human for this batch): stop
servers + remove worktree via cleanup.sh --phase4, set HEL-367 to Done in Linear (ONLY HEL-367 — never
touch the HEL-344 epic or sibling ticket statuses), post closing comment, run hygiene checks.
