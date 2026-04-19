## 1. Backend

- [x] 1.1 Write V10__user_sessions_complete.sql: DROP TABLE IF EXISTS user_sessions CASCADE, then CREATE TABLE with id (UUID PK default gen_random_uuid()), user_id (UUID FK → users ON DELETE CASCADE), token (TEXT UNIQUE NOT NULL), created_at, expires_at, last_seen_at (nullable), ip_address (nullable), user_agent (nullable)
- [x] 1.2 Add CREATE UNIQUE INDEX on user_sessions(token) in the same migration

## 2. Tests

- [x] 2.1 Verify Flyway migrations apply cleanly by running sbt test (migration tests run on startup)
- [x] 2.2 Confirm user_sessions table exists with correct columns by inspecting the migration SQL
