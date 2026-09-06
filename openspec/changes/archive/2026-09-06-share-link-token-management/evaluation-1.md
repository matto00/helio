## Evaluation Report — Cycle 1 (evaluation-1.md)

Commit reviewed: `437d628f` on `feature/share-link-token-management/HEL-590`.
All gate results below are from my own fresh runs, not the executor's report.

### Gate chain (re-run independently, in WORKTREE_PATH)

| Gate | Result |
| --- | --- |
| `npm run lint` | PASS |
| `npm run typecheck` | PASS |
| `npm run format:check` | PASS |
| `npm run check:schemas` | PASS (77 schemas / 49 protocol files in sync) |
| `npm run check:openspec` | PASS ("complete but in flight") |
| `npm run check:scala-quality` | PASS ("clean", 157 pre-existing soft warnings, none new-file) |
| `npm run check:no-credential-leak` | PASS (0 violations, 6058 files) |
| `npm test` | PASS (258 suites / 2667 tests; mcp 24/238) |
| `cd backend && sbt test` | PASS (263 suites, 3930 tests, 0 failed) |

### Independent verification of the six named items

**1. Token fallback ordering — VERIFIED CORRECT.** `AclDirective.scala:110-146`: the token is
consulted on *both* denial arms (`Success(None)` from `findGrant` → 403 arm, line 116-125;
`Success(false)` from `hasPublicViewerGrant` → 404 arm, line 128-140). Owner (line 109) and
Editor/Viewer grantee (lines 113-117) short-circuit before `tokenAuthorizes` is ever called, so no
downgrade is possible. The token path introduces **no new `complete(...)`, status, or message** — both
`false` branches reuse the exact `ErrorResponse("Forbidden")` / `ErrorResponse(notFoundMessage)`
literals the arm already produced. `ShareTokenAuthenticatedAccessSpec` covers all four cases.

**2. CSPRNG and storage — VERIFIED CORRECT.** `ShareTokenService.scala:100-108`: `new SecureRandom()`,
32 bytes, `Base64.getUrlEncoder.withoutPadding()`. No `scala.util.Random` / `Math.random` /
UUID-as-secret / id-derived value anywhere in the token path (the only `UUID.randomUUID()` is the row
*id*, not the secret). Only `TokenHashing.sha256Hex(rawToken)` reaches `ShareToken.tokenHash`; the
`share_tokens` table has no plaintext column; the raw value appears exactly once, in
`CreateShareTokenResponse`. No logging statement exists in any file on the token path.

**3. Pool assignment — VERIFIED CORRECT and genuinely exercised.** `ShareTokenRepository.scala`:
`insert`/`findByDashboard`/`revoke` → `ctx.withUserContext(...)`; only `findActiveByHash` →
`ctx.withSystemContext` with the required inline justification comment. Zero raw `db.run`. I proved
the RLS policy is load-bearing rather than ceremony by mutating `revoke` to `withSystemContext` and
re-running `ShareTokenRlsSpec` — "revoke (app pool, owner-scoped) is a no-op against another owner's
token" went **red**. Restored afterwards; working tree is clean.

**4. RLS harness is not vacuous — VERIFIED.** `ShareTokenRlsSpec` builds two genuinely distinct
pools (`SET ROLE helio_app_test`, NOSUPERUSER, vs `SET ROLE helio_privileged`), never
`new DbContext(db, db)`. The liveness test asserts a **positive** read (`rows should contain
token.id`) before any negative assertion, and every negative case is paired with a positive control
(`findByDashboard(dashA, ownerA) should not be empty`, `revoke(tokenA.id, ownerA) shouldBe true`), so
an empty result cannot pass as success. The mutation in item 3 confirms it fails loudly.

**5. Evidence quality — VERIFIED, mutation 4 reproduced.** I changed the invalid-token exit in
`AclDirective.scala` (anonymous arm, `tokenAuthorizes = false`) to
`ErrorResponse("MUTANT: invalid share token")` and ran
`testOnly com.helio.api.routes.dashboards.ShareTokenPublicAccessSpec`:
`- should expired, revoked, nonexistent, and wrong-resource tokens ... byte-identical status and body
*** FAILED ***`. The test discriminates. Both mutations were reverted; `git status` clean.

I also confirmed indistinguishability **live** against the running backend (not just in tests): valid
token → `200`; bad token, no token, and nonexistent dashboard id all → `404
{"message":"Dashboard not found"}`, byte-identical.

**6. Migration — VERIFIED, with one gap (see CR5).** `V101__share_tokens.sql` is the correct next
number (main is at V100), has not been edited post-application, and follows the V92 owner-only idiom
exactly (single `USING`, no `WITH CHECK`, `ENABLE` + `FORCE ROW LEVEL SECURITY`, indexed policy
column). `RlsPolicyGuardSpec`'s allowlist was updated. No flyway history inconsistency was
encountered. Gap: no explicit `GRANT ... TO helio_privileged` — see CR5.

