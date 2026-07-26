# Workflow State — HEL-369

TICKET_ID: HEL-369
CHANGE_NAME: scoped-token-external-trigger
WORKTREE_PATH: /home/matt/Development/helio/.claude/worktrees/feature/external-trigger-scoped-tokens/HEL-369
BRANCH: feature/external-trigger-scoped-tokens/HEL-369
PHASE: Execution
CYCLE: 1
DEV_PORT: 5542
BACKEND_PORT: 8449
EXECUTOR_AGENT_ID: ad38da1139ff58268
EVALUATOR_AGENT_ID: a4a24395efff39a33 (DIED, infra failure, not counted against cycle budget) ->
RE-SPAWNED FRESH as aed6a255d083f520a -> PASSED cycle 1.
LAST_EVAL_VERDICT: PASS (cycle 1)
LAST_EVAL_REPORT: openspec/changes/scoped-token-external-trigger/evaluation-1.md (PASS report —
per workflow rules, NOT read by the orchestrator; only non-blocking notes)
SKEPTIC_CYCLE: 2 (design gate). FINAL GATE N=1 attempt 1 = agent a5aa4ff8b79173e55 DIED (infra
failure, stalled 600s watchdog, no report produced — confirmed via task-notification status:failed
+ independently verified stale backend/target/source mtimes, no PR open). Not counted against the
2-round final-gate REFUTE budget. FINAL GATE N=1 attempt 2 = agent a569194a8f40ef723 -> CONFIRM. Report:
openspec/changes/scoped-token-external-trigger/skeptic-final-1.md
LAST_SKEPTIC_VERDICT: FINAL GATE CONFIRM (N=1, attempt 2) — proceeding to Delivery.

## Delivery checklist (track precisely — stall recovery)
- [x] Design gate CONFIRM (round 2)
- [x] Evaluator PASS (cycle 1)
- [x] Final gate CONFIRM (N=1)
- [x] Fixed non-blocking spec wording nit (external-run-hooks "audit" requirement now correctly
      hedges token-id audit to scoped tokens only; added the unscoped-PAT-omits-token-id scenario)
- [ ] Squash all branch commits into one (HEL-369 <description>, Co-Authored-By trailer)
- [ ] Archive: rm files-modified.md, openspec archive scoped-token-external-trigger --yes, fix any
      TBD Purpose placeholders in synced specs, commit archive separately
- [ ] Push branch, run assert-phase.sh delivery gate
- [ ] gh pr create
- [ ] Post PR link to Linear HEL-369 comment
- [ ] Poll gh pr checks in BOUNDED steps (commit state between polls, backend job ~4min)
- [ ] Manual --squash merge on green (NEVER --auto)
- [ ] Present PR to human, wait for merge confirmation before Phase 4
- [ ] Phase 4 (post-merge, pre-authorized): cleanup.sh --phase4, assert-phase.sh cleanup
- [ ] Set HEL-369 to Done in Linear + closing comment (do NOT touch HEL-344 epic or siblings)
- [ ] Hygiene check (worktree list, git status, stray PNGs, un-archived changes)

## Notes
- Security-surface ticket: scoped tokens + external trigger endpoint (HEL-369).
- Scoping model landed: optional `scoped_pipeline_ids` allow-list on api_tokens. NULL = unscoped/
  full-access (unchanged). Non-null = confined to POST /api/hooks/run only (403 elsewhere) AND
  restricted to the listed pipeline ids (403 outside list). Deliberately narrow: one capability
  (hooks:run) + resource allow-list, not a general permission system.
- Reuses PipelineRunService.submit with triggerSource = TriggerSource.External (already reserved,
  unused) — same run-lifecycle path as manual/scheduled runs, not a second one.
- Audit: new pipeline_runs.triggered_by_token_id (nullable, ON DELETE SET NULL), surfaced via
  existing GET /api/pipelines/:id/run-history — no new read endpoint needed.
- Duplicate-trigger handling: collapses into existing in-flight run via hasActiveRunInternal
  (already exists, used by HEL-415 scheduler) — the "idempotent-friendly" answer, not a full
  idempotency-key system. Documented no-rate-limiting as known exposure in docs/agent-native.md.
- Flyway migration: V74__api_token_scope_and_run_audit.sql (next free number confirmed at
  planning time as V74; executor MUST reconfirm before writing AND again pre-push per pre-brief).
- Scope discipline: only HEL-369. HEL-624 (pie/scatter chart aggregation) queued behind, must not
  be absorbed.
- Do NOT close HEL-344 epic or touch sibling ticket statuses — only set HEL-369 to Done.
