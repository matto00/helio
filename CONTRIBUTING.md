# Contributing to Helio

Thanks for your interest in contributing. This document covers how to get set up, the standards we hold code to, and what to expect from the review process.

## Getting Started

See the [README](README.md) for prerequisites and instructions on running the frontend and backend locally.

Before starting work on anything non-trivial, open an issue or comment on an existing one so we can align on approach before you invest time in implementation.

## Workflow

1. Fork the repo and create a branch: `[feature|task|bug]/short-description`
2. Make your changes, keeping commits focused and descriptive
3. Ensure all pre-commit checks pass (see below)
4. Open a pull request against `main` and fill out the PR template

## Code Standards

### General

- Optimize for readability and performance — they're usually not in conflict
- Keep changes focused; avoid unrelated refactors in the same PR
- Prefer small, composable units over large files or functions. Soft budgets: **~250 lines per source file**, **~80 lines for an aggregator/index file**. If a file you're editing crosses ~400 lines, propose a split in the PR description rather than adding to it
- Never commit secrets, credentials, or `.env` files

### Imports & Qualifiers

- **Always import at the top of the file; never inline a fully-qualified name when an `import` would do.** Inline FQNs (`com.helio.domain.PanelId(...)`, `spray.json.JsObject`, `java.util.UUID.randomUUID()`) make code noisier and harder to grep
- Prefer wildcard imports for tight, cohesive packages (`spray.json._`, `com.helio.domain._`); use explicit imports for everything else
- A single-use import scoped inside a companion object or function is the only place an "inline-ish" qualifier is acceptable — and only when widening the file's top-level import scope would cause real coupling

### Frontend (React / TypeScript / Redux)

- Use Redux for shared app state; keep components primarily presentational
- Move reusable behavior into hooks, selectors, or utilities
- Avoid `any` — use proper types or `unknown` with narrowing
- Write Jest tests for components, hooks, selectors, and reducers
- Test behavior, not implementation details

### Backend (Scala / Pekko HTTP)

- Keep actor and service boundaries explicit
- Never block actor threads with synchronous I/O
- Isolate infrastructure concerns behind reusable interfaces
- Write ScalaTest coverage for domain and service logic
- Wrap path-extracted IDs into value-class types (`DashboardId`, `PanelId`, etc.) at the **route boundary** via `PathMatcher1[T]` segments; repositories and services accept value-class IDs only — never raw `String`
- Per-domain JSON formatters live under `com.helio.api.protocols`; the aggregator `JsonProtocols` only mixes them in. Don't add new formatters to the aggregator directly

#### ACL triad for repository reads

Every repository that exposes a per-id read MUST choose one of three flavors explicitly:

| Method                    | SQL shape                                                           | When to use                                                                                                                                                                     |
| ------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `findById(id, callerOpt)` | `WHERE id = ? AND (owner_id = ? OR EXISTS(resource_permissions …))` | Routes that honor sharing grants (dashboard + panel reads)                                                                                                                      |
| `findByIdOwned(id, user)` | `WHERE id = ? AND owner_id = ?`                                     | Mutation paths (delete, update, refresh) and any route where shared access is semantically wrong                                                                                |
| `findByIdInternal(id)`    | `WHERE id = ?` — no ACL                                             | Privileged internal callers only: `ResourceTypeRegistry` owner-resolvers, background pipeline steps. Every callsite MUST have a comment explaining why it is safe to bypass ACL |

**Existence-not-leaked semantics**: `findByIdOwned` (and `findById` for no-grant callers) returns `None` for a cross-user ID. Services map `None → 404 Not Found`, never `403 Forbidden`. This hides resource existence from unauthorized callers. The 403 status is reserved for cases where the resource is visible (the caller has a sharing grant) but the requested operation is not permitted for their role (e.g., a viewer-grant user attempting a mutation).

#### Database transactions & RLS context

All database access goes through `DbContext` — **never call `db.run(...)` directly in a repository**. `DbContext` wraps every action in an explicit transaction and sets the `app.current_user_id` Postgres session variable before running the action:

- `ctx.withUserContext(userId)(action)` — sets the variable to the caller's user id. Use for user-visible reads and writes where RLS policies should apply.
- `ctx.withSystemContext(action)` — sets the variable to `"system"`. Use for internal/privileged actions that must bypass user-scoped RLS, background jobs, and any call site where no `AuthenticatedUser` is available.

