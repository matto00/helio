-- HEL-1420: trailing-30-day distinct active users per rolled-up day, beside the daily and weekly
-- counts, for the owner usage page's all-time "active in the last 30 days" total.
--
-- Nullable with no default, so ADD COLUMN is metadata-only (no rewrite, no data read) and every
-- existing row gets NULL -- "not computed". NULL is also what the rollup writes when the 30-day
-- window's first day has left raw-event retention (partial purged rows would under-count).
-- Days rolled up before this migration are NOT backfilled: a SQL backfill would have to read
-- product_events as the non-BYPASSRLS Flyway role, and that table's FORCE-RLS owner policy
-- (a bare current_setting) fails for it. The next daily rollup populates the days it recomputes.
--
-- The migration role owns the table (V113), so no extra privilege is needed; V113's table-level
-- GRANT to helio_privileged already covers the new column. No RLS on this table; no per-user data.
--
-- Additive only -- never edit this file once applied (Flyway checksums the whole file).

ALTER TABLE product_active_users_daily ADD COLUMN monthly_active_users BIGINT;
