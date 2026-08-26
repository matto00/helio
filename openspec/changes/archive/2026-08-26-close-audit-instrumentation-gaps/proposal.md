## Why

HEL-477's `route-audit-enumeration.md` flagged three mutation paths outside its own scope that
still write no audit trail today, verified open against main@9c1d63bf: Google OAuth signup (which
silently records only a login, never the account creation), and both refresh entry points
(`DataSourceService.refresh`, `SourceService.refresh`). All three follow the same established
fire-and-forget `audit(...)` pattern already wired everywhere else in these services — this is
closing an omission, not introducing new plumbing.

## What Changes

- `UserRepository.upsertGoogleUser` returns `Future[(User, Boolean)]` — the `Boolean` is
  `wasCreated`, computed from the existing `findByGoogleId` branch with no extra round trip.
- `AuthService.completeOAuth` emits `auth.register` (reusing the existing `audit(...)` helper and
  action name from the password-registration path) when `wasCreated`, in addition to the existing
  `auditLoginOutcome` call — never on a returning login.
- `DataSourceService.refresh` and `SourceService.refresh` each emit exactly one audit row per call,
  at the public entry point only, gated on a successful (`Right`) result — never for a failed
  refresh, never once per per-kind private helper.
- `route-audit-enumeration.md`'s tracked-gaps section updated to mark these three closed.

## Capabilities

### New Capabilities
(none)

### Modified Capabilities
- `audit-mutation-instrumentation`: adds OAuth-signup account-creation and both refresh-path
  requirements to the existing audit-instrumentation capability.

## Impact

- `backend/src/main/scala/com/helio/infrastructure/persistence/auth/UserRepository.scala` —
  `upsertGoogleUser` return-type change.
- `backend/src/main/scala/com/helio/services/auth/AuthService.scala` — `completeOAuth` conditional
  `auth.register` emission.
- `backend/src/main/scala/com/helio/services/sources/DataSourceService.scala` — one audit call at
  the `refresh` entry point.
- `backend/src/main/scala/com/helio/services/sources/SourceService.scala` — one audit call at the
  `refresh` entry point; widen the existing private `audit` helper to accept an `action` parameter
  (currently hardcoded to `data_source.create`).
- `openspec/changes/archive/.../route-audit-enumeration.md` (or its current successor location) —
  mark these three gaps closed.
- New/extended integration test coverage in `AuditMutationInstrumentationSpec.scala`, using the
  HEL-838 negative-assertion barrier technique for every "no row" assertion (fire-and-forget audit
  writes are otherwise unfalsifiable to assert against).

## Non-goals

- Any other gap surfaced by `route-audit-enumeration.md` beyond these three — recorded for the
  requester to triage, not fixed or filed here.
- `WorkspaceTeardownService.teardown` — already shipped as HEL-838.
