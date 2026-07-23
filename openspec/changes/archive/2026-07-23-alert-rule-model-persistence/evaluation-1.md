## Evaluation Report — Cycle 1

Commit evaluated: `e772232ca81f6c4d87bf853f29214ebd3b0c1b60` (branch
`feature/alert-rule-model-persistence/HEL-447`), plus the follow-up
handoff commit `452c2cbb`.

### Phase 1: Spec Review — PASS

Issues: none blocking.

- All ticket acceptance criteria addressed, none silently reinterpreted:
  - Rule shape round-trips create → fetch unchanged, including unknown
    `condition` keys — verified both in `AlertRuleServiceSpec`/
    `AlertRuleRoutesSpec` and by a fresh manual `curl` round-trip against a
    live server (see Phase 3).
  - Owner-scoped CRUD (403/404 on cross-user access) — verified in
    `AlertRuleRoutesSpec` and by live cross-user `curl` calls (404 on
    GET/DELETE for a second registered user).
  - Non-existent/non-owned `targetDataTypeId` on create → 422
    (`UnprocessableEntity`) — verified in tests and live.
  - `condition` persists as `jsonb`, unknown/extra keys survive — verified.
  - `sbt test`: 1533/1533 green (fresh run, see Phase 2).
- Task list (`tasks.md`, 25/25) matches what was actually implemented —
  spot-checked every section against the diff; no task claimed done that
  isn't reflected in code.
- No scope creep: all modified files are directly required by the ticket
  (domain model, migration, repo, service, routes, wire types, schemas,
  `RlsPolicyGuardSpec` allowlist entry, `ApiRoutes`/`Main` wiring). No
  unrelated refactors.
- No regressions to existing behavior: `ApiRoutes.scala`'s new
  `alertRuleRepo` constructor param is appended last with a `null` default
  and gated behind `Option(...).fold(reject)`, exactly mirroring
  `apiTokenRepo`/`imageUploadRepo` — existing fixtures that don't pass it
  are unaffected (confirmed: the full `sbt test` suite, including
  `ApiRoutesSpec`, passes unchanged).
- Schema/API contracts updated in the same change (`schemas/*.schema.json`
  three new files); `npm run check:schemas` confirms they're in sync with
  the Scala protocols.
- Planning artifacts (design.md/proposal.md/spec.md) reflect the final
  implementation faithfully — the "condition as opaque `JsValue`", "RLS
  mirrors V35", "`listEnabledByDataTypeInternal` has no caller yet" and
  "`comparator` lives inside jsonb, not a column" decisions are all
  implemented exactly as designed.

