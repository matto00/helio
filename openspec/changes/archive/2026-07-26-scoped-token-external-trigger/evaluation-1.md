## Evaluation Report — Cycle 1

### Phase 1: Spec Review — PASS
Issues: none.

- All 7 ticket acceptance criteria are addressed explicitly and none are reinterpreted:
  mint-with-scope (`ApiTokenService.create`/`RequestValidation`), documented trigger endpoint
  (`POST /api/hooks/run`), audit recording (`triggered_by_token_id` + existing run-history read
  path), backward compatibility (unscoped PATs unaffected, verified by dedicated parity test),
  401/403 semantics, ScalaTest coverage (all four listed scenarios present and passing), and the
  V74 migration applies cleanly (confirmed live — see Phase 2 test run).
- All 26 tasks.md items are checked and each maps to a verifiable diff hunk; no task claims
  something the diff doesn't show.
- No scope creep: `git diff main...HEAD --stat` shows only files the proposal/design/tasks name;
  HEL-624 was not touched.
- No regressions: `PipelineRunService.submit`'s existing owner/editor ACL gate, RLS policies, and
  every other call site of `submit`/`insertRun`/`executeRun` keep their default parameters
  (`triggerSource = Manual`, `triggeredByTokenId = None`), preserving old behavior byte-for-byte.
- Schemas updated in the same change as the code (`api-token`, `create-api-token-request`, two new
  `hook-run-*` schemas, `pipeline-run-record`), verified in sync by `npm run check:schemas`.
- Planning artifacts reflect the final implementation, including both self-flagged deviations
  (JSONB instead of `TEXT[]`; existence-check-before-active-run-check ordering) — both are
  documented in `files-modified.md` and consistent with what's actually in the diff.
- **Known limitation judgment** (`triggeredByTokenId` only populated for scoped-token triggers,
  not unscoped PATs): re-read against the literal ticket AC — AC "ScalaTest coverage" list does not
  require per-token audit for unscoped PATs, and "Each external trigger is recorded (token/user,
  timestamp, target, outcome)" is satisfied because the *user* is always recoverable via the
  pipeline's owner (the same audit granularity every other trigger path in this codebase has,
  since `pipeline_runs` has never carried a per-run `user_id` column — not a regression introduced
  by this ticket). The gap is honestly documented in three places (`files-modified.md`,
  `docs/agent-native.md`, and a dedicated `HookRoutesSpec` assertion) rather than silently
  papered over. Judgment: **acceptable, non-blocking scope boundary**, not a FAIL condition.

### Phase 2: Code Review — PASS
Issues: none blocking.

- **Deviation 1 (JSONB instead of native `TEXT[]`) verified functionally equivalent.**
  `V74__api_token_scope_and_run_audit.sql` adds `api_tokens.scoped_pipeline_ids JSONB`;
  `ApiTokenRepository.jsonbStringType` + `encodeScope`/`decodeScope` do the JSON array
  serialization at the domain boundary. This is an exact structural match to the pre-existing
  `AlertRuleRepository.jsonbStringType`/`condition` pattern (same `MappedColumnType.base[String,
  String]` identity mapping, same "mark the column type explicitly" rationale) — design.md's Risks
  section pre-approved exactly this fallback as "functionally equivalent, more code churn only,"
  and that holds: `NULL` semantics, allow-list membership checks, and read/write round-tripping are
  all unaffected by the storage representation change.
