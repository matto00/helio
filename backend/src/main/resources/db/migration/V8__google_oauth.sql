ALTER TABLE users
  ADD COLUMN google_id   TEXT,
  ADD COLUMN avatar_url  TEXT;

CREATE UNIQUE INDEX users_google_id_idx ON users (google_id) WHERE google_id IS NOT NULL;
