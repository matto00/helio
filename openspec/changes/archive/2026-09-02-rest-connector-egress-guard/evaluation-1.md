## Evaluation Report — Cycle 1 (evaluation-1.md)

Scope reviewed: `7ad8a2dc..3d5e0739` (impl commit `6b134228` + bookkeeping `3d5e0739`).

### Phase 1: Spec Review — FAIL

Verified PASS:

- AC1 (create/update rejection per address class) — `ConnectorEntityService.create`/`update` call
  `ContentSourceSupport.validateUrl` before persistence; `RestConnectorEgressGuardSpec` asserts all
  seven classes independently (loopback 127.0.0.1, link-local 169.254.169.254, RFC1918 10.0.0.5,
  IPv6 site-local fec0::1, IPv6 unique-local fd00::1, any-local 0.0.0.0, multicast 224.0.0.1) for
  both create and update, with a persistence/row-unchanged assertion each. Not one representative.
- AC2 (`/api/sources/infer` and `/api/sources/test`) — covered class-by-class via
  `SourceService.inferRest`/`testRest` (502-class `BadGateway` naming the address; `ok=false` with
  the reason), matching design Decision 8's specified channels.
- AC3 (DNS rebinding + pin) — `guardedPoolSettings` resolves once via `validateAndResolve` and
  builds `ContentSourceSupport.pinnedPoolSettings(pinnedAddress)`, which carries
  `pinnedTransport`. Probe-confirmed load-bearing (see Phase 2 mutation evidence).
- AC4 (redirect not followed) — explicit `code >= 200 && code < 300` in **both** issuers
  (`issueAndParse` line ~307, `issueTest` line ~336), replacing `status.isSuccess()` (which is true
  for 3xx in Pekko). Test asserts the error message contains `302`, so a revert to `isSuccess()`
  fails the test (confirmed by mutation).
- AC5 (enumeration recorded) — design.md Decision 6 table. Independently re-derived: `grep` for
  `singleRequest|superPool|outgoingConnection` across `backend/src/main/scala` returns exactly
  `RestApiConnectorDriver` (×2), `ContentSourceSupport` (×3), `OAuthRoutes` (×2),
  `HttpResendEmailSender`, `HttpClaudeTransport` (×4) — matches the table; no unlisted site.
- Guard placement (design Decision 2) — all four REST entry points funnel into `issueAndParse`
  (lines 276, 434) / `issueTest` (356, 441); the only pre-issuer bypass is `fetchOverride`
  (line 228 / 415), default `None` and unset at the sole production construction (`Main.scala`).
  No REST outbound path reaches a socket without passing the guard.
- Decision 1 refactor is behavior-preserving for `ContentSourceSupport`'s four existing callers:
  `validateUrl` now delegates to the renamed-public `validateAndResolve` (same body, same
  `Either`), `fetchUrl` calls `pinnedPoolSettings` (byte-identical settings chain, same
  `withTransport(pinnedTransport(...))`). No signature change on `validateUrl`/`fetchUrl`.
- Scope: no changes outside the ticket's surface; no frontend, schema or migration changes.

Issues:

1. **Tasks 5.2 and 5.3 are marked `[x]` but no observed result is recorded anywhere in the repo.**
   `grep -rn "Sleeper"` over the change dir returns only the task line and the skeptic's
   traceability note; there is no dev-database Connector/source count and no record of the live
   external-endpoint fetch. Ticket AC6 ("the disposition of any that fail is stated") and AC7
   ("verified against the live Sleeper endpoint") are evidence-bearing criteria, and the
   evaluator cannot verify them from an executor claim. `files-modified.md` documents the code
   thoroughly but records neither observation. (Task 5.1's enumeration and 5.4's follow-up tickets
   HEL-952/HEL-953 *are* recorded — 5.2/5.3 are the two gaps.)

### Phase 2: Code Review — PASS

