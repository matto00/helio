# HEL-1093: Auto-run trigger on dataset write, debounced

## Description

A dataset write schedules a run of each downstream pipeline that passes the verdict, coalesced over a short window so rapid counter clicks fire once.

Reuse the `HookTriggerService` path — a panel-originated write is the same shape as a webhook trigger, and it already owns no tables.

**AC:** ten increments in two seconds produce one run, not ten.

---

Design spec: `docs/superpowers/specs/2026-09-10-interactive-data-writeback-design.md` (PR #627)

## Acceptance Criteria

- Ten increments (counter-control form-panel submits) to the same bound dataset within a two-second window produce exactly one downstream pipeline run per eligible pipeline, not ten. Proven with a failable probe: run count read from `pipeline_runs`, not from log lines; with debounce disabled, the same ten writes must produce ten runs (the red case).
- Only pipelines whose `PipelineCostEstimator` verdict (`autoRunnable`) is true for the write's dataset-owning root actually run. A denied pipeline's denial reason must be available (not swallowed) — surfaced for a later ticket (HEL-1096) to render, not necessarily rendered by this ticket.
- The triggered run enters through `PipelineRunService.submit` (the same choke point manual/hook/scheduler triggers already use) so it is subject to HEL-505's rate-limit and concurrency-cap guards. A rejected (429-equivalent) auto-run is surfaced (logged/recorded), never silently dropped.
- Run ownership: the pipeline owner is the principal the auto-run counts against (HEL-1108 scheduled-run precedent — `AuthenticatedUser(pipeline.ownerId, source = AuditSource.System, tokenId = None)`), with correct RLS context (`app.current_user_id`) on the auto-run trigger path.
- Debounce/coalescing must actually hold under helio's real deployment topology (up to 2 concurrent Cloud Run instances) — an in-memory, per-instance-only debounce that only coalesces within a single instance does not satisfy the AC in prod. See design.md for how this is resolved (this is a flagged architectural fork — see premise-validation.md persisted at Setup).

## Non-goals

- Cascading auto-runs (an auto-run itself triggering further downstream auto-runs) is out of scope — `PipelineCostEstimator.WriteBackOps` already denies any pipeline containing `upsertsource`, so a write-back-producing downstream pipeline can never itself pass the cheapness verdict and auto-run further. No additional cascade-prevention mechanism is needed.
- The "Run to update" manual-affordance UI for a denied pipeline is HEL-1096's scope, not this ticket's. This ticket only needs to ensure the denial reason is preserved/available.