**7. Adjudication of the `requireOwnerOnly` 403/404 flag — see "Adjudication" below.**

---

### Phase 1: Spec Review — **FAIL**

The backend half of this change matches the plan closely and is well built. The failures are all on
the **frontend / UI-spec** side, plus one API-spec scenario the shipped code contradicts.

Issues:

1. **The minted share URL does not work.** `DashboardShareDialog.tsx:44-46` composes
   `${window.location.origin}/dashboards/${id}/panels?token=${token}`. There is no such route in
   `AppRoutes.tsx` (there is no public dashboard-viewer route at all), and the path lacks the `/api`
   prefix, so it is not the API endpoint either. Verified live: fetching the URL the dialog produced
   returns `200 text/html` — the SPA `index.html`, which client-side routes to `NotFoundPage`.
   Adding `/api` makes it return raw JSON (`{"items":[],...}`), which is also not a shareable page,
   and in production the API is a different host entirely. A recipient of this link sees Helio's 404.
   AC "An owner can mint a share link … revoked/expired links stop authorizing access" is only half
   met, and `share-link-management-ui` "Scenario: Mint and copy" is met only literally (a URL is
   displayed) and not substantively.

2. **Creation time is never displayed.** `share-link-management-ui` "Scenario: Status is visible per
   link" requires each link to show "its creation time, its expiry or an explicit indication that it
   never expires, and whether it is active, expired, or revoked". `createdAt` is on the wire
   (`ShareTokenResponse`, `shareToken.ts`) but `DashboardShareDialog.tsx:180-193` renders only the
   `StatusChip` and the expiry. Confirmed in the browser.

3. **Revoke removes the row instead of showing "Revoked".** `shareTokensSlice.ts:168` does
   `s.items = s.items.filter((t) => t.id !== tokenId)`. Spec "Scenario: Revoke from the list" says
   "the link's **displayed state becomes revoked** without requiring a manual page reload". Verified
   live: after confirming a revoke the row disappears and the dialog shows the empty state
   "No share links yet" — which is factually false (the revoked link still exists); reopening the
   dialog refetches and shows it as "Revoked", directly contradicting what was just displayed.

4. **Management routes leak dashboard existence.** `share-link-management-api` "Scenario: Management
   routes do not reveal other tenants' dashboards" is asserted by the shipped spec delta but is not
   the shipped behavior: `AccessChecker.requireOwnerOnly` returns `Forbidden` for a real-but-unowned
   dashboard and `NotFound` for an absent one, and `ShareTokenOwnershipSpec` (lines 126-176)
   *codifies* the 403. See Adjudication.

5. **Focus is not returned to the invoking control on dismiss.** `share-link-management-ui`
   "Scenario: Focus management". Verified live: after clicking "Done", `document.activeElement` is
   `BODY`. `shared/ui/Modal.tsx` focuses the title on open but implements no focus restore on close.

6. **The surface is unreachable at the narrowest supported width.** `share-link-management-ui`
   "Scenario: Narrow viewport". `DashboardShareDialog` is rendered as a DOM child of `DashboardList`
   (`DashboardList.tsx:444-452`) and `Modal` is not portaled, so at 430px the whole dialog sits
   inside `.app-sidebar { display: none }` and measures 0×0 (verified via `getBoundingClientRect`).
   The "Share" action itself is also absent at 430px — it was added only to the sidebar
   `ActionsMenu`, and the mobile dashboard-switcher sheet exposes no per-dashboard actions menu, so
   there is no mobile entry point at all.

Not an issue: task list, scope discipline (no drive-by refactors), and schema/spec artifacts are
otherwise consistent; `schemas/dashboards/*.schema.json` pass the drift gate against the new Scala
case classes.

### Phase 2: Code Review — **FAIL**

The backend is high quality: single-exit denial, structural indistinguishability, correct pool
assignment, non-vacuous RLS harness, no dead code, no over-engineering, real error handling at
boundaries, meaningful and mutation-verified tests. Issues:

1. **`shareTokenValidator: ShareTokenValidator = null`** (`AclDirective.scala:31`) — a `null` default
   in the constructor of a security-critical directive, unwrapped via `Option(...)` at line 90. If a
   future call site ever forgets the argument the token path silently degrades to "never authorizes"
   with no compile error and no runtime signal. `Option[ShareTokenValidator] = None` expresses the
   same optionality in the type system and is what the surrounding code (`Option(apiTokenRepo)`,
   `pipelineRootRepoOpt`, `ShareTokenValidatorImpl(repoOpt)`) already does one layer away.

