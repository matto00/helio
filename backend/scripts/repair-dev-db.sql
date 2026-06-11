-- Dev DB repair script — HEL-267
--
-- Fixes four drift issues in an existing dev DB:
--   1. Six pre-V15 DataType rows with owner_id IS NULL
--   2. ProfitAgg output DataType owned by wrong user (Google OAuth account)
--   3. ProfitAgg join step config is empty (rightDataSourceId defaults to "")
--   4. ProfitAgg pipeline owned by SystemUser (00000000-…-0001)
--
-- Target user: matt@helio.dev (UUID 9532cfcf-9882-45ba-8247-23706bc00113)
--
-- IDEMPOTENT — safe to run multiple times; all UPDATEs are guarded with WHERE
-- conditions that no-op when the target row is already in the correct state.
--
-- Usage:
--   psql $DATABASE_URL -f backend/scripts/repair-dev-db.sql
--
-- This script is dev-only and intentionally not run by Flyway.

\echo '== HEL-267: Dev DB repair =='
\echo ''

-- ── 1. Backfill six NULL-owner DataType rows ─────────────────────────────────
-- These rows pre-date V15 (which added the owner_id column as a nullable ALTER
-- with no backfill). They are invisible to every authenticated user because
-- DataTypeRepository.findById(typeId, ownerId) filters WHERE owner_id = ? and
-- NULL never matches.
--
-- Row identifiers confirmed by DB inspection on 2026-06-11:
--   fff8488f-e853-42b7-8997-297f5fe74300  Helio Dashboards
--   a38abc47-dff0-41f4-8120-bc917f9608f8  NetflixCSV
--   ac245193-748c-4f39-9af8-1087051db498  test static
--   e262207b-8f11-4d91-8cdd-90bf1d57caca  Netflix Data
--   89f51535-9e39-4a44-94c7-cdb66408cd49  TestDataNetflix
--   9978e754-77ac-4302-908e-227af61b1f4d  MyManualSource

\echo '1. Backfilling NULL-owner DataType rows...'

UPDATE data_types
SET owner_id = '9532cfcf-9882-45ba-8247-23706bc00113'
WHERE id IN (
  'fff8488f-e853-42b7-8997-297f5fe74300',
  'a38abc47-dff0-41f4-8120-bc917f9608f8',
  'ac245193-748c-4f39-9af8-1087051db498',
  'e262207b-8f11-4d91-8cdd-90bf1d57caca',
  '89f51535-9e39-4a44-94c7-cdb66408cd49',
  '9978e754-77ac-4302-908e-227af61b1f4d'
)
AND owner_id IS NULL;

\echo '   Done. Rows updated (0 = already correct).'
\echo ''

-- ── 2. Fix ProfitAgg output DataType owner ───────────────────────────────────
-- DataType c1005183-… ("Profit") was created by the Google OAuth account
-- (0632ca2e-…). Matt's primary dev account (9532cfcf-…) can't see it, so
-- PanelService.resolveSingleBinding returns None and silently scrubs the
-- binding on every panel GET.

\echo '2. Fixing ProfitAgg output DataType owner...'

UPDATE data_types
SET owner_id = '9532cfcf-9882-45ba-8247-23706bc00113'
WHERE id = 'c1005183-0cbe-4631-ac62-95421e18f0a5'
AND owner_id != '9532cfcf-9882-45ba-8247-23706bc00113';

\echo '   Done. Rows updated (0 = already correct).'
\echo ''

-- ── 3. Fix ProfitAgg join step config ────────────────────────────────────────
-- The join step config is currently {} (empty). JoinConfig.decode defaults
-- rightDataSourceId to "", so JoinStep.evaluate calls
-- dataSourceRepo.findByIdInternal("") which returns None and raises
-- "DataSource not found for join" → 422.
--
-- Correct right-side DataSource: Profit static source
--   id:   339018f2-3760-415d-baeb-35d2e3061992
--   name: Profit
--   columns: date (string), profit (integer)
--
-- The HelioProfit CSV (the pipeline's primary source) has a "month" column.
-- The Profit static DataSource has "date" and "profit" columns — no shared
-- key exists, so an inner join will produce an empty result set. This is
-- expected; the goal here is to remove the 422 error. The pipeline can be
-- re-configured via the UI to use a meaningful join key if needed.

\echo '3. Fixing ProfitAgg join step config...'

UPDATE pipeline_steps
SET config = '{"rightDataSourceId":"339018f2-3760-415d-baeb-35d2e3061992","joinKey":"month","joinType":"inner"}'
WHERE id = '9607c209-421c-48b9-b4f2-1cb72b103092'
AND config = '{}';

\echo '   Done. Rows updated (0 = already correct).'
\echo ''

-- ── 4. Fix ProfitAgg pipeline owner ──────────────────────────────────────────
-- V32 backfilled pre-existing pipelines to SystemUserId (00000000-…-0001).
-- PipelineRunService.submit calls pipelineRepo.findById(pipelineId, user),
-- which is ACL-scoped — SystemUser-owned pipelines are invisible to matt,
-- so the run returns 404 → frontend surfaces it as a generic failure.

\echo '4. Fixing ProfitAgg pipeline owner...'

UPDATE pipelines
SET owner_id = '9532cfcf-9882-45ba-8247-23706bc00113'
WHERE id = '6c75e682-4a7c-469b-b9ba-5fda8e4adc42'
AND owner_id != '9532cfcf-9882-45ba-8247-23706bc00113';

\echo '   Done. Rows updated (0 = already correct).'
\echo ''

-- ── Verification queries ──────────────────────────────────────────────────────
\echo 'Verification:'
\echo ''
\echo '  NULL-owner DataType count (expect 0):'
SELECT COUNT(*) AS null_owner_data_types FROM data_types WHERE owner_id IS NULL;

\echo '  ProfitAgg output DataType owner (expect 9532cfcf-...):'
SELECT id, name, owner_id FROM data_types WHERE id = 'c1005183-0cbe-4631-ac62-95421e18f0a5';

\echo '  ProfitAgg join step config (expect rightDataSourceId set):'
SELECT id, config FROM pipeline_steps WHERE id = '9607c209-421c-48b9-b4f2-1cb72b103092';

\echo '  ProfitAgg pipeline owner (expect 9532cfcf-...):'
SELECT id, name, owner_id FROM pipelines WHERE id = '6c75e682-4a7c-469b-b9ba-5fda8e4adc42';

\echo ''
\echo '== Repair complete. Restart the backend server to pick up ownership changes. =='
