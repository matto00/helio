## 1. Backend

- [x] 1.1 Add `user` and `password` fields to `helio.db` in `application.conf` with `${?DB_USER}` / `${?DB_PASSWORD}` env-var overrides
- [x] 1.2 Update `Database.init` to read `user` and `password` from config and pass them to `Flyway.configure().dataSource(url, user, password)`

## 2. Documentation

- [x] 2.1 Add production env var table to `CLAUDE.md` backend section documenting `DATABASE_URL`, `DB_USER`, `DB_PASSWORD`
