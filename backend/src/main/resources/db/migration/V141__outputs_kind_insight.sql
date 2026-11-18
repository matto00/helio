-- HEL-1740: registers the `insight` Output kind by widening `outputs.kind`'s CHECK.
-- V94's inline CHECK is auto-named `outputs_kind_check`; a CHECK cannot be widened in
-- place, so it is dropped and re-added with the seven-value predicate.
--
-- `NO FORCE`/`FORCE ROW LEVEL SECURITY` bracket the ALTER for consistency with V108 and
-- the V117 precedent (this statement is pure DDL and needs neither, but a table must
-- never be left under NO FORCE).
ALTER TABLE outputs NO FORCE ROW LEVEL SECURITY;

ALTER TABLE outputs
  DROP CONSTRAINT outputs_kind_check,
  ADD CONSTRAINT outputs_kind_check
    CHECK (kind IN ('metric', 'chart', 'table', 'collection', 'timeline', 'markdown', 'insight'));

ALTER TABLE outputs FORCE ROW LEVEL SECURITY;
