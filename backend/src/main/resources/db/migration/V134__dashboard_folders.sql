-- HEL-1574: per-user dashboard folders for the shell's context list.
--
-- A folder belongs to exactly one user (owner_id). A filing row (dashboard_folder_assignments) is the caller's own
-- private placement of a dashboard they can access (owned or granted); it never touches the dashboard or any grant.
-- The composite FK (folder_id, owner_id) -> dashboard_folders(id, owner_id) makes filing into another user's folder
-- impossible at the schema level. Both tables are FORCE ROW LEVEL SECURITY with a USING + WITH CHECK owner policy
-- (proven in a NOBYPASSRLS session by DashboardFolderRlsSpec). Rollback = DROP both tables; nothing else is touched.

CREATE TABLE dashboard_folders (
    id         UUID PRIMARY KEY,
    owner_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name       TEXT NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 80),
    collapsed  BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (id, owner_id)
);

CREATE UNIQUE INDEX dashboard_folders_owner_name_uq ON dashboard_folders (owner_id, lower(name));

CREATE TABLE dashboard_folder_assignments (
    owner_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    dashboard_id TEXT NOT NULL REFERENCES dashboards(id) ON DELETE CASCADE,
    folder_id    UUID NOT NULL,
    PRIMARY KEY (owner_id, dashboard_id),
    FOREIGN KEY (folder_id, owner_id) REFERENCES dashboard_folders (id, owner_id) ON DELETE CASCADE
);

CREATE INDEX dashboard_folder_assignments_folder_idx ON dashboard_folder_assignments (folder_id);

ALTER TABLE dashboard_folders ENABLE ROW LEVEL SECURITY;
ALTER TABLE dashboard_folders FORCE ROW LEVEL SECURITY;

CREATE POLICY dashboard_folders_owner ON dashboard_folders
  USING (owner_id = current_setting('app.current_user_id')::uuid)
  WITH CHECK (owner_id = current_setting('app.current_user_id')::uuid);

ALTER TABLE dashboard_folder_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE dashboard_folder_assignments FORCE ROW LEVEL SECURITY;

CREATE POLICY dashboard_folder_assignments_owner ON dashboard_folder_assignments
  USING (owner_id = current_setting('app.current_user_id')::uuid)
  WITH CHECK (owner_id = current_setting('app.current_user_id')::uuid);
