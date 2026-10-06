# HEL-1276: HEL-918 L6: Opt-in node payload history (capped, tiered)

## Description

Owner rulings for HEL-918 (2026-10-05), relevant excerpts:

* D1 Storage: summary first (L1). Full row payloads come later (L6), opt-in, with tight retention, as one JSONB array per node per run.
* D4 Retention: write every run, then thin on purge (L2). Payload tier caps (L6): free 0, beta 10 runs/7d, owner 30 runs/30d. Env-driven config (PipelineRunGuardConfig style).
* D5 Only real, unblocked, successful runs record history. Not dry runs, previews, blocked runs, failed runs or write-back failures, and not the HEL-947 output backfill.
* D7 run_id TEXT NULL with no FK, plus trigger_source and captured_at.
* D8 UUID PK (no BIGSERIAL, TRUNCATE-cascade sequence landmine). pipeline_id stored. Sharing-aware RLS via helio_can_access_pipeline, mirroring node_snapshots. Access through the privileged pool behind outputRepo.findById. Public dashboards get the summary, never payloads.
* D9 The history insert is in the same per-node overwriteRows transaction as the snapshot replace. Not best-effort.

Corrections (verified): no NodeSnapshotStore interface; PipelineRunService writes snapshots node by node, each in its own transaction; node_snapshots has no run_id; no seconds-cadence pipelines (floor: 1-min cron, 30s tick, 10 runs/min/user guard).

## Scope

* Migration (V116, reserved by the driver) creating node_payload_history: one JSONB array per node per run, capped at MaxRunRows, with tier caps per D4 (free 0, beta 10 runs/7d, owner 30 runs/30d). Written in the same transaction.
* Extend the L2 purge.
* GET /api/outputs/:id/history/:point/rows (never public).

## Acceptance Criteria

* As in L1 (transactional write, D5 run filter, sharing-aware RLS, privileged-pool access behind outputRepo.findById), plus:
* a size-cap test,
* a "free tier writes nothing" test,
* a non-BYPASSRLS RLS proof (two-role topology: app role NOSUPERUSER non-BYPASSRLS + helio_privileged), and
* public dashboards never receive payloads.

## Constraints from the driver

* Do not settle HEL-1285 ('previous' after thinning).
* Any byte/row cap is a product decision -> escalated with a recommendation.
* HEL-1282 guard: if NodeSnapshotRepository.scala changes around nodeFilterFragment (or BinaryRefRepository.scala around selectQuery), update the exemption table and scripts/check-node-root-encoding.selftest.mjs in the same change.
* Do not touch .github/workflows/ci.yml or playwright.config.ts.
