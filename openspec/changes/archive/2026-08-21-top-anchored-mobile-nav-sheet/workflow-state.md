# Workflow State — HEL-773

TICKET_ID: HEL-773
TICKET_TYPE: feature
CHANGE_NAME: top-anchored-mobile-nav-sheet
BRANCH: feature/mobile-nav-sheet-top-anchored/HEL-773
WORKTREE_PATH: /home/matt/Development/helio/.claude/worktrees/feature/mobile-nav-sheet-top-anchored/HEL-773
DEV_PORT: 6205
BACKEND_PORT: 9112
PHASE: Evaluation
CYCLE: 2
SKEPTIC_CYCLE: 2
AGENT_MERGE: true
DESIGN_QUESTIONS: null
PENDING_ESCALATION: null

SPEED: default
EXECUTION_CYCLES: 3
SKEPTIC_DESIGN_ROUNDS: 5
SKEPTIC_FINAL_ROUNDS: 2
DEBUG_ATTEMPTS: 2
SECOND_FINAL_GATE_SKEPTIC: false
EVALUATOR_CLEAN_WORKTREE: false
HARNESS: claude-code

## MODELS (user-mandated override — setup-worktree.sh resolved all-sonnet)
MODELS: {"orchestrator":"opus","executor":"sonnet","evaluator":"opus","skeptic":"opus","auditor":"sonnet"}
NOTE: resolve-speed.sh resolves every role to "sonnet". The per-spawn `model`
parameter is the ONLY thing keeping the evaluator and skeptic gates on opus.
A dropped override downgrades a gate silently. Pass it on EVERY Agent call.

## Fences (other live runs)
- HEL-554 is live: do not touch features/onboarding/, the zero-dashboard surface,
  or the Getting-started affordance. Do not edit the HEL-548 create-action hooks.
- Do not touch .claude/worktrees/task/setup-concertino-codex.
- Do NOT use MCP Playwright (shared single instance). Own headless Chromium at
  ~/.cache/ms-playwright/chromium-1208.

## Folded-in scope
HEL-782 (bounded subset only) — see ticket.md AC8/AC9 and design.md D11 + D14.

## Design gate history
Rounds 1-4 REFUTE (20 change requests, all accepted and applied); round 5 CONFIRM.
Rounds 3, 4 and 5 each independently upheld D2 (the scrim decision) on the merits.
Design gate CLEARED at round 5 of 5.

## Agent IDs
executor: (not yet spawned)
evaluator: (not yet spawned)

## OWED AT DELIVERY (do not let these evaporate)
1. PR body MUST propose splitting `MobileNavSheet.tsx` (427 lines, past CONTRIBUTING's ~400
   threshold — grew from 411 in cycle 2). File a follow-up ticket for the split itself.
   Precedent: PR #409 shipped App.css at 520 lines unrecorded today -> HEL-780 filed in hindsight.
   Do not repeat that miss.
2. DONE — spinoffs filed: HEL-787 (file split), HEL-788 (phone rename gap),
   HEL-789 (metrics/assistant create gap), HEL-790 (inert bar taps swallowed),
   plus a comment on HEL-565 (no exit animation + no gestural feedback).
   Original list:
   (a) phone users cannot rename a quick-created "Untitled dashboard" (rename lives only in the
       sidebar per-row menu, sidebar is display:none below 768px);
   (b) metrics + assistant have no sheet create action while desktop siblings do; chat's lives in
       the command bar (HEL-746) one tap away;
   (c) HEL-565 note: inverted drag has neither gestural feedback nor an exit animation.
3. HEL-782 DECISION: ABSORBED into this ticket (ticket.md AC8/AC9, design.md D11). Tell the user
   so they can close it as merged. Bounded subset only — no new hook, no new modal mount.
4. PR body MUST record: the evaluator reproduced red-before-green by building a scratch copy of
   frontend/ OUTSIDE the worktree, swapping in the pre-fix component, and confirming exactly one
   test went red for the right reason. Also: reopen #2 appearing to work in cycle 1 was itself a
   symptom of the flag being cleared by the failed reopen — the bug masked itself.
5. Re-check CON-129 (origin/main drift) immediately before Delivery squash.
6. Agent-merge blocked on permissions -> present PR, stop, user merges.
7. Phase 4: verify branch deletion AND main fast-forward MYSELF (cleanup.sh failed both today).
