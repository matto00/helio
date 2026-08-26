## Skeptic Report — final gate (round 1, skeptic-final-1.md)

### What I verified (with evidence)

- **Diff is the whole change.** `git diff main...HEAD --stat` on b70f975a: 4 main-source files
  (UserRepository, AuthService, DataSourceService, SourceService), 2 test files, the archived
  `route-audit-enumeration.md`, and the change dir. No unrelated files, no frontend paths.

- **AC 1 (OAuth signup).** `UserRepository.upsertGoogleUser` now returns `Future[(User, Boolean)]`
  with `false` on the `Some(existingUser)` update branch and `true` on the `None` insert branch —
  no extra round trip. `AuthService.scala:200` `if (wasCreated) audit(Some(user.id), "auth.register")`
  reuses the same private helper and action string as the password path (`:119`).
  `grep -rn upsertGoogleUser backend/src` → definition + exactly one call site; no missed caller.

- **AC 2/3 + "one row per refresh call, not per per-kind helper".** Read both entry points:
  `DataSourceService.scala:569-574` and `SourceService.scala:152-157`. In both, the `.map` is
  attached to the *whole* dispatch `match` result (which itself hangs off
  `dataSourceRepo.findByIdOwned(...).flatMap`), so it fires exactly once per public call regardless
  of arm. No per-kind private helper (`applyStaticRefresh`/`refreshCsv`/`refreshText`/`refreshPdf`/
  `refreshImage`/`refreshSql`/`refreshRest`) was edited — confirmed by the diff.

- **SourceService resourceId is `sourceId.value`, not `DataType.id`.** `SourceService.scala:154`:
  `audit(Some(sourceId.value), user, "data_source.refresh")`; the pattern is `case r @ Right(_)`,
  which does not even bind the returned `DataType`, so misuse is structurally impossible here.
  Matches design.md's skeptic-round-1 correction. `resource_type` stays `"data_source"` via the
  existing helper.

- **AC 5 (failure writes no success row).** Both `.map` blocks fall through `case l => l` on `Left`;
  there is no error-path audit call anywhere in the diff.

- **Negative-assertion barrier used correctly in every "no row" test.** I read all five:
  - `AuditMutationInstrumentationSpec` failed-static-refresh: barrier is a *successful* refresh of
    the same source, `eventuallyAuditRows` on it first, then `count == 1` for that source id — had
    the failed call audited, the count would be 2. Falsifiable.
  - failed-CSV-refresh, failed-sql-refresh, failed-rest-refresh: barrier is a successful refresh of
    a second source through the same audit service/repo, `eventuallyAuditRows` on the barrier row,
    then `count == 0` for the source under test. Falsifiable (an unconditional audit would yield 1).
  - `GoogleOAuthRoutesSpec` returning-login: barrier is a real `AuthService.register` of a fresh
    user, drained via `eventuallyAuditRows`, then `count == 1` (not 0 — the first-time signup's own
    row) of `auth.register` for the OAuth user. A spurious second row would make it 2. Falsifiable.
  No test asserts a zero/one count immediately after the call under test.

- **GoogleOAuthRoutesSpec's new fixtures weaken nothing.** `makeAuthService` gained
  `withAudit: Boolean = false`; all 14 pre-existing call sites (lines 155–523) call it without that
  arg, so they still construct `AuthService(..., auditService = null)` — byte-identical behaviour.
  `cleanDb()`'s `TRUNCATE` list is unchanged (only a comment added explaining why `audit_events`,
  which is append-only per HEL-471, cannot join it); rows are filtered per-test by random-UUID
  actor id, so cross-test bleed is not possible. No test was skipped, renamed or relaxed.

- **Gates re-run by me, fresh, output read** (not taken from the evaluator's narrative):
  `sbt -batch 'testOnly com.helio.api.AuditMutationInstrumentationSpec
  com.helio.api.routes.auth.GoogleOAuthRoutesSpec com.helio.services.auth.AuthServiceSpec'`
  → `Tests: succeeded 58, failed 0` — all 8 new refresh cases, both new OAuth cases, and every
  pre-existing case in those three suites green.
  `npm run check:scala-quality` → `clean (135 soft warning(s))` (all pre-existing file-size notes).
  `npx openspec validate close-audit-instrumentation-gaps --strict` → valid.

- **AC 6 (doc).** `openspec/changes/archive/2026-08-26-instrument-audit-mutations/route-audit-enumeration.md`
  tracked-gaps items 1 and 2 now read "Closed (HEL-840)", item 3 "Closed (HEL-838)", with the
  recommendation paragraph replaced by "All three gaps tracked here are now closed". Verified in the
  diff, not from the report.

- **No UI.** Zero `frontend/**` paths in `git diff --name-only main...HEAD`, so the design-standard /
  screenshot pass does not apply and no dev server was started.

### Verdict: CONFIRM

### Non-blocking notes

- AC 4 names "acting token id" among the fields to verify. The refresh tests assert `actorUserId`,
  `resourceType` and (for the static case) `source == "ui"`, but never `actorTokenId`. This is
  acceptable rather than a defect: both refresh call sites go through the *same* private
  `audit(...)` helpers that already thread `user.tokenId`/`user.source`, and that threading is
  already covered end-to-end by the pre-existing PAT-attribution cases in the same spec
  (`...via a PAT bearer with source=pat and the resolving token's id`). A PAT-driven refresh case
  would close the AC literally, if someone wants it later.
- `route-audit-enumeration.md`'s enumeration table (line 48) still lists `AuthService.completeOAuth`
  as producing only `auth.login` / `auth.login.challenged`; it now can also produce `auth.register`.
  That row is a point-in-time archived enumeration, not the tracked-gaps section the AC names, so
  this is cosmetic.
