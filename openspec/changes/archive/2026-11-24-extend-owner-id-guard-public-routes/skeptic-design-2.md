## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed HEAD 258f80434f11ca9c920f50c0d8777fcff967b278. The planning artifacts are untracked in the change dir. I checked them against the tree at that HEAD.

### What I verified (with evidence)

**Round-1 change requests**

- **CR1 (non-vacuous owner account): resolved.**
  - D2 now forbids the register path. It writes `owner@example.test` and a bcrypt hash directly against the distinctive id, using `UserRepository.insert(user, Some(hash))` or an update.
  - `UserRepository.insert` (UserRepository.scala:56) persists `UUID.fromString(user.id.value)`, so the fixed id survives. `AuthService.register` (AuthService.scala:126) still mints `UUID.randomUUID()`, so forbidding it is still necessary.
  - The positive controls are well-founded. `findByEmail` lowercases both sides through `EmailNormalizer.normalize` (UserRepository.scala:48-50), so a `findByEmail("OWNER@Example.Test")` check is meaningful.
  - Ownership of the upload, connector, token, history and insight data is now asserted through repository reads. This is restated as Standing Constraint C1.
- **CR2 (owner-entity mutations): resolved.** Every owner-bearing value D5 names exists in scope at the cited site:
  - Login wrong password: `case Some(user)`, then the hash `case Some(_)` (AuthService.scala:163-177).
  - Register conflict: the `case Some(_)` at line 116 can bind the found user.
  - Connector stranger and non-pending refusals: `Some(connector)` with `connector.ownerId` (ConnectorCompletionService.scala:107-109).
  - Upload: `ImageUpload` has `ownerId` (ImageUploadService.scala:72), and `PublicUploadRoutes` holds `upload` in the success branch.
  - History and insight: both resolvers hold `output: Output`, and `Output.ownerId` exists (model.scala:655-658; PublicPanelHistoryResolver.scala:33, PublicPanelInsightResolver.scala:23).
  - The literal fallback is limited to sites where no owner-bearing entity is in scope, and each `mutation-*.txt` must state its kind. This is restated as C2.
- **CR3 (structural check): resolved in substance.**
  - (a) The scan is limited to the mounted member, and identifier mounts are resolved through `private val x = new Class(...)`. The resolution chain matches ApiRoutes.scala:385, 888-894. The unauthenticated region ends at `authDirectives.authenticate {` (ApiRoutes.scala:957). The sibling classes are excluded: `ConnectorCompletionTokenRoutes`, `ConnectorPendingRoutes`, `AuthRoutes.logoutRoute` and `MfaRoutes.authenticatedRoutes`.
  - (b) An unresolvable construct must now fail loudly, and the "never a silent pass" claim is backed by that rule.
  - (c) Coverage is tied to the requests the spec actually issues, checked in both directions.
  - Task 3.2's mutation set covers all of these: a mounted path goes red, a non-mounted sibling stays green, a helper reference goes red, and an optional-auth mount goes red.
- **Round-1 non-blocking notes: all three adopted.** The mount-proof same-harness rule and the `Route.seal` wrapping are in D3. D5 commits the red output as a `.txt` file, not a red spec.

**Fresh checks for new defects**

- **Route inventory.** It matches ApiRoutes.scala:920-966. That covers `health.routes`, `auth.routes` (register, login), `oauth.routes` (`google`, `google/callback`), `mfaRoutesOpt.fold(reject)(_.verifyRoute)` (`mfa/verify`), `PublicDashboardRoutes` (now mounted with `Some(outputHistoryService)` and `Some(outputInsightReadService)`), `PublicUploadRoutes` and `ConnectorCompletionRoutes`.
- **The existing spec still builds `PublicDashboardRoutes` without the history and insight services** (PublicRouteOwnerIdLeakSpec.scala:108). D1/task 2.1's change is therefore needed, and it is correctly described.
- **The rate-limit risk is real and the mitigation is available.** `ApiRoutes` takes `rateLimitConfig: RateLimitConfig` (ApiRoutes.scala:237).
- **Harness precedent for D1 exists.** `new ApiRoutes(` already appears in `TwoUserRlsApiFixture`, `OutputInsightApiHarness`, `AskApiHarness` and others.
- **OAuth bad state and missing state** give a fixed 400 `ErrorResponse` before any Google call (OAuthRoutes `handleCallback`). The `google` start route redirects, and D3 checks its `Location` header.
- **Spec delta.** The MODIFIED requirement name matches openspec/specs/public-dashboards/spec.md:198. The original "Generic guard" scenario is kept. The two added scenarios have clear WHEN/THEN acceptance signals.
- **No placeholders and no TBDs.** Every ticket AC maps to a task: enumerate (D4, task 1.3), anonymous calls (2.1-2.5), mutations (3.1), structural check (1.3, 3.2), no behaviour change (3.3), backend tests only (Impact). The owner-ruled auth/health scope is covered by 2.4 and 2.5. Success bodies stay out.

### Verdict: CONFIRM

### Non-blocking notes

1. **D4(b) needs a concrete, typeless definition; the executor should settle it before writing the scanner.** Read literally, "any reference to another `Route`-valued identifier, helper method ... that is not a directive literal fails" cannot be decided from source text, and it would fail on today's code.
   - Mounted members already call `ServiceResponse.run/runWith/runNoContent`, `aclDirective.authorizeResourceWithSharing`, `OutputRowsQueryParsing.*`, `parseContentType` (PublicUploadRoutes) and `handleCallback` (OAuthRoutes). `handleCallback` is a private `def ... : Route` and a real route-position helper.
   - Suggested rule: apply the check only to expressions in route position, meaning the body of a directive block or an operand of `~`/`concat`.
   - Allowed in route position: a whitelisted directive application, or a whitelisted terminal (`complete`, `reject`, `redirect`, `onSuccess`/`onComplete` blocks, `ServiceResponse.*`, `setCookie`).
   - Anything else fails unless it is in the allow-table. The allow-table entry for `OAuthRoutes.handleCallback`/`completeOAuthExchange` must have its own body scanned.
   - Record the chosen rule in files-modified.md.
2. **Path patterns must be composed through nesting.** In `PublicDashboardRoutes`, `pathPrefix("dashboards"/Segment/"panels")` encloses `pathPrefix(Segment/"rows")`, which encloses `pathEndOrSingleSlash`. The ApiRoutes prefixes (`api`, `auth`) also apply.
   - The directly constructed `PublicDashboardRoutes` requests carry no `/api` prefix, while the `ApiRoutes`-driven ones do.
   - D4(c)'s matching must normalise the two, or one set will never match.
3. **MFA verify "bad code" has an owner-bearing entity in scope:** `challenge.userId` (MfaService.scala:142-147). Under C2 its mutation should plant `challenge.userId.value`, not the literal. D5's literal list names only "MFA bad challenge", which is correct for the unknown-challenge `InvalidCode` branch (line 151).
4. **Positive control via login:** if the owner has MFA enabled, a correct-password login returns a `challengeToken`, not the id. The `findByEmail` control is the one that proves the id. The login control proves the hash is wired, and it supplies the challenge needed for the bad-code case.
5. **Spec wording nit:** the exclusion sentence lists register, login and OAuth-callback success bodies, but not the MFA verify success body. "Error bodies of ... Google OAuth start" also loosely describes the redirect, which is a `Location` header, not an error body. Optional tidy-up.
