-- HEL-369: scoped run tokens + external-trigger run audit.
--
-- api_tokens.scoped_pipeline_ids: nullable JSONB allow-list, mapped opaquely
-- to a String at the Slick layer and parsed to/from a JSON array of pipeline
-- ids at the domain boundary -- the same `jsonbStringType` pattern
-- `AlertRuleRepository.condition`/`DataSourceRepository.config` already use.
-- (design.md Decision 1 proposed a native Postgres TEXT[] column; the plain
-- `slick`/`slick-hikaricp` dependency this backend uses -- no `slick-pg` --
-- has no JdbcType for SQL ARRAY columns, so this ticket takes design.md's
-- documented Risks/Trade-offs fallback instead: functionally equivalent,
-- more code churn only.) NULL (the default -- existing rows stay NULL) means
-- today's unscoped PAT with full account access on every authenticated
-- route. A non-null JSON array (even single-element) confines the token to
-- POST /api/hooks/run and, within that route, to pipeline ids that are
-- members of the array (design.md Decision 1/2).
ALTER TABLE api_tokens ADD COLUMN scoped_pipeline_ids JSONB;

-- pipeline_runs.triggered_by_token_id: nullable audit column recording which
-- token (if any) authenticated an external-triggered run. ON DELETE SET NULL
-- (not CASCADE) -- revoking/deleting a token must not erase run history
-- (design.md Decision 5).
ALTER TABLE pipeline_runs ADD COLUMN triggered_by_token_id UUID REFERENCES api_tokens(id) ON DELETE SET NULL;
