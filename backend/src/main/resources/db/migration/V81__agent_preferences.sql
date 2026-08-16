-- HEL-472 (420-A, Agent Memory & Preferences): the persistent, structured, schema-bounded
-- USER PREFERENCE STORE the in-app agent (HEL-341) reads for authoring defaults (series colors,
-- default panel styling, naming conventions). Free-form learned facts are the separate
-- agent-memory store (420-B, HEL-478) -- out of scope here.
--
-- Deliberately named `agent_preferences` (NOT `user_preferences`) to avoid colliding with the
-- existing, unrelated UI-theming feature already using that name (`UserPreferences` case class /
-- `UserPreferenceRepository` / `users.preferences` TEXT column + `user_dashboard_zoom` /
-- `PATCH /api/users/me/update`) -- see ticket.md "Escalation Resolution" and design.md
-- "Planner Notes".
--
-- One row per user (user_id is itself the primary key, not a separate id + owner_id pair). The
-- four logical fields (defaultSeriesColors, defaultPanelStyle, namingConventions, extras) are
-- serialized into the single `preferences` JSONB column at the repository boundary
-- (AgentPreferencesRepository), mirroring how `condition` is stored on alert_rules (V60) --
-- see design.md Decision 1.

CREATE TABLE agent_preferences (
    user_id     UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    preferences JSONB NOT NULL DEFAULT '{}',
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- RLS: owner-only, ENABLE+FORCE, single policy on user_id -- mirrors the V42 (api_tokens) / V54
-- (image_uploads) direct-owner pattern exactly (design.md Decision 2). No index is needed beyond
-- the primary key itself, since the policy predicate is user_id and user_id IS the PK here
-- (unlike V37's owner_id-on-a-separate-id-column shape).
ALTER TABLE agent_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_preferences FORCE ROW LEVEL SECURITY;

-- No separate WITH CHECK -- the USING expression alone also gates INSERT, so a user cannot write
-- a row for another user_id.
CREATE POLICY agent_preferences_owner ON agent_preferences
  USING (user_id = current_setting('app.current_user_id')::uuid);
