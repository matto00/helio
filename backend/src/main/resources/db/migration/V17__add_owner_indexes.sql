CREATE INDEX idx_dashboards_owner_id      ON dashboards(owner_id);
CREATE INDEX idx_data_sources_owner_id    ON data_sources(owner_id);
CREATE INDEX idx_data_types_owner_id      ON data_types(owner_id);
CREATE INDEX idx_panels_type_id           ON panels(type_id);
CREATE INDEX idx_user_sessions_expires_at ON user_sessions(expires_at);
