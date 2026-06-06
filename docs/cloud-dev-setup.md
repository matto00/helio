# Cloud / Containerized Dev Setup

This doc covers what's needed to get a full Helio development environment running
inside an ephemeral container (e.g. Claude Code on the web, GitHub Codespaces, CI).

## What's pre-installed

The container image includes:
- Java 21 (OpenJDK)
- PostgreSQL 16 (installed but **not started**)
- Node.js / npm

`sbt` is **not** pre-installed and must be downloaded on first use (see below).

## First-time setup

### 1. Install sbt

```bash
curl -fL "https://github.com/sbt/sbt/releases/download/v1.10.7/sbt-1.10.7.tgz" \
  -o /tmp/sbt.tgz && tar -xzf /tmp/sbt.tgz -C /usr/local --strip-components=1
```

### 2. Start PostgreSQL and create the database

```bash
sudo pg_ctlcluster 16 main start

sudo -u postgres psql -c "CREATE DATABASE helio;"
sudo -u postgres psql -c "CREATE USER helio WITH PASSWORD 'helio' SUPERUSER;"
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE helio TO helio;"
sudo -u postgres psql -c "ALTER DATABASE helio OWNER TO helio;"
```

> **Why SUPERUSER?** Migration V34 (`rls_privileged_role`) creates a PostgreSQL
> role with `BYPASSRLS`. Only a superuser (or a role with `CREATEROLE`) can do
> this. `SUPERUSER` is the simplest grant for local dev.

### 3. Write the backend `.env`

```bash
cat > backend/.env <<'EOF'
DATABASE_URL=jdbc:postgresql://localhost:5432/helio
DB_USER=helio
DB_PASSWORD=helio

GOOGLE_CLIENT_ID=placeholder
GOOGLE_CLIENT_SECRET=placeholder
GOOGLE_REDIRECT_URI=http://localhost:5173/auth/callback

HELIO_UPLOADS_BACKEND=local
EOF
```

> Google OAuth values can be placeholders — the backend starts fine without real
> credentials as long as you don't exercise the OAuth login flow.

### 4. Start the backend

```bash
cd backend && sbt run
```

On first run sbt downloads the Scala toolchain (~1–2 min). Subsequent runs are
faster due to the incremental compiler cache.

Flyway runs migrations automatically. A successful start looks like:

```
[info] Successfully applied N migrations to schema "public"
[info] Helio backend listening on /0.0.0.0:8080
```

Verify with:

```bash
curl http://localhost:8080/health   # → {"status":"ok"}
```

### 5. Start the frontend

```bash
cd frontend && npm install && npm run dev
```

Vite proxies `/api` and `/health` to `localhost:8080`.

### 6. Verify the auth flow

Google OAuth requires real credentials. Use the email/password flow instead — the
`/register` page and `POST /api/auth/register` endpoint are fully functional with
no extra setup:

```bash
# Register
curl -s -X POST http://localhost:8080/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"you@example.com","password":"yourpassword","displayName":"Your Name"}'

# Login
curl -s -X POST http://localhost:8080/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"you@example.com","password":"yourpassword"}'
```

Both return `{ token, user, expiresAt }`. The token can be passed as
`Authorization: Bearer <token>` to any authenticated endpoint.

Or navigate to `http://localhost:5173/register` in a browser to use the UI form.

> **Note:** Playwright MCP is not enabled by default in cloud sessions. If you need
> browser-driven UI verification, enable it in your session's MCP settings.

## Session resumption

PostgreSQL **does not survive a container restart** — the process stops but the
data directory is preserved within the same session. If you pick up a session
where PG is down:

```bash
sudo pg_ctlcluster 16 main start
```

Then restart the backend normally (`sbt run`). No need to recreate the database
or re-run step 3 — the `.env` file and DB data persist within the session.

## Known issues / notes

| Issue | Root cause | Fix |
|---|---|---|
| `sbt: command not found` | sbt not bundled in image | Run install step above |
| `DemoData timeout` on startup | `helio.db.privileged` stanza lacked `user`/`password`; HikariCP connected anonymously and stalled | Fixed in `application.conf` (commit `853353f`) |
| Flyway V34 `permission denied to create role` | DB user lacked `CREATEROLE` | Grant `SUPERUSER` to `helio` (step 2 above) |
| `gh` CLI unavailable | Cloud environment restriction | Use `mcp__github__*` tools instead |
| No local browser | Headless container | UI verification via Playwright MCP if configured in session |
