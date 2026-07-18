# Workflow State — HEL-299

- TICKET_ID: HEL-299
- CHANGE_NAME: fix-run-events-sse-500
- BRANCH: bug/sse-run-events-500/HEL-299
- WORKTREE_PATH: /home/matt/Development/helio/.claude/worktrees/bug/sse-run-events-500/HEL-299
- DEV_PORT: 5472
- BACKEND_PORT: 8379
- PHASE: Execution
- CYCLE: 1
- SKEPTIC_CYCLE: 0
- DESIGN_GATE: CONFIRM (round 1, report skeptic-design-1.md)
- EXECUTOR_AGENT_ID: (not yet spawned)
- EVALUATOR_AGENT_ID: (not yet spawned)

## Session-specific model overrides (user-directed)

- executor: opus
- evaluator: sonnet
- skeptic: sonnet

## Notes

- Serial bug-bash fleet, ticket 4 of 9 (305 done, 298 done, 290 done, then 299 → 307 → 308 → 306 → 270 → 309).
- Probe-first mandate: reproduce the SSE 500 with live backend + stack trace before any fix; widen matrix (pipeline states, session vs PAT, non-superuser RLS, concurrent streams) before any not-reproducible conclusion.
- Operational hygiene: screenshots to scratchpad/gitignored tmp only; no glob bulk-deletes; stay inside this worktree/ports; HEL-290 cleanup may run in parallel.
- `-n` bypass sanctioned only when check:openspec-hygiene is the sole pre-commit failure pre-archive.