- **Deviation 2 (existence-check before active-run check) verified coherent, not a bug.**
  `HookTriggerService.trigger` checks `tokenScope` allow-list first (no existence probe possible —
  correct, scope rejection doesn't need to know if the id is real), then
  `pipelineRunService.pipelineExistsShared` (sharing-aware, owner/editor/viewer) before
  `hasActiveRunInternal`. Confirmed this closes a real existence leak: `hasActiveRunInternal`/
  `findActiveRunInternal` are ACL-bypassing lookups (mirroring the HEL-415 scheduler's own
  no-request-bound-user overlap guard) — calling them directly on an attacker-supplied
  cross-tenant `pipelineId` before an ACL check would let any authenticated caller learn whether an
  arbitrary pipeline currently has a run in flight, which conflicts with this codebase's
  "existence-not-leaked" 404 convention (`CONTRIBUTING.md`'s ACL triad section). The submitted
  ordering closes that leak and correctly returns 404 for pipelines the caller cannot access at all,
  while `submit`'s own owner/editor recheck downstream still gates viewer-grantee callers with 403 —
  verified end-to-end by `HookRoutesSpec`'s 404 test and `ApiTokenAuthSpec`'s parity tests.
- **`confineScopedToken` chokepoint genuinely wraps the entire three-way branch split** — confirmed
  by reading `ApiRoutes.scala` directly: `authDirectives.confineScopedToken { tokenScope => concat(
  pathPrefix("auth") {...}, optionalAuthenticate {...}, authenticate {...} ) }` sits between
  `requireCsrfHeader` and the `concat`, and there are exactly three branches under that `concat`
  (verified by reading the full block, lines ~213–363) — matching design.md's round-2 fix and
  closing the round-1 bug (confinement applied only inside `authenticate`, leaving
  `optionalAuthenticate`'s identical resolution chain open).
- **Required regression test genuinely exercises the round-1 bypass.**
  `ApiTokenAuthSpec`'s `"REQUIRED REGRESSION: reject a scoped token on GET
  /api/dashboards/:id/panels..."` test hits the real `ApiRoutes.routes` (not a stub), scopes the
  token to a pipeline *unrelated* to the dashboard under test (isolating the confinement mechanism
  from the pipeline allow-list check), targets a dashboard the token's own owner legitimately owns,
  and asserts 403. Manually traced: with `confineScopedToken` removed (or scoped only to the
  `authenticate` branch as round 1 did), this exact request would resolve via
  `optionalAuthenticate` → `PublicDashboardRoutes` → `AclDirective`'s owner-match branch → 200, so
  the test would genuinely fail without the fix. Confirmed correct.
- **Mint-time validation tightened to editor-or-owner, not viewer**, confirmed in
  `ApiTokenService.validateScope` (`findByIdOwned` then `findGrantRole(...) == Some("editor")`,
  explicitly NOT the broader `findByIdShared`) and covered by both a positive (editor-access) and
  two negative (no-access, viewer-only) tests in `ApiTokenAuthSpec`.
- **Segment-boundary matching verified correct** — `AuthDirectives.confineScopedToken` splits
  `extractUnmatchedPath.toString` on `/`, filters empty segments, and does exact `String` equality
  against `"hooks"` (not `startsWith`). Both `AuthDirectivesSpec` (unit, stubbed) and
  `HookRoutesSpec`/`ApiTokenAuthSpec` (integration) exercise this; `AuthDirectivesSpec` includes the
  explicit `/hooksomething` collision case.
- **Token hygiene unaffected**: no new logging of raw tokens; `findPrincipalByTokenHash` only ever
  returns the hash-resolved identity/id/scope, never the raw credential; the single
  reveal-on-create invariant in `CreateApiTokenResponse` is untouched.
- **CONTRIBUTING.md mechanical compliance**: `npm run check:scala-quality` passes clean (0
  violations; only pre-existing informational soft-budget warnings on files this ticket didn't
  touch). No inline FQNs found in any new/modified file (manually spot-checked
  `AuthDirectives.scala`, `HookTriggerService.scala`, `HookRoutes.scala`, `HookProtocol.scala` —
  all qualifiers are top-of-file imports). Per-domain JSON formatters correctly live under
  `com.helio.api.protocols` (`HookProtocol.scala`), with `JsonProtocols`/`package.scala` doing only
  the aggregator mix-in, per convention.
- **File-size note (non-blocking)**: `PipelineRunService.scala` was already 469 lines before this
  change (pre-existing, over the ~400-line "propose a split" threshold) and grew to 482
  (+13 lines, all necessary parameter threading). Not a new violation and the file-size check is
  explicitly informational only, but flagging since CONTRIBUTING.md asks for a split proposal when
  editing an already-oversized file — see Non-blocking Suggestions.
- **Tests are meaningful**, not padding: `HookRoutesSpec` covers every branch of
  `HookTriggerService.trigger` (in-scope success, out-of-scope 403, cross-user 404, duplicate
  collapse with a real row-count assertion, unscoped vs. scoped audit-field parity) end-to-end
  through the real `ApiRoutes`; `AuthDirectivesSpec` unit-tests `confineScopedToken` in isolation;
  `ApiTokenAuthSpec` proves the security-critical chokepoint under real RLS. All 2177 backend tests
  pass (fresh run, this session).
- **No dead code**: no TODO/FIXME, no unused imports found in the new/modified files.
- **No over-engineering**: `HookTriggerService` is deliberately thin (delegates the actual
  run-lifecycle logic to the pre-existing `PipelineRunService.submit`); no new idempotency-key
  system, no second ACL layer beyond the documented defense-in-depth double-check.

### Phase 3: UI Review — N/A
No `frontend/**` files in the diff (`git diff main...HEAD --stat -- 'frontend/**'` is empty), no
`schemas/**`/`ApiRoutes.scala`/`openspec/specs/**` UI-surface implication beyond the new backend
API contract, which has no frontend consumer in this ticket (by design — see design.md Planner
Notes: no token-management UI exists yet, so scope is API-only). Confirmed no UI-affecting trigger
applies.

### Overall: PASS

### Change Requests
None.

### Non-blocking Suggestions
- `PipelineRunService.scala` (482 lines, pre-existing at 469 before this change) has now crossed
  further past the ~400-line "propose a split in the PR description" guidance in CONTRIBUTING.md.
  Not introduced by this ticket, but worth a follow-up decomposition (e.g. extracting the
  `executeRun`/`runPipeline` private helpers into a dedicated internal class) before the next
  ticket adds to it.
- `schemas/pipeline-run-record.schema.json`'s description says `triggeredByTokenId` "is present
  when a PAT authenticated the triggering request" — slightly imprecise; it's only populated when
  a *scoped* PAT authenticated (per the documented known limitation). Consider tightening the
  schema description to match `docs/agent-native.md`'s more precise wording, to avoid misleading
  API consumers reading the schema in isolation.

### Verification evidence (fresh, this session)
- `npm run check:scala-quality` — clean (0 mechanical violations).
- `npm run lint` — clean (zero-warnings policy).
- `npm run format:check` — clean.
- `npm run check:schemas` — in sync (31 schemas checked).
- `npm run check:openspec` — reports "complete but not archived" only (expected at this phase, not
  a defect).
- `cd backend && sbt test` — 2177 tests, 0 failures, 128 suites completed, V74 migration applied
  cleanly during the embedded-Postgres bootstrap (`Successfully applied 74 migrations`).