Gates re-run independently by me in `WORKTREE_PATH` (not the executor's report):

- `cd backend && sbt test` → `Total number of tests run: 3605` / `Tests: succeeded 3605, failed 0`,
  exit 0. Frontend gates N/A — `git diff --name-only` shows no `frontend/**` file.

Mutation evidence (run in a throwaway detached worktree at `HEAD`, removed afterward) — the
specific "guard that passes its tests without guarding" failure mode was probed, not assumed:

- Mutant A (delete `.withTransport(pinnedTransport(...))` from `pinnedPoolSettings`): task 4.5
  fails with `Left("Request failed") was not equal to Right({"ok":true})`. The rebinding pin is
  genuinely load-bearing; the test cannot pass without it. (Nine unrelated failures in that mutant
  run were environmental — the scratch worktree lacked `backend/.env`'s `CONNECTOR_MASTER_KEY`;
  re-supplied for mutant B.)
- Mutant B (guard removed: `guardedPoolSettings` returns default unpinned settings unconditionally,
  `ConnectorEntityService`'s `validateUrl` replaced with `Right(())`, both issuers reverted to
  `status.isSuccess()`): **33 of 35** tests in `RestConnectorEgressGuardSpec` fail, including every
  address-class case for create/update/inferRest/testRest, the stored-Connector fetch-time case,
  4.5 and 4.6. The only two survivors are the intended positive-path cases. The spec is not
  vacuous.

Test-fixture audit (the widened-address-class hazard) — all **seven** modified pre-existing
fixtures verified independently, not spot-checked:

- `RestApiConnectorDriverSpec`, `RestApiConnectorDriverBodySpec`,
  `RestApiConnectorDriverConnectorResolutionSpec`, `RestApiConnectorDriverTemplatingSpec`,
  `RestSourceConnectorMigrationSpec`, `DataSourceRoutesSpec`, plus the new
  `RestConnectorEgressGuardSpec` — each defines the identical
  `(host, addr) => if (host == "localhost") false else ContentSourceSupport.isBlockedAddress(addr)`.
  Keyed on the hostname string only; every other host delegates to the real production denylist;
  `resolveHost` is left as real DNS in all of them. No class widened, no global test flag.
- `ConnectorEntityRoutesSpec`'s four edits are `api.example.com` → `example.com` (a hostname that
  actually resolves), not an `isBlocked` change — correctly not a widening.
- Every `RestApiConnectorDriver` construction in `RestConnectorEgressGuardSpec` omits
  `fetchOverride` (i.e. `None`, the default) — verified by reading all eight construction sites.
  So each assertion reaches the real issuer. `DataSourceRoutesSpec.stubConnector` does set
  `fetchOverride`, but its guard relevance is via `testConnectionEphemeral`, which does not consult
  it — consistent with design Decision 2's stated asymmetry (confirmed at lines 415 vs 441).

Quality: no inline FQNs; comments cite ticket/decision rather than restating code; no dead code
(the now-unused `poolSettings` val and `ClientConnectionSettings` import were removed); no `any`
equivalent / unsafe casts; error handling unchanged at the existing boundaries; no over-abstraction
(the seam reuses the existing `resolveHost`/`isBlocked` pair rather than inventing a second one).

### Phase 3: UI Review — N/A

No `frontend/**`, `schemas/**` or `openspec/specs/**` file changed. `com/helio/api/ApiRoutes.scala`
changed, but the trigger names `backend/src/main/scala/routes/ApiRoutes.scala` and the edit here is
pure constructor wiring — no route, status code or payload shape changes for any legitimate
destination. The only new user-visible behavior (a 400 on a hostile `baseUrl`) rides the existing
`ServiceError.BadRequest` rendering.

### Overall: FAIL

Narrowly. The implementation is correct and the guard is probe-confirmed load-bearing; the failure
is missing recorded evidence for two of the ticket's seven acceptance criteria.

### Change Requests

1. Record the task 5.2 result in the change directory (e.g. append an `## Evidence` section to
   `openspec/changes/rest-connector-egress-guard/files-modified.md`): the actual dev-database query
   used, the count of existing `connectors` rows (and URL-bearing `data_sources` rows) whose
   destination the new validation would refuse, and the explicit no-migration disposition from
   design.md Decision 7. State plainly that no production database was accessed. If the count is
   zero, say so — zero is a valid recorded observation; an unstated one is not.
2. Record the task 5.3 result in the same place: the exact live external endpoint fetched through
   the guarded path (the Sleeper API the epic uses), how it was exercised, and the observed
   outcome (status/JSON shape or a short excerpt). This is ticket AC7 and is currently supported
   only by a checked box.

Both are bookkeeping-only; no code change is expected, and the code as committed should not be
touched to satisfy them.

### Non-blocking Suggestions

- The `admitLocalhost` helper is copy-pasted verbatim into seven test files. Consider hoisting it
  to a shared test helper (e.g. `ContentSourceSupport`-adjacent test util) so a future weakening
  has one place to review rather than seven. Not blocking: each copy is currently identical and
  correctly keyed.
- `ConnectorEntityService.create` now validates the URL *before* `DataSourceKind.parseKind`, so a
  request with both an invalid kind and a disallowed URL now reports the URL error first. Harmless
  and both are 400s, but it is an unremarked ordering change.
- The suite now depends on real DNS resolving `example.com` (`ConnectorEntityRoutesSpec`,
  `RestConnectorEgressGuardSpec`'s permitted-baseUrl case). Fine on networked CI; injecting a fake
  resolver in those two spots would remove the network dependency.
