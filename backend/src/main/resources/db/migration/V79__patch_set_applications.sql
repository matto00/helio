-- HEL-413: patch-set undo journal.
--
-- `PatchSetApplyService.apply` (HEL-406) journals a successful (no `failure`) patch-set
-- application here so a later `POST /api/patch-sets/:id/undo` can reconstruct and apply the
-- inverse edits from persisted JSON alone -- `PatchSetApplyRollback`'s in-memory `ResolvedEdit`s
-- (domain-typed `prior: Panel`/`Dashboard`/...) exist only for the duration of one apply call and
-- cannot be reached again once that call has returned (design.md Context).
--
-- `edits` is a JSON array, one entry per applied edit:
-- `{index, targetKind, op, priorState, resultingState, newId, rawResultingConfig}` -- the
-- JOURNAL's own record shape, distinct from the `/apply` wire response's `EditOutcome` (design.md
-- D1). `rawResultingConfig` (panel `update` edits only, design.md D2a) never reaches the `/apply`
-- response -- it exists only here.
--
-- patch_set_applications is a direct-owner table, mirroring V77__authoring_conversations.sql's
-- RLS pattern exactly (FORCE ROW LEVEL SECURITY is required because DB_USER owns the table --
-- without FORCE, the table owner would bypass RLS even on the app pool; the privileged pool,
-- helio_privileged, BYPASSRLS -- see V34 -- is the only sanctioned bypass).

CREATE TABLE patch_set_applications (
    id          TEXT PRIMARY KEY,
    owner_id    UUID NOT NULL REFERENCES users(id),
    applied_at  TIMESTAMPTZ NOT NULL,
    edits       JSONB NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_patch_set_applications_owner_id ON patch_set_applications(owner_id);

-- design.md D3: retention prunes to the 20 most-recent rows per owner on every write, via a
-- single atomic `DELETE ... WHERE owner_id = ? AND id NOT IN (SELECT id ... ORDER BY applied_at
-- DESC LIMIT 20)` -- this index also makes that ORDER BY ... LIMIT subquery efficient.
CREATE INDEX idx_patch_set_applications_owner_id_applied_at ON patch_set_applications(owner_id, applied_at DESC);

ALTER TABLE patch_set_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE patch_set_applications FORCE ROW LEVEL SECURITY;

CREATE POLICY patch_set_applications_owner ON patch_set_applications
  USING (owner_id = current_setting('app.current_user_id')::uuid);