Minor spec-coverage gap (non-blocking, see Non-blocking Suggestions):
`AlertRuleRepositorySpec`'s `listEnabledByDataTypeInternal ... across
owners` test seeds both rules under the *same* owner (`owner1`), so it
doesn't actually exercise the "different owners" half of the
`alert-rule-persistence` spec's "Returns enabled rules across owners"
scenario, even though the RLS-bypass mechanism itself (`withSystemContext`)
is correct by inspection and identical to the already-proven
`DataTypeRepository.findByIdInternal` pattern.

### Phase 2: Code Review — PASS

Issues: none blocking.

- **Canonical code-quality compliance**: `npm run check:scala-quality`
  clean — zero inline-FQN violations across all new/modified files
  (mechanical check, fresh run). `AlertRuleId`/`Severity`/`Comparator`/
  `AlertRule` follow the `Role`/`DataTypeId` patterns exactly per
  CONTRIBUTING.md.
  - One soft-budget note: `domain/model.scala` grew from 382 → 458 lines,
    crossing CONTRIBUTING.md's documented ~400-line threshold ("propose a
    split in the PR description rather than adding to it"). The commit
    message doesn't call this out. This is explicitly informational-only
    per the script's own output ("File-size warnings ... are informational
    only") and 45+ other files in the repo already exceed the 250-line
    soft budget, so it is not a mechanical-check failure — flagged as a
    non-blocking suggestion below.
- **ACL triad (CONTRIBUTING.md)**: `findByIdOwned` used correctly for all
  mutation paths (update/delete) and the service's create-time
  `targetDataTypeId` ownership check (`dataTypeRepo.findByIdOwned`, not
  `*Internal`); `listEnabledByDataTypeInternal` is the correctly-chosen
  `findByIdInternal`-flavor privileged read, with the required inline
  justification comment at both the repository method and the RLS
  migration.
- **DRY**: reuses `DbContext.withUserContext`/`withSystemContext`,
  `ServiceError`, `ServiceResponse.run`/`runNoContent`, the `Role`-enum
  pattern, and the `DataSourceRepository`-style opaque jsonb column
  mapping — no reinvented plumbing.
- **Readable / modular**: each new file is small and single-purpose
  (repository 155 lines, service 156, routes 60, protocol 67); no magic
  values (comparator/severity are closed enums).
- **Type safety**: `condition: JsValue` end-to-end (no `Any`/`asInstanceOf`
  escape hatches); IDs wrapped in value classes at the route boundary via
  `AlertRuleIdSegment: PathMatcher1[AlertRuleId]`.
- **Security**: `condition` validated at the service boundary
  (`comparator`/`threshold` required + well-typed); ownership double-
  enforced (service check + RLS `FORCE ROW LEVEL SECURITY` policy);
  existence-not-leaked semantics honored (`None` → 404, never 403, per
  CONTRIBUTING.md's ACL triad note) — confirmed live (cross-user GET/DELETE
  both returned 404, not 403/200).
- **Error handling**: consistent `Either[ServiceError, _]` throughout;
  no silently-swallowed failures.
- **Tests meaningful**: 42 new ScalaTest cases across repository/service/
  route layers exercise the real regression surface (RLS scoping, absent-
  optional-field normalization, condition-shape validation, cross-user 403/
  404, cascade delete, 422 on bad target). These would catch a real
  regression in any of these paths.
- **No dead code**: no leftover TODO/FIXME; `check:scala-quality` and
  `eslint --max-warnings=0` both clean.
- **No over-engineering**: the shape mirrors `DataTypeService`/
  `DataTypeRoutes` exactly, nothing speculative added beyond what the
  ticket + design.md called for.
- **Behavior-preserving**: this is a greenfield addition; the only touches
  to existing files (`ApiRoutes.scala`, `Main.scala`, `JsonProtocols.scala`,
  `package.scala`, `IdParsing.scala`, `RlsPolicyGuardSpec.scala`) are
  additive wiring, confirmed non-breaking by the full green `sbt test` run.

**`git commit -n` bypass — confirmed structural, not masking a defect.**
Re-ran `npm run check:openspec` fresh: it reports exactly the same
"complete (25/25) but not archived" hygiene note the executor described,
and nothing else. All other pre-commit gates were re-run independently and
are clean (see command output below). This matches the documented
two-phase execute-then-archive workflow; archiving is correctly deferred to
delivery. Not a defect.

Fresh verification evidence (re-run independently, not taken from the
executor's report):

```
$ npm run check:scala-quality   → clean (49 pre-existing soft warnings, none from new files)
$ npm run check:schemas         → schemas in sync with JsonProtocols (13 checked across 19 protocol files)
$ npm run lint                  → clean (eslint --max-warnings=0)
$ npm run format:check          → All matched files use Prettier code style!
$ npm run check:openspec        → same single hygiene note as executor claimed (not-archived)
$ npm test                      → root: no tests, passWithNoTests; frontend: 115 suites / 1198 tests passed
$ cd backend && sbt test        → 1533/1533 tests passed, 0 failed, migrated to V60 cleanly
```

### Phase 3: UI Review — PASS

Triggers matched: `backend/src/main/scala/com/helio/api/ApiRoutes.scala`
and `schemas/**` changed. No frontend UI exists for this ticket (explicitly
out of scope), so this phase is a route-level/integration check.

**Environmental note (not a code defect):** the canonical
`scripts/concertino/start-servers.sh` failed to bring the backend up —
`nohup PORT=8527 CORS_ALLOWED_ORIGINS=... sbt run` fails because `nohup`
doesn't understand a `VAR=val` prefix as env-var assignment (only the shell
does); the log shows `nohup: failed to run command 'PORT=8527': No such
file or directory`, and the script correctly reported `FAIL backend did
not become healthy ... within 300s`. This is a **pre-existing regression on
`main`** (confirmed at `main`'s current tip `155a8b72`), unrelated to this
ticket's diff — a prior fix for exactly this bug (`391c987b "Fix
nohup+env-prefix breakage in start-servers.sh"`, inserting `env` between
`nohup` and `$cmd`) landed on main on 2026-07-01 but is no longer present
in the generated script (`concertino sync` appears to have regenerated it
without the fix). Recommend a follow-up ticket to reapply the `env` fix in
the Concertino template. To still obtain fresh Phase 3 evidence per the
verification-before-completion law, I started both servers manually with
correct env-var syntax (`PORT=8527 CORS_ALLOWED_ORIGINS=... nohup sbt
run`), confirmed healthy via `scripts/concertino/assert-phase.sh servers`
(`PASS servers`), and left them running healthy on 5620/8527 for downstream
phases.

Live route-level verification performed (fresh, this session):

- Login as `matt@helio.dev` → 200, session cookie set.
- `GET /api/alert-rules` (empty) → 200 `{"items":[]}`.
- `POST /api/alert-rules` with a valid body targeting an owned DataType,
  `condition` including an unknown `extra` key → 201, `enabled` defaulted
  to `true` (not supplied), `condition.extra` present unchanged.
- `GET /api/alert-rules/:id` and `GET /api/alert-rules` (list) → both
  return the created rule with `condition` unchanged, confirming the
  round-trip AC.
- `PATCH /api/alert-rules/:id` with `{"enabled": false}` → 200, only
  `enabled` changed, all other fields (including `condition`) unchanged.
- `POST /api/alert-rules` with a non-existent `targetDataTypeId` → 422.
- Registered a second user; `GET`/`DELETE /api/alert-rules/:id` for the
  first user's rule as the second user → 404 for both (not 403, not the
  rule contents — matches existence-not-leaked semantics), and the rule
  was confirmed still present/unmodified afterward.
- `DELETE /api/alert-rules/:id` by the true owner → 204, and a subsequent
  `GET` (by any user) confirms the row is gone.
- No console/log errors in the backend log across any of the above calls
  (only routine Spark/Flyway/SLF4J startup noise, unrelated to
  `alert-rules`).
- Frontend dev server (port 5620) confirmed healthy (200) — no frontend
  routes touch this feature, consistent with the ticket's "no frontend
  impact" scope, so no further browser-level checks apply.
- CSRF (`X-Helio-Requested-With`) and RLS (cross-user 404s) both behave as
  documented in `AuthDirectives.scala`/V60 migration — no bypass found.

### Overall: PASS

### Non-blocking Suggestions

- `domain/model.scala` crossed the CONTRIBUTING.md ~400-line soft-budget
  threshold (382 → 458 lines) without a split callout in the PR/commit
  description, as CONTRIBUTING.md asks for once a file you're editing
  crosses ~400 lines. Purely informational (script treats it as a soft
  warning, and dozens of pre-existing files already exceed 250 lines) —
  not required for this change, but worth a callout next time this file is
  touched, or splitting alert-domain types into their own file if HEL-455/
  HEL-466 add more to it.
- `AlertRuleRepositorySpec`'s `"listEnabledByDataTypeInternal bypasses
  per-owner RLS and returns rules across owners"` test seeds both sample
  rules under the same owner, so it doesn't exercise the literal
  "different owners" scenario from `specs/alert-rule-persistence/spec.md`.
  Since the repository doesn't enforce that `targetDataTypeId`'s owner
  matches the rule's owner, a second-owner rule could be seeded directly
  at the repository layer (bypassing the service's create-time check) to
  make this test genuinely cross-owner. Not blocking — the bypass
  mechanism (`withSystemContext`) is proven correct elsewhere in the
  codebase — but worth tightening before HEL-455 starts relying on this
  method in production.
- Separate from this change: `scripts/concertino/start-servers.sh` has
  regressed the `nohup env $cmd` fix from commit `391c987b` (now reads
  `nohup $cmd`, breaking any `VAR=val`-prefixed `CONCERTINO_*_START`
  command on Cloud Run/local dev). Worth a spinoff ticket so future
  evaluator/skeptic runs don't have to work around it manually.
