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

### Comments

A comment costs a reader's attention every time they pass it, and it is the one
part of the file the compiler never checks. Write the ones that carry something
the code cannot, and leave the rest out.

- **The test before you write one: could a competent reader derive this from the code itself?** If yes, delete it — the code is the better version of that sentence. A comment that restates the line below it is not neutral; it is a second thing to keep in sync
- **Write, in rough order of worth:** _hazards_ (ordering traps, precedence, "this must be mounted before X"), _contracts_ (an invariant a caller depends on that the signature does not express), and _why_ (the reason, the tradeoff, the alternative you rejected). The `HEL-364` route-mounting note in `ApiRoutes.scala` is the model: it explains a shadowing hazard that no amount of reading the routes reveals
- **Don't write:** a restatement of the next line; a short label naming the thing beneath it (`// Clear the input`, `// Past should be unchanged`); commented-out code — git remembers it for you
- **Prefer explaining _why_ a value or ordering is what it is over restating _what_ it is.** The explanation survives a change; the restatement silently stops being true

**Ticket references.** Prefixing a comment with `HEL-N` is worth doing — it is
how a future reader finds the discussion behind a decision. But **the id must
never carry the payload**: state the decision inline as well. Nothing downstream
resolves it for you, and a reader who cannot reach Linear (or reads this in a
diff, a PR review, or a code-search result) gets nothing from a bare pointer.

```scala
// Good — the reason survives without leaving the file
// HEL-364: mounted ahead of PanelRoutes so the literal "/panels/bound" path is
// never shadowed by PanelRoutes' `path(PanelIdSegment)`.

// Bad — the reader has to go somewhere else to learn anything
// See HEL-364.
```

**Section dividers** (`// ── Foo ─────`) are justified only in genuinely large
files — roughly 1,000 lines and up — where they measurably cut the cost of
finding a section. In a normal-sized file they are noise; if you feel you need
them to navigate, the file wants splitting instead (see the size budgets above).

**Tests are held to a stricter line than production code.**

- The test name carries the intent. If you need a comment to say what a test does, rename the test
- No step narration (`// Clear the input`, `// Restore original name`) and no restating an assertion in prose
- What _is_ worth a comment in a test: why a fixture has this particular shape, why an ordering matters, or why an assertion is deliberately loose

**Scaladoc / JSDoc** on exported and public surface is encouraged and exempt from
the brevity pressure above — it documents a contract for callers who will never
read the implementation.

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

### Documentation

Docs are read by operators tuning the thing they describe, so a wrong number there is a wrong decision later.

- Ground every factual claim about deployed or runtime configuration in the file that **sets** it — `.github/workflows/cd-*.yml`, `infra/deploy-backend.sh`, `application.conf` — and name that file in the text so the next reader can re-verify it
- **Separate what a ticket _describes_ from what it _asks for_.** A ticket's requirements are authoritative — that is the whole point of a ticket, and a value it tells you to set is the work, not an error to correct. But a value it states in passing as background is only what someone believed when they wrote it, and carries no more authority than any other prose. Repeating a described value into a doc without checking it against the repo is how a wrong number gets laundered into an authoritative-looking place
- If a described value and the repo disagree, that is a **question, not a verdict**: either the doc is stale, the repo drifted, or the ticket means to change it. Say which, and if you cannot tell, ask rather than silently picking one
- When a value moves, update every place that asserts it in the same change — `grep` for the old value, don't assume you know where it appears
- Prefer describing _why_ a value is what it is over restating the value. `max-instances` is capped because the privileged DB pool exhausts the instance's connection budget; that explanation stays true across a retune, the bare number does not

### Dependency & CVE hygiene

Dependabot cadence, the CI CVE gate (osv-scanner backend / audit-ci frontend),
the auto-merge policy, how to add a justified suppression, the SLA for new
alerts, and the manual triage runbook all live in
[`docs/dependency-management.md`](docs/dependency-management.md) — see that
doc rather than reading the workflow YAML directly.

## Pre-Commit Policy

Husky runs the following automatically on every commit — fix failures before pushing:

```bash
npm run lint               # ESLint (zero-warnings)
npm run typecheck          # tsc --noEmit against frontend/tsconfig.json
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

**Embedded-postgres test groups (HEL-924).** ~110 backend specs each start their own `EmbeddedPostgres` instance. `build.sbt` splits `Test / definedTests` into several forked-JVM groups (`hel924-group-N`) and caps how many run concurrently via `Global / concurrentRestrictions += Tags.limit(Tags.ForkedTestGroup, ...)`, so at most a handful of embedded Postgres instances start at once instead of one per suite in parallel — the earlier behavior could launch 100+ concurrently and produce spurious timeouts/failures unrelated to any code change (a different suite failing on every otherwise-identical re-run). Tune for a different machine via env vars before invoking `sbt test`:

```bash
HEL924_TEST_GROUP_COUNT=8 HEL924_TEST_GROUP_CONCURRENCY=4 sbt test   # defaults shown
```

If `sbt test` still produces a failure that a second, immediate, unchanged re-run does not reproduce, that is environmental flakiness, not a regression — re-run before trusting a red result, and consider lowering `HEL924_TEST_GROUP_CONCURRENCY` on a busier machine (e.g. several concurrent delivery worktrees).

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
- Verify config/topology facts against the repo before writing them into a doc, even when a ticket states them plainly. A claim inherited from a ticket has not been checked by anyone — see **Documentation**
- Never use `--no-verify` to bypass a real gate failure. The only acceptable use is an environmental hook breakage (e.g., Husky cannot resolve `.git` in a worktree), and even then the situation must be called out explicitly in the commit body

## Code of Conduct

This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md). Please read it before participating.
