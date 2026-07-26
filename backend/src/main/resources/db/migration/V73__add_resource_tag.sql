-- HEL-366: resource tagging / namespacing + bulk teardown.
--
-- Adds a single free-form, nullable `tag` column (max 200 chars) to the three
-- resource kinds an agentic workflow creates: data_sources, pipelines,
-- data_types. Design.md Decision 1: a scalar column (not a multi-tag array
-- or join table) so "does this resource carry the tag" has one unambiguous
-- answer on the bulk-delete path.
--
-- Nullable, no default, purely additive — existing rows get `tag = NULL` and
-- are unaffected (design.md Goals/Non-Goals, ticket backward-compatibility
-- section).
--
-- Partial index `(owner_id, tag) WHERE tag IS NOT NULL` on each table
-- supports the tag-filtered list endpoints and the teardown plan's tagged-set
-- SELECTs without indexing the (typically much larger) untagged majority.

ALTER TABLE data_sources ADD COLUMN tag TEXT CHECK (length(tag) <= 200);
ALTER TABLE pipelines ADD COLUMN tag TEXT CHECK (length(tag) <= 200);
ALTER TABLE data_types ADD COLUMN tag TEXT CHECK (length(tag) <= 200);

CREATE INDEX idx_data_sources_owner_tag ON data_sources (owner_id, tag) WHERE tag IS NOT NULL;
CREATE INDEX idx_pipelines_owner_tag ON pipelines (owner_id, tag) WHERE tag IS NOT NULL;
CREATE INDEX idx_data_types_owner_tag ON data_types (owner_id, tag) WHERE tag IS NOT NULL;
