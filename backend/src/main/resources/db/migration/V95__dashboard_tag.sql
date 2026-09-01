-- HEL-907 evaluator-1 CR3: extends HEL-366's resource-tagging system (V73) to
-- `dashboards` -- the one top-level agent-creatable resource the original
-- ticket left untagged (dashboards weren't yet part of the agentic workflow
-- at the time). Found while fixing the MCP E2E Sleeper-rebuild script's own
-- dashboard leak: `create_dashboard` had no `tag` parameter at all because
-- there was nowhere to persist one. Same shape as V73's three columns
-- (nullable, no default, purely additive, 200-char cap, partial index).

ALTER TABLE dashboards ADD COLUMN tag TEXT CHECK (length(tag) <= 200);

CREATE INDEX idx_dashboards_owner_tag ON dashboards (owner_id, tag) WHERE tag IS NOT NULL;