2. **`ShareTokenRepository.revoke` scopes to owner *only* via RLS** (line 79-85): the query filters on
   `id` alone. This is correct in production, but this repo's own documented reality is that dev and
   CI connect as a superuser and therefore *bypass RLS entirely* — in those environments any owner
   can revoke any other owner's token by id through `DELETE /api/dashboards/<own-id>/share-tokens/<other-id>`
   (`requireOwnerOnly` only checks the dashboard in the path, never that the token belongs to it).
   Adding `.filter(_.userId === UUID.fromString(userId.value))` alongside the id filter is a one-line
   defence-in-depth that removes the environment dependence and costs nothing; the RLS spec stays
   just as meaningful. (Note the same query also lets an owner revoke their own token through a
   *different* dashboard's path — harmless, but the added filter plus a `dashboard_id` filter closes
   both.)

3. **`V101` issues no explicit `GRANT` to `helio_privileged`,** yet `findActiveByHash` — the anonymous
   validation path, i.e. the entire feature for its intended audience — reads on the privileged pool.
   V38's `ALTER DEFAULT PRIVILEGES` most likely covers it, but `V100`'s own header records that
   "V60/V61/V75/V91/V94 all still issue explicit grants rather than relying solely on the
   default-privilege path" and follows that belt-and-braces convention deliberately. `ShareTokenRlsSpec`
   cannot catch a gap here because its fixture issues `GRANT ... ON ALL TABLES IN SCHEMA public TO
   helio_privileged` itself. Given this repo's three prod-only RLS/grant incidents, the explicit grant
   is warranted. **V101 has already been applied to the shared dev database** (I exercised the feature
   against it), so this must go in a *new* migration, never as an edit to V101.

4. Minor: inline FQNs in new code — `java.time.format.DateTimeParseException`
   (`ShareTokenService.scala:93`), `java.sql.Timestamp` (`ShareTokenRepository.scala:90-92`). The
   `check:scala-quality` gate passes, but CONTRIBUTING.md:70 is unconditional. Non-blocking.

### Phase 3: UI Review — **FAIL**

Servers started cleanly (`start-servers.sh` READY, `assert-phase.sh servers` → `PASS servers`).

Works: dialog opens from the dashboard `ActionsMenu`; empty state uses the shared `EmptyState`;
create with no expiry and create with a `datetime-local` expiry both succeed; the one-time reveal
shows the secret with the "won't be shown again" copy; Copy fires and toasts; Revoke goes through
`ConfirmInline` (never `window.confirm`) with Confirm/Cancel; the reopened list renders `StatusChip`
with real text labels ("Active" / "Revoked"), never colour alone; `DashboardShareDialog.css` uses
`--app-*` tokens throughout with no hardcoded colours, `min-height: 44px` on every interactive
control, and a `430px` media query; no console errors during any flow (the three console errors
observed were my own deliberate 404 probes).

Fails: items 1, 3, 5 and 6 of Phase 1 above — a dead share URL, a post-revoke empty state that
contradicts the server's actual state, no focus restore, and a surface that is both unreachable and
0×0 at 430px.

### Overall: **FAIL**

---

### Adjudication — the `requireOwnerOnly` 403/404 flag (your item 7)

I independently reproduced the behaviour and I agree with your facts: `requireOwnerOnly` returns
`Forbidden` for a real-but-unowned resource and `NotFound` for an absent one, this is shared by every
owner-only resource in the codebase, and CONTRIBUTING.md separately says cross-user/nonexistent
should be 404.

I **partly disagree** with the "amend the spec + spinoff, out of scope" framing.

Changing `AccessChecker.requireOwnerOnly` itself is clearly out of scope — it is cross-cutting, would
alter the observable behaviour of every existing owner-only route, and belongs in its own ticket. On
that we agree.

But the resolution "amend the spec and defer" is not the cheapest correct option here, and it leaves
a spec delta shipped in this change that the shipped code contradicts. `ShareTokenService` is
brand-new surface with no back-compat obligation, and the fix is genuinely local: map
`ServiceError.Forbidden` from `requireOwnerOnly` to `ServiceError.NotFound("Dashboard not found")`
inside `ShareTokenService`'s three `case Left(err)` arms — three lines, no shared code touched, no
other route affected. That is also the ticket's own stated theme ("no resource leak and no existence
oracle") applied consistently: it is incoherent for the anonymous read path to go to structural
lengths to be non-distinguishing while the management path on the same resource answers the same
question with a 403.

So my position: **fix it here, locally, in `ShareTokenService`** (and update
`ShareTokenOwnershipSpec`, which currently asserts the 403 and therefore codifies the leak). Keep the
spec scenario as written — it is the right requirement. File the spinoff anyway for the cross-cutting
`requireOwnerOnly`/`AccessChecker` behaviour, since every *other* owner-only route still leaks.

