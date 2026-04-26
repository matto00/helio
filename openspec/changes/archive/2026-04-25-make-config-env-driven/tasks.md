## 1. Backend — Port Configuration

- [x] 1.1 Update `Main.scala` to check `PORT` env var first, then `HELIO_HTTP_PORT`, then default to `8080`

## 2. Backend — DB Configuration

- [x] 2.1 Add `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` HOCON substitutions to `application.conf` with local defaults
- [x] 2.2 Ensure `DATABASE_URL` still takes precedence over individually constructed URL

## 3. Backend — Log Level Configuration

- [x] 3.1 Add `akka.loglevel = ${?LOG_LEVEL}` substitution with `INFO` default in `application.conf`
- [x] 3.2 Update `logback.xml` to read `LOG_LEVEL` env var for root level with `INFO` default

## 4. Backend — CORS Configuration

- [x] 4.1 Add `akka-http-cors` dependency to `build.sbt`
- [x] 4.2 Read `CORS_ALLOWED_ORIGINS` in `Main.scala`, parse comma-separated origins, default to `http://localhost:5173`
- [x] 4.3 Pass allowed origins to `ApiRoutes` and apply `cors()` directive wrapping all routes

## 5. Documentation

- [x] 5.1 Create `.env.example` at repo root with all env vars, inline comments, and local-dev defaults