**Why `SET LOCAL` (not `SET SESSION`)**: `set_config('app.current_user_id', value, true)` is transaction-scoped. When HikariCP recycles a connection back to the pool the variable is automatically cleared, preventing user-id leakage across requests.

**Nested transactions are safe**: Slick's `.transactionally` on an action that is already inside a `withUserContext`/`withSystemContext` call becomes a Postgres savepoint; the outer transaction — and its `SET LOCAL` — remain in effect.

#### Role split: helio_app vs helio_privileged (HEL-272)

`DbContext` manages two physically separate HikariCP connection pools:

| Pool            | PostgreSQL role                | RLS behavior                              | Used by             |
| --------------- | ------------------------------ | ----------------------------------------- | ------------------- |
| App pool        | `DB_USER` (non-BYPASSRLS)      | RLS policies are evaluated on every query | `withUserContext`   |
| Privileged pool | `helio_privileged` (BYPASSRLS) | RLS policies are skipped entirely         | `withSystemContext` |

`helio_privileged` is created by Flyway migration V34 with `BYPASSRLS` and
granted to `DB_USER` so that `SET ROLE helio_privileged` works from the
app's login credentials. **Never call `db.run` on the privileged pool directly**
— always go through `withSystemContext`.

**FORCE ROW LEVEL SECURITY**: All nine ACL'd tables use `FORCE ROW LEVEL
SECURITY` (V35 + V36), which means the table owner cannot bypass policies
on the app pool. The only way to bypass is to hold the `helio_privileged` role
(which requires `BYPASSRLS`). This prevents the common RLS footgun where the
table owner silently sees all rows even on the non-privileged connection.

**Adding a new ACL'd table**: Any new table that holds user-owned data must:

1. Add `ENABLE ROW LEVEL SECURITY` + `FORCE ROW LEVEL SECURITY` in its
   migration.
2. Add policies covering at minimum SELECT and INSERT (and UPDATE/DELETE if
   applicable).
3. Add the table name to the `rlsTables` allowlist in `RlsPolicyGuardSpec` —
   the guard spec will fail CI if this step is missed.
4. Add `idx_<table>_owner_id` if the policy predicate references `owner_id`
   directly (see V37 for the pattern).

### API Contracts

- Define request/response shapes in `schemas/` (JSON Schema 2020-12)
- Keep schema changes in the same PR as the code that uses them
- Validate all inputs at service boundaries

## Pre-Commit Policy

Husky runs the following automatically on every commit — fix failures before pushing:

```bash
npm run lint               # ESLint (zero-warnings)
npm run format:check       # Prettier
npm run check:schemas      # JSON Schema ↔ Scala protocol parity
npm run check:openspec     # OpenSpec hygiene
npm run check:scala-quality # No inline FQNs; file-size soft budgets
npm test                   # Frontend Jest suite
```

The `check:scala-quality` script enforces the **Imports & Qualifiers** rule mechanically — any inline `com.helio.X`, `spray.json.X`, `java.util.UUID`, `org.apache.pekko.X`, etc. that isn't a top-of-file `import` or a `package` declaration will fail the commit. File-size warnings (~250 lines per source, ~80 for aggregators) are informational only.

Backend tests are not in the Husky chain by default — run them yourself before pushing backend changes:

```bash
cd backend && sbt test
```

`git commit -n` (skip hooks) is available for emergencies only. Any bypassed checks must be fixed in the next commit.

## Pull Request Expectations

- Keep PRs reasonably scoped — one concern per PR
- Describe what changed and how you tested it (the PR template will prompt you)
- Flag anything security-sensitive or performance-sensitive explicitly
- Expect review feedback within a few days; address comments or push back with reasoning

## Reporting Issues

Use the GitHub issue templates for bugs and feature requests. For security vulnerabilities, see [SECURITY.md](SECURITY.md).

## AI Collaborators

The same standards apply to AI agents (Claude Code, Copilot, etc.) contributing to this repository. Agents must:

- Read this document before making non-trivial edits
- Follow the **Imports & Qualifiers** rule strictly — agents often inline fully-qualified names by reflex; don't
- Honor the file-size soft budgets; prefer proactive decomposition over letting a file grow
- Keep refactors **behavior-preserving**: a structural change is not the place to also fix bugs, add features, or "improve" defaults. Flag latent issues as separate spinoff tickets
- Never use `--no-verify` to bypass a real gate failure. The only acceptable use is an environmental hook breakage (e.g., Husky cannot resolve `.git` in a worktree), and even then the situation must be called out explicitly in the commit body

## Code of Conduct

This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md). Please read it before participating.
