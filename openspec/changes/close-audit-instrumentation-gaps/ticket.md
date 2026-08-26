# HEL-840: Close the three remaining audit-instrumentation gaps (refresh paths, OAuth signup)

## Description

HEL-477's `route-audit-enumeration.md` walked every mutating route and flagged three gaps outside its named scope. All three are verified still open against `main` (9c1d63bf). They share one class and one fix pattern, so they are batched here; the fourth and most severe gap (`WorkspaceTeardownService.teardown`) was tracked separately as HEL-838 (already merged).

### 1. `AuthService.completeOAuth` never emits `auth.register` (the important one)

`completeOAuth` (`backend/src/main/scala/com/helio/services/auth/AuthService.scala:194`) calls `userRepo.upsertGoogleUser(...)`, which creates the account on first sign-in, then calls `auditLoginOutcome(user.id, outcome)`.

So the login is recorded but the account creation is not. `auth.register` is emitted at exactly one place in the codebase — line 119, the password-registration path.

Consequence: a user who signs up via Google has no audit record of their account ever being created. For a compliance-facing log that is a worse gap than a missing mutation.

The fix needs `upsertGoogleUser` to distinguish create from update so the caller knows whether this was a first-time signup — check whether the repository already returns enough to tell, and avoid a second round trip if it does.

### 2. `DataSourceService.refresh` unaudited

`backend/src/main/scala/com/helio/services/sources/DataSourceService.scala:544`. Fans out to `applyStaticRefresh`, `refreshCsv`, `refreshText`, `refreshPdf`, `refreshImage`. The service has 8 other `audit(...)` call sites, so refresh is an omission rather than a deliberate exclusion.

### 3. `SourceService.refresh` unaudited

`backend/src/main/scala/com/helio/services/sources/SourceService.scala:142`. Fans out to `refreshSql` and `refreshRest`. Same situation: 3 other `audit(...)` call sites in the file.

## What changes

Follow the established fire-and-forget pattern already used throughout these services (private `audit(...)` helper, `auditService: AuditService = null` no-op default). Both `refresh` methods already receive `user: AuthenticatedUser`, which post-HEL-483 carries `tokenId` and `source`, so actor attribution needs no new plumbing.

One row per `refresh` call at the public entry point (consistent with HEL-477 Decision 7's one-row-per-call rule for composite operations) — not one per per-kind private helper.

## Acceptance Criteria

- [ ] First-time Google OAuth signup writes an `auth.register` row in addition to the login row; a returning Google login writes only the login row (no spurious `auth.register`)
- [ ] `DataSourceService.refresh` writes exactly one audit row per call, for every source kind it dispatches to (static, csv, text, pdf, image)
- [ ] `SourceService.refresh` writes exactly one audit row per call, for both sql and rest
- [ ] Each row carries the correct actor id, acting token id and source, verified by integration test rather than unit-level assertion on the helper
- [ ] A failed refresh does not write a success row — the failure path is asserted explicitly
- [ ] `route-audit-enumeration.md`'s tracked-gaps section (or its successor) is updated so these three no longer read as open

## Scope discipline

Do not absorb anything else from `route-audit-enumeration.md`. Further gaps found during this ticket are recorded for the requester to triage, not fixed or filed here.
