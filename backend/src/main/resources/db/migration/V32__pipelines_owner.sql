-- HEL-265 CS1 — Pipeline owner_id foundation.
--
-- Adds an owner_id column to the pipelines table so subsequent sub-PRs (CS2)
-- can enforce ACL on every pipeline read / write at the repository layer.
--
-- Backfill strategy: pre-V32 pipelines are assigned to the system user
-- (`00000000-0000-0000-0000-000000000001`, seeded by V10). This matches the
-- pattern V10 used for dashboards / panels and is safe in dev / staging where
-- pipelines have no real ownership today (audit confirmed there is no
-- ownership concept on pipelines pre-V32 — see executor-report-1).
--
-- Production caveat: any deployed instance with per-user pipelines must
-- hand-update `pipelines.owner_id` AFTER this migration runs but BEFORE
-- deploying CS2 (which enforces ACL based on this column). Otherwise every
-- pre-existing pipeline will be visible only to the system user.
--
-- pipeline_steps and pipeline_runs intentionally do NOT receive their own
-- owner_id column; CS2 will JOIN those reads against pipelines.owner_id so
-- the canonical owner stays in one place (per design.md Q1).
ALTER TABLE pipelines
  ADD COLUMN owner_id UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001'::uuid REFERENCES users(id);

CREATE INDEX idx_pipelines_owner_id ON pipelines(owner_id);
