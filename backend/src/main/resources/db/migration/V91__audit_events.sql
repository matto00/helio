-- HEL-471: audit event model + append-only event store (foundation ticket of
-- the Audit Logging epic, HEL-435). No route/directive instrumentation here —
-- that is a later ticket; this migration only creates the durable store.
--
-- THIS IS THE REPO'S FIRST DATABASE TRIGGER. `grep -l "CREATE TRIGGER"` over
-- db/migration returns nothing before this file, so there is no in-repo
-- precedent to pattern-match against — read this comment block in full
-- before touching this table.
--
-- ── Two-pool posture (see DbContext) ────────────────────────────────────────
-- App pool (DB_USER): owns every table, including this one. Privileged pool
-- (helio_privileged, SET ROLE, BYPASSRLS): V38 already grants it
-- SELECT/INSERT/UPDATE/DELETE on every table, present and future, via
-- ALTER DEFAULT PRIVILEGES — so it inherits full DML on audit_events too.
--
-- Append-only must therefore hold for BOTH pools even though one owns the
-- table and the other bypasses RLS entirely and already holds the grant.
-- Two independent facts rule out the two "obvious" mechanisms:
--   * REVOKE alone fails: the app pool owns the table, so it can re-grant to
--     itself at will; V38's ALTER DEFAULT PRIVILEGES re-grants
--     helio_privileged on every future table anyway; and this repo's test
--     harnesses re-grant full DML to their app-test role right after Flyway
--     runs, so a revoke-based test would flip on an unrelated harness edit.
--   * RLS alone fails: under FORCE ROW LEVEL SECURITY, an UPDATE/DELETE that
--     matches zero visible rows does not raise — it reports success with
--     zero rows affected. That silent-zero-row outcome is exactly the
--     failure mode this table must never produce.
--
-- ── The load-bearing mechanism: a statement-level BEFORE trigger ───────────
-- A `FOR EACH STATEMENT` trigger fires before the scan happens at all, so it
-- is indifferent to which rows RLS would have made visible, to whether any
-- row matches, to which pool is connected, and to table ownership. That is
-- what makes it unconditional rather than contingent on row visibility (the
-- way a `FOR EACH ROW` trigger would be — RLS controls exactly which rows a
-- row-level trigger's scan ever reaches).
--
-- TRUNCATE is a separate hole: no row-level trigger fires on TRUNCATE, and
-- TRUNCATE privilege belongs implicitly to the table owner — the app pool's
-- role in production. So a second, TRUNCATE-only statement-level trigger is
-- required, calling the same raising function.
--
-- `MERGE ... WHEN MATCHED THEN UPDATE/DELETE` is intercepted by the same
-- UPDATE/DELETE statement-level trigger (Postgres fires statement-level
-- BEFORE UPDATE/DELETE triggers for the corresponding MERGE actions) — no
-- separate handling needed.
--
-- Both triggers are promoted with `ENABLE ALWAYS`: a plain trigger is
-- `ENABLE ORIGIN`, which is silently skipped under
-- `session_replication_role = 'replica'` (a session-level GUC, not a DDL
-- change) — `ENABLE ALWAYS` closes that hole.
--
-- The row-level UPDATE/DELETE trigger below is retained as defence-in-depth
-- only — NOT load-bearing. The REVOKE below is documented defence-in-depth
-- only, NOT the mechanism (see above for why it cannot be, on its own).
--
-- Residual risk, stated plainly: a trigger is DDL-removable by a role with
-- DDL rights on the table (`ALTER TABLE ... DISABLE TRIGGER` / `DROP
-- TRIGGER`). This migration does not claim tamper-proofness against a
-- deliberate actor holding owner DDL rights — only that no DML statement
-- (UPDATE/DELETE/TRUNCATE) from any pool can alter or remove an existing row.
-- True tamper-resistance is a later epic ticket.

CREATE TABLE audit_events (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id  UUID NULL,
  -- Deliberately a SOFT reference — no REFERENCES clause — not an FK, even
  -- with ON DELETE SET NULL. Two reasons:
  --   1. Deleting the token that acted must never erase the history of what
  --      it did (V74's triggered_by_token_id precedent covers the delete
  --      case; a soft reference gets this for free by construction, since
  --      nothing ever mutates or removes this column's value).
  --   2. An FK to api_tokens would make audit_events a `TRUNCATE ... CASCADE`
  --      dependent of api_tokens (and transitively of users, since
  --      api_tokens.user_id already cascades from users). Postgres's
  --      TRUNCATE CASCADE walks the FK graph regardless of each FK's own
  --      ON DELETE action — ON DELETE SET NULL does not protect against it.
  --      Several existing test harnesses in this repo routinely issue
  --      `TRUNCATE users ... CASCADE` for cleanup; an FK here would turn
  --      every one of those routine cleanups into a hard append-only-trigger
  --      failure the moment audit_events exists, for suites with no
  --      relationship to auditing at all. A soft reference avoids the
  --      dependency entirely while still satisfying the "deleting the
  --      referenced token does not erase history" scenario.
  actor_token_id UUID NULL,
  source         TEXT NOT NULL CHECK (source IN ('ui', 'pat', 'mcp', 'system')),
  action         TEXT NOT NULL,
  resource_type  TEXT NOT NULL,
  resource_id    TEXT NULL,
  metadata       JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_events_actor_created ON audit_events (actor_user_id, created_at);
CREATE INDEX idx_audit_events_resource       ON audit_events (resource_type, resource_id);

-- ── Append-only trigger function ────────────────────────────────────────────
-- SQLSTATE 23001 (restrict_violation) is semantically borrowed — its usual
-- origin is a RESTRICT referential action — but it is stable, specific, and
-- unused elsewhere in this codebase, so assertions on it cannot collide with
-- an unrelated error path.
CREATE OR REPLACE FUNCTION audit_events_reject_mutation() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'audit_events is append-only: % is not permitted (HEL-471)', TG_OP
    USING ERRCODE = '23001';
END;
$$ LANGUAGE plpgsql;

-- Statement-level: THE load-bearing mechanism. Fires once per statement,
-- before the scan, regardless of which (if any) rows the statement would
-- have matched.
CREATE TRIGGER audit_events_no_mutation_stmt
  BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH STATEMENT
  EXECUTE FUNCTION audit_events_reject_mutation();

ALTER TABLE audit_events ENABLE ALWAYS TRIGGER audit_events_no_mutation_stmt;

-- Row-level: defence-in-depth ONLY. Only fires for rows the scan actually
-- selects, which under FORCE RLS depends on row visibility — this is
-- exactly the gap the statement-level trigger above exists to close.
CREATE TRIGGER audit_events_no_mutation_row
  BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW
  EXECUTE FUNCTION audit_events_reject_mutation();

ALTER TABLE audit_events ENABLE ALWAYS TRIGGER audit_events_no_mutation_row;

-- TRUNCATE: required separately. TRUNCATE triggers can only be
-- statement-level (this was already the right shape here), and no
-- UPDATE/DELETE trigger of either granularity fires on TRUNCATE.
CREATE TRIGGER audit_events_no_truncate
  BEFORE TRUNCATE ON audit_events
  FOR EACH STATEMENT
  EXECUTE FUNCTION audit_events_reject_mutation();

ALTER TABLE audit_events ENABLE ALWAYS TRIGGER audit_events_no_truncate;

-- ── Defence-in-depth REVOKE ──────────────────────────────────────────────
-- NOT the load-bearing mechanism (see header). A grantee is mandatory for a
-- valid REVOKE statement. Revoking from helio_privileged does not survive a
-- future re-run of a V38-style blanket grant, and several test harness bases
-- in this repo deliberately GRANT TRUNCATE to helio_privileged for unrelated
-- coverage — this migration's comment does not lean on the absence of that
-- grant as a guarantee. The TRUNCATE trigger above is what guarantees it.
REVOKE UPDATE, DELETE, TRUNCATE ON audit_events FROM PUBLIC;
REVOKE UPDATE, DELETE, TRUNCATE ON audit_events FROM helio_privileged;

-- ── RLS: owner-scoped reads, NOT a single FOR ALL policy ────────────────────
-- Deliberately NOT the V35/V42 single unscoped policy: under FORCE ROW LEVEL
-- SECURITY, an unscoped (FOR ALL) policy's USING qual is applied to
-- UPDATE/DELETE as part of the scan, filtering non-owned and NULL-actor rows
-- out before the statement-level trigger even matters for row visibility —
-- reintroducing the silent-zero-row outcome through the back door for
-- exactly the rows (other users', NULL-actor system rows) this table exists
-- to protect. The three-policy split below is defence-in-depth/clarity only
-- — it does NOT by itself make every mutation reach the trigger, since
-- Postgres applies SELECT policies alongside UPDATE/DELETE policies whenever
-- a statement references any column, so targeted (WHERE-bearing) statements
-- remain scan-filtered regardless. The guarantee is carried entirely by the
-- statement-level trigger above, which fires before the scan.
ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_events FORCE ROW LEVEL SECURITY;

CREATE POLICY audit_events_owner ON audit_events
  FOR SELECT
  USING (actor_user_id = current_setting('app.current_user_id')::uuid);

CREATE POLICY audit_events_update ON audit_events
  FOR UPDATE USING (true);

CREATE POLICY audit_events_delete ON audit_events
  FOR DELETE USING (true);

-- Consequence, recorded deliberately: with the owner policy narrowed to
-- FOR SELECT, NO policy applies to INSERT at all, so under FORCE ROW LEVEL
-- SECURITY every app-pool INSERT is DENIED OUTRIGHT ("new row violates
-- row-level security policy") — for the non-owner app role and the table
-- owner alike, including for a row the caller itself owns. This is
-- fail-safe and accepted: every insert runs on the privileged pool
-- (AuditEventRepository.append via DbContext.withSystemContext); the
-- repository exposes no app-pool write path. A future ticket wanting an
-- app-pool audit insert must add an INSERT policy — one is not implied by
-- anything above.
--
-- Read-scoping consequence, deliberately accepted: on the app pool a caller
-- sees only rows they authored. NULL-actor system rows are invisible to
-- every app-pool caller (NULL = x is NULL, which Postgres treats as false —
-- same posture V35 documents for ownerless data_sources). Cross-user and
-- administrator-wide reads are out of scope for this ticket; the later
-- query-API ticket needs its own admin/owner-tier read path on the
-- privileged pool.
