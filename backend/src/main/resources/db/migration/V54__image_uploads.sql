-- HEL-246: image_uploads — standalone panel-literal image upload metadata.
--
-- Deliberately NOT a reuse of binary_refs (HEL-217/V46): that table's RLS
-- policy and UNIQUE constraint are keyed on (data_type_id, row_index,
-- field_name), a shape that assumes a parent DataType/pipeline-bound row.
-- A panel-literal image upload has no such parent, so forcing it into that
-- shape would mean inventing a fake data_type_id. This table mirrors only
-- binary_refs' *field shape* (storage_key/mime_type/filename/size_bytes)
-- with its own direct-owner policy instead. See design.md Decision 1.

CREATE TABLE image_uploads (
    id           TEXT PRIMARY KEY,
    owner_id     UUID NOT NULL,
    storage_key  TEXT NOT NULL,
    mime_type    TEXT NOT NULL,
    filename     TEXT NOT NULL,
    size_bytes   BIGINT NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Covers the owner-only policy predicate (V37 pattern).
CREATE INDEX idx_image_uploads_owner_id ON image_uploads (owner_id);

-- RLS: direct-owner policy, same shape as api_tokens (V42) / pipelines (V35).
-- The write path (POST /api/uploads/image) runs under withUserContext(ownerId)
-- via ImageUploadRepository.insert, so the USING clause (also gating INSERT
-- with no separate WITH CHECK) rejects any row whose owner_id isn't the
-- caller. The byte-serving read path (GET /api/uploads/image/:id) is
-- intentionally unauthenticated and reads via withSystemContext — the
-- privileged pool bypasses this policy by design (see design.md Decisions 2
-- and 3), so the endpoint can remain servable without a Bearer token. FORCE
-- ROW LEVEL SECURITY is set so any future non-privileged read path fails
-- closed by default rather than silently open.
ALTER TABLE image_uploads ENABLE ROW LEVEL SECURITY;
ALTER TABLE image_uploads FORCE ROW LEVEL SECURITY;

CREATE POLICY image_uploads_owner ON image_uploads
  USING (owner_id = current_setting('app.current_user_id')::uuid);