If the orchestrator prefers deferral instead, then the spec scenario must be *removed* from this
change's delta rather than left standing — a shipped spec requirement that the shipped code violates
is worse than either alternative. What is not acceptable is the current state: spec says
indistinguishable, code says 403, and a test asserts the 403.

### Change Requests

1. **Fix the composed share URL** (`DashboardShareDialog.tsx:44-46`). The current value resolves to
   the SPA's 404 page. Decide and implement one of: (a) add a public dashboard-viewer route to
   `AppRoutes.tsx` (outside `ProtectedRoute`) that reads `?token=` and renders the dashboard via the
   public panels/rows endpoints, and point `buildShareUrl` at it; or (b) if a viewer page is out of
   scope for HEL-590, escalate rather than ship a link that does not work. Whatever is chosen, add a
   test that asserts the produced URL matches a route that actually exists — the current
   `DashboardShareDialog.test.tsx:98,104` merely restates the implementation string and cannot catch
   this class of defect.

2. **Show each link's creation time** in the list row (`DashboardShareDialog.tsx:180-193`), per
   `share-link-management-ui` "Scenario: Status is visible per link". `createdAt` is already on the
   wire and in `ShareTokenResponse`.

3. **On successful revoke, mark the item revoked rather than deleting it**
   (`shareTokensSlice.ts:168`): replace the `filter` with a map that sets
   `revokedAt` to the current ISO timestamp, so the row re-renders with the "Revoked"
   `StatusChip` and the empty state is not shown while a revoked link exists. Add a slice test
   asserting the item survives with `revokedAt !== null`.

4. **Make the share surface reachable and usable at 430px.** Either render `DashboardShareDialog`
   outside `.app-sidebar` (e.g. lift the `shareDialogDashboard` state so the dialog mounts at the app
   shell level, or portal it), *and* add a mobile entry point (the dashboard-switcher sheet or the
   command-bar "Dashboard actions" menu). Verify by opening the dialog at 430px and confirming a
   non-zero bounding box with no horizontal scroll.

5. **Add an explicit, idempotent `GRANT` for the privileged pool** covering `share_tokens`, in a
   **new migration (V102)** — do not edit V101, which is already applied to the shared dev database.
   Follow V100's `GRANT SELECT ON ... TO helio_privileged` precedent. Rationale: the anonymous
   validation read runs on the privileged pool and `ShareTokenRlsSpec` cannot detect a missing grant
   because its own fixture grants ALL TABLES.

6. **Scope `ShareTokenRepository.revoke` by owner in the query**, not by RLS alone
   (`ShareTokenRepository.scala:79-85`): add `.filter(_.userId === UUID.fromString(userId.value))`
   (and optionally a `dashboard_id` filter so the path segment is honoured). RLS remains the
   defence-in-depth layer; this removes the dependence on the app pool actually being RLS-enforced,
   which is documented not to hold in dev/CI.

7. **Resolve the 403/404 management-route leak** per the Adjudication above — preferred: map
   `Forbidden` → `NotFound("Dashboard not found")` in `ShareTokenService`'s three `requireOwnerOnly`
   arms and update `ShareTokenOwnershipSpec` accordingly; file the cross-cutting `AccessChecker`
   spinoff separately. If deferring instead, delete the "Management routes do not reveal other
   tenants' dashboards" scenario from `specs/share-link-management-api/spec.md` so no shipped spec
   requirement contradicts shipped behaviour.

8. **Replace the `null` default with `Option`** (`AclDirective.scala:31`):
   `shareTokenValidator: Option[ShareTokenValidator] = None`, dropping the `Option(...)` wrap at line
   90. `ApiRoutes.scala:220` passes `Some(shareTokenValidator)`.

9. **Either implement focus restore on dismiss or reword the spec scenario.** If `shared/ui/Modal.tsx`
   is the right home for it, that is a shared-component change and may warrant a spinoff — but
   `share-link-management-ui` "Scenario: Focus management" currently claims a behaviour no code
   provides.

### Non-blocking Suggestions

- `DashboardShareDialog.tsx:161` — the `status === "succeeded" && items.length === 0` ternary means
  the `<ul>` (empty, but with its `aria-label`) is rendered during `idle`/`loading`. Consider
  rendering neither until the first fetch resolves.
- Replace the two inline FQNs in new Scala files (`ShareTokenService.scala:93`,
  `ShareTokenRepository.scala:90-92`) with top-level imports, per CONTRIBUTING.md:70.
- A revoked row still reads "Never expires"; "—" or omitting the expiry for revoked links would read
  better.
- The design's honest note that the *dominant* timing channel (query-count asymmetry between an
  absent dashboard and an invalid token against an existing one) is unmitigated is correct and
  well-documented; no action requested, but it is worth carrying into HEL-837's eventual fix.
