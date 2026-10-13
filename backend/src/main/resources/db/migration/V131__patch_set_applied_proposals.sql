-- HEL-1522: apply-once claims for server-minted patch-set proposal ids.
--
-- A patch set minted by refinement or the assistant carries a `proposalId`; `PatchSetApplyService.apply` claims
-- (owner_id, proposal_id) here before its first write, so the same proposal cannot be applied twice (a re-entered
-- hand-off). Separate from `patch_set_applications` (V79) because that journal is pruned to 20 rows per owner and is
-- written only on success; a claim must outlive both. `application_id` is set when the apply was journaled.
--
-- Direct-owner table with the same RLS shape as V79 (FORCE: DB_USER owns the table; the privileged pool is the only
-- sanctioned bypass). Rollback = DROP TABLE; nothing else is touched.

CREATE TABLE patch_set_applied_proposals (
    owner_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    proposal_id    TEXT NOT NULL,
    application_id TEXT,
    claimed_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (owner_id, proposal_id)
);

ALTER TABLE patch_set_applied_proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE patch_set_applied_proposals FORCE ROW LEVEL SECURITY;

CREATE POLICY patch_set_applied_proposals_owner ON patch_set_applied_proposals
  USING (owner_id = current_setting('app.current_user_id')::uuid);
