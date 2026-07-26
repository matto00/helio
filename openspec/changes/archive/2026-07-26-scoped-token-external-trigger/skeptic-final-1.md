## Skeptic Report — final gate (round 1)

### What I verified (with evidence)

1. **The chokepoint, end to end.**
   - `backend/src/main/scala/com/helio/api/ApiRoutes.scala:227-360`: `authDirectives.requireCsrfHeader { authDirectives.confineScopedToken { tokenScope => concat( pathPrefix("auth") {...}, optionalAuthenticate {...}, authenticate {...} ) } }` — confirmed by direct read that `confineScopedToken` wraps the lexical `concat` containing all three siblings, not just the `authenticate` branch (the round-1 bug). Only one route family (`HookRoutes`, line 349) consumes the extracted `tokenScope`; every other route class still takes a bare `authenticatedUser`.
   - `backend/src/main/scala/com/helio/api/AuthDirectives.scala:133-155` (`confineScopedToken`): read in full and traced all seven scenarios:
     - (a) anonymous, no cookie/header → falls to `case _ => provide(None)` — untouched.
     - (b) unscoped valid PAT (any route) → `findPrincipalByTokenHash` returns `Some((_, _, None))`, doesn't match the `Some(allowedIds)` pattern, falls to `provide(None)` — untouched.
     - (c) session cookie + unrelated scoped-PAT header → `case Some(_) => provide(None)` is checked *before* the `Authorization` header is even inspected — resolves via session.
     - (d) scoped PAT → `GET /api/dashboards/:id/panels` → first path segment is `dashboards`, not `hooks` → `complete(StatusCodes.Forbidden, ...)` before `optionalAuthenticate`/`PublicDashboardRoutes`/`AclDirective` ever run.
     - (e)/(f) scoped PAT → `POST /api/hooks/run` → first segment `hooks` → `provide(Some(TokenScope(...)))`; `HookTriggerService.trigger` (read in full) checks `tokenScope.exists(!_.allowedPipelineIds.contains(pipelineId.value))` → 403 out-of-scope, else delegates to `PipelineRunService.submit`.
     - (g) `/api/hooksomething` → `firstSegment` is `Some("hooksomething")`, `.contains("hooks")` is exact `Option` equality (not `startsWith`) → `false` → 403. Confirmed no prefix-match slip-through.
   - Cross-checked `AuthDirectivesSpec.scala` diff (unit-level, stubbed) — six new tests exercise exactly these branches including the `/hooksomething` case, and `ApiTokenAuthSpec.scala` exercises the same through the real `ApiRoutes` (see #2).

2. **Required regression test** — found and read `ApiTokenAuthSpec.scala:503-515` ("REQUIRED REGRESSION: reject a scoped token on GET /api/dashboards/:id/panels..."). Confirmed `routes` (line 143 of the same file) is `new ApiRoutes(...)` — the real route tree, not a stub. The test scopes the token to a pipeline unrelated to the dashboard under test (isolating the confinement mechanism from the pipeline allow-list) and asserts `403`. Manually traced: with `confineScopedToken` removed or scoped only to `authenticate`, this request resolves via `optionalAuthenticate` → `PublicDashboardRoutes` → `AclDirective`'s owner-match → `200` — so the test is a genuine regression guard, not a tautology. Sibling parity test (line 517) confirms an unscoped PAT still gets 200 on the same route, and a third test (line 527) confirms session-cookie precedence over an attached scoped-PAT header.

3. **Token hygiene** — `git diff main...HEAD -- backend/src/main` grepped for `println`/`System.out`/`log.*token`: no hits. `findPrincipalByTokenHash` (`ApiTokenRepository.scala:57-68`) only returns hash-resolved identity/id/scope, never the raw credential. The single reveal-on-create in `CreateApiTokenResponse` (`ApiTokenService.scala:59-69`) is the only place `rawToken` appears in a response, unchanged in shape.

4. **Two self-flagged deviations** — independently judged:
   - JSONB instead of `TEXT[]` (`V74__api_token_scope_and_run_audit.sql`): read the migration and its comment — correctly explains the plain `slick`/`slick-hikaricp` dependency (no `slick-pg`) lacks a `JdbcType` for SQL arrays, and JSONB + `jsonbStringType` is the codebase's existing pattern (`AlertRuleRepository.condition`). Sound, low-risk, matches design.md's own pre-approved fallback.
   - Existence-check-before-active-run-check ordering (`HookTriggerService.trigger`, read in full): calls `pipelineRunService.pipelineExistsShared` (sharing-aware ACL, owner/editor/viewer) before `hasActiveRunInternal`/`findActiveRunInternal` (which are ACL-bypassing lookups). This is the correct order — checking the ACL-bypassing lookup first on an attacker-supplied cross-tenant `pipelineId` would leak whether an arbitrary pipeline has a run in flight. Agree with the ordering; `submit`'s own owner/editor recheck (`PipelineRunService.scala:90-102`) still gates viewer-grantee callers downstream.

5. **Reuse of HEL-340's run-invocation path** — confirmed `HookTriggerService.submitNewRun` calls `pipelineRunService.submit(pipelineId, isDry = false, user, triggerSource = TriggerSource.External, triggeredByTokenId = tokenScope.map(_.tokenId.value))` — the same `submit` used by `PipelineRunSubmitRoutes` and `PipelineSchedulerService`. No parallel run-invocation path exists.

6. **Verification gates, run fresh by me:**
   - `cd backend && sbt test` → V74 migration applied cleanly during embedded-Postgres bootstrap ("Successfully applied 74 migrations... now at version v74"); **2177 tests, 0 failures, 128 suites**, "All tests passed." (86s, no hang).
   - `npm run lint` → clean (zero-warnings policy, exits with no output = clean).
   - `npm run format:check` → "All matched files use Prettier code style!"
   - `npm run check:schemas` → "schemas in sync with JsonProtocols (31 checked across 27 protocol files)".
   - `npm run check:openspec` → reports "complete but not archived" only, as expected at this phase.
   - All figures match the evaluator's claims in `evaluation-1.md`; independently reproduced, not merely trusted.

7. **V74 is genuinely the next free migration number** — `ls backend/src/main/resources/db/migration/ | sort -V | tail -8` shows `V73__add_resource_tag.sql` then `V74__api_token_scope_and_run_audit.sql`, no gap or collision.

8. **Mint-time validation tightened correctly** — `ApiTokenService.validateScope` (`ApiTokenService.scala:77-98`) checks `findByIdOwned` then `findGrantRole(...) == Some("editor")`, explicitly not `findByIdShared`/viewer. Matches design.md Decision 1's round-1 skeptic finding.

9. **No frontend changes** (`git diff main...HEAD --stat` confirms no `frontend/**` files touched) — Phase 3/UI review correctly N/A, nothing for me to screenshot.

### Genuine defect found: spec/code mismatch (non-blocking, but a real inaccuracy)

`openspec/changes/scoped-token-external-trigger/specs/external-run-hooks/spec.md:63-67` ("Requirement: External triggers are recorded for audit") states unconditionally: *"Every run started by `POST /api/hooks/run` SHALL be recorded with the id of the token that authenticated the request (when PAT-authenticated)..."* — no qualifier limiting this to scoped tokens.

The actual implementation only threads `triggeredByTokenId` for **scoped** tokens. Confirmed directly: `HookRoutesSpec.scala:161-188` triggers with an **unscoped** PAT and explicitly asserts `records.head.triggeredByTokenId shouldBe None` (line 188) — i.e., the codebase's own test proves the literal spec requirement as written is false for the unscoped-PAT case. Root cause is `AuthDirectives.confineScopedToken` only ever extracting `TokenScope` (which carries the token id) for a row with a non-null `scoped_pipeline_ids`; an unscoped PAT never produces a `TokenScope`, so `HookTriggerService` never learns its token id.

This is honestly and precisely documented in `docs/agent-native.md:92-99` ("When a **scoped** token authenticated the trigger, the run record also carries `triggeredByTokenId`... An unscoped PAT can call the hook too... but its `triggeredByTokenId` is absent") and in `files-modified.md`'s "Known limitation" section — both correctly hedge the claim. Only the openspec **spec delta itself** — the artifact that becomes the canonical, normative `specs/external-run-hooks/spec.md` upon archive — fails to hedge it. A future reader of the archived spec (or an agent implementing against it) would reasonably expect per-request token attribution for any PAT-authenticated trigger, which is not what ships.

This does not affect any ticket.md acceptance criterion (the AC says "recorded (token/user, timestamp, target, outcome)" — the *user* is always recoverable via the pipeline owner, matching every other trigger path in this codebase, which the evaluator correctly reasoned through), and it is not a security or auth-bypass issue — no privilege escalation, no bypass, just an overpromising normative sentence in an internal planning artifact. `evaluation-1.md`'s own non-blocking note already flags the sibling issue in `schemas/pipeline-run-record.schema.json`'s description, but did not catch that the openspec spec.md **Requirement** text (a `SHALL`, not just descriptive prose) has the same defect in a more binding location.

### Verdict: CONFIRM

No auth-bypass, privilege-escalation, or security regression found. The round-1 design-gate gap is genuinely closed; the chokepoint wraps the entire three-way branch split as designed; the required regression test is real and would catch a regression; token hygiene, mint-time validation, run-invocation reuse, and migration numbering are all sound. All verification gates were re-run fresh by me (not merely trusted) and are green.

### Change Requests
None required to ship. The one real defect found (below) is a documentation-precision issue in an internal planning artifact, not a code, security, or AC defect — recommending it as a non-blocking fix rather than blocking delivery.

### Non-blocking notes
1. Before archiving, tighten `openspec/changes/scoped-token-external-trigger/specs/external-run-hooks/spec.md`'s "External triggers are recorded for audit" requirement (and its "Run history exposes the triggering token" scenario) to explicitly say "when a **scoped** token authenticated the trigger" rather than the unqualified "(when PAT-authenticated)" — matching the precise wording already used in `docs/agent-native.md` and the codebase's own `HookRoutesSpec` assertion (`triggeredByTokenId shouldBe None` for unscoped-PAT triggers). This keeps the archived spec accurate for future readers/implementers.
2. `schemas/pipeline-run-record.schema.json`'s description has the identical imprecision, already flagged non-blocking by the evaluator — fix both in the same pass.
3. `PipelineRunService.scala` is now 482 lines (pre-existing 469 before this ticket), past the ~400-line CONTRIBUTING.md soft-split threshold — not introduced by this ticket, worth a follow-up decomposition, as the evaluator already noted.
