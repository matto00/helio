## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed at HEAD 2c1884ac5b2cc2578320ace4a21e37b32df5c603. Planning artifacts are untracked in the worktree.

### What I verified (with evidence)

- **Claim: the existing seed has a public viewer grant.** True. `NodePayloadWiringSpec.scala` inserts
  `resource_permissions (resource_type, resource_id, grantee_id, role) VALUES ('dashboard', $dashId, NULL, 'viewer')`
  next to the share token. It also hand-rolls SHA-256 at line 101 (`MessageDigest`, imported at line 28).
- **Claim: `authorizeResourceWithSharing` checks the token only when grant resolution denies.** True.
  `backend/src/main/scala/com/helio/api/http/AclDirective.scala:134-146`: when the caller is anonymous it calls
  `permissionRepo.hasPublicViewerGrant` first. `Success(true)` returns `provide(ResourceAccess.Viewer)` and
  `tokenAuthorizes` is never evaluated. The token is checked only on `Success(false)`. So a `?token=` 200 on the
  current public-grant seed would pass with any token. The design is right to call that version empty.
- **Anonymous baseline with no public grant.** `AclDirective.scala:142-143` answers with
  `complete(StatusCodes.NotFound, ...)`. That is a completion, not a rejection, so it does not fall through to the
  `authenticate` branch at `ApiRoutes.scala` ~889. The baseline will be `404`, never 200. The design's "assert the
  actual status, but assert NOT 200" holds.
- **The token path is wired in the full tree built from `dbContext` alone.**
  - `ApiRoutes.scala:274-275` builds `ShareTokenRepository` from `Option(dbContext)` and passes it to
    `ShareTokenValidatorImpl`.
  - `ApiRoutes.scala:295` passes `Some(shareTokenValidator)` into `AclDirective`.
  - `ApiRoutes.scala:879-881` mounts `PublicDashboardRoutes` under `optionalAuthenticate` with that `aclDirective`
    and `outputHistoryServiceOpt`.
  - The spec passes `dbContext = ctx`, so the token path is reachable.
- **The public `/history` route uses the directive with the token.** `PublicDashboardRoutes.scala` (the `history`
  pathPrefix block, ~line 411) calls `authorizeResourceWithSharing("dashboard", dashboardId, userOpt, ..., token)`
  and then `resolveHistory`.
- **`resolveHistory` and `resolvePanelOutput` resolve the seeded panel.**
  - `resolvePanelOutput` (line 191) uses `accessAlreadyGranted = true`, then `OutputPanel.outputId`, then
    `findByIdInternal`.
  - The seed sets `kind='output'` and `output_id = fx.optedOutput`, which already has one history point from the run.
  - `PublicOutputHistoryResponse` (`OutputHistoryProtocol.scala:48-57`) does include `points`, so task 1.3's "history
    points in the body" can be asserted.
- **Validator semantics.** `ShareTokenValidatorImpl.authorizes`:
  - It hashes with `TokenHashing.sha256Hex` and calls `findActiveByHash`, which uses `withSystemContext`, so RLS does
    not block the anonymous lookup.
  - It then requires `dashboardId == resourceId && isActive(now)`.
  - `isActive` (`model.scala:85`) is `revokedAt.isEmpty && expiresAt.forall(_.isAfter(now))`.
  - V101 makes `expires_at` and `revoked_at` nullable with no default, so the seeded row is active.
- **The planned mutation turns the positive control red.** If the stored hash is
  `sha256Hex(shareToken + "-broken")`, then `findActiveByHash(sha256Hex(shareToken))` returns `None`, `authorizes`
  returns false, and the directive answers `404`. With no public grant in phase A there is no other path to 200, so
  the positive control fails. The red is caused by the token alone.
- **Payload-path 401 still holds in phase A.** `/history/:pointId/rows` does not match the public `history` route's
  `pathEndOrSingleSlash`, so it is rejected and falls through to `authenticate`, giving 401. This does not depend on
  the grant, so the phase-A and phase-B 401 assertions are both sound.
- **`TokenHashing.sha256Hex(raw: String): String` exists** at
  `backend/src/main/scala/com/helio/infrastructure/crypto/TokenHashing.scala:15`.
- **Scope.** Every AC is covered:
  - shared helper: task 1.1
  - positive control: tasks 1.2 and 1.3
  - red and green evidence: task 1.5
  
  There is no drift beyond the one test file and no contract change (test-only, so `skip_specs` is right). The
  driver constraints (escalate if the control fails on main, no CI/Playwright/.gitignore edits) are restated in the
  proposal.

### Verdict: CONFIRM

### Non-blocking notes

- design.md Decision 2 says "e.g. non-empty `points`, or the `current` value". Prefer asserting `points` is non-empty
  (it exists on the public response). That is a stronger body check than `current`, which could be `null` if the
  summary carries no headline.
- The mutation breaks only the stored side, and both sides use the same helper. That cannot catch a defect in
  `TokenHashing` itself, but the ticket does not ask it to. If a second mutation is cheap, pointing the token at a
  different dashboard (wrong `dashboard_id`) would also show the `resourceId` check biting. Optional.
- Pin the baseline's exact status as `404` (from `AclDirective.scala:143`) rather than just "not 200", so a future
  change that turns the denial into a 5xx is also caught.
