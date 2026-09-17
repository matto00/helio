-- HEL-1083: registers the `form` panel kind and adds its config storage
-- column. See ticket.md's "Orchestrator corrections" -- this migration is
-- REQUIRED (the ticket, epic, and design spec all originally omitted it):
-- without widening `panels_kind_check`, a `kind = 'form'` row cannot be
-- INSERTed at all.
--
-- One migration carries BOTH changes (design.md D2, C3): a CHECK constraint
-- cannot be widened in place, so it is dropped and re-added with the new
-- six-value predicate, and `form_config` is added in the same statement
-- group. Two migrations would let a lane apply one without the other.
--
-- `NO FORCE`/`FORCE ROW LEVEL SECURITY` bracket the ALTER for defensive
-- consistency only, NOT because this statement needs it: every `panels`
-- policy (`panels_select`/`panels_update`/`panels_delete`/`panels_insert`,
-- V36) uses `missing_ok`-safe predicates and none reads a config column, and
-- this migration is pure DDL, not DML against a policy. The bracket follows
-- the repo's established V50.../V83__add_assert_op.sql-style precedent of
-- never leaving a table under FORCE RLS mid-migration.
ALTER TABLE panels NO FORCE ROW LEVEL SECURITY;

ALTER TABLE panels
  DROP CONSTRAINT panels_kind_check,
  ADD CONSTRAINT panels_kind_check
    CHECK (kind IN ('output', 'text', 'markdown', 'image', 'divider', 'form'));

-- V94's `kind IS NULL OR` disjunct is dropped, not carried forward: `kind`
-- has been NOT NULL since V94 line 1213, so admitting NULL here would
-- misdescribe the column.

ALTER TABLE panels ADD COLUMN form_config JSONB NULL;

ALTER TABLE panels FORCE ROW LEVEL SECURITY;
