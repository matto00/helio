## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Commit 44ac1908, branch `feature/share-link-token-management/HEL-590`.
Spawned cold. Every conclusion below is derived from the diff, the live servers, the
database, or a mutation I ran myself. The evaluator's PASS was treated as a claim.

### 0. Binary freshness (the stale-JVM trap)

`start-servers.sh` reported "already healthy … reusing" for both servers, exactly as warned.
Verified the running JVM is the fixed binary rather than trusting that:

- `ps -eo pid,lstart`: backend JVM pid 1655836 started `Sun Sep 6 11:05:16`, after the
  44ac1908 commit time (`10:55:42`) and after `PanelRepository.class` (`10:32:06`).
- `/proc/1655836/cwd -> .../HEL-590/backend` — it is this worktree's process.
- `strings PanelRepository.class | grep -c accessAlreadyGranted` → 3.
- Decisive functional proof: an anonymous `GET /api/dashboards/<id>/panels?token=<valid>`
  returned **real panel JSON**, which is precisely what cycles 1 and 2 could not do.
  I am testing the 44ac1908 behaviour.

### 1. The central security property — indistinguishability

Six live probes against the running backend (curl, anonymous, full response headers read):

| case | status | body | Content-Length |
|---|---|---|---|
| valid token, dashboard A | 200 | real panels | 1969 |
| token A presented for dashboard B (wrong resource) | 404 | `{"message":"Dashboard not found"}` | 33 |
| nonexistent token on A | 404 | same | 33 |
| token A on a nonexistent dashboard id | 404 | same | 33 |
| no token, private dashboard B | 404 | same | 33 |
| **revoked** token (revoked live via `DELETE`, then replayed) | 404 | same | 33 |
| **expired** token (minted with +8s expiry, slept 10s, replayed) | 404 | same | 33 |

Byte-identical status and body across all six denials, matching the pre-existing
anonymous-no-grant arm. No distinguishing header (`Vary`, `Cache-Control`, `X-*`) is emitted
on any arm.

Structural (not merely observational) grounding: `ShareTokenValidator.authorizes` collapses
unknown-hash / revoked / expired / wrong-resource into a single `Future[Boolean]` from one
indexed row fetch, and `AclDirective.authorizeResourceWithSharing` introduces **no new
`complete(...)`** — the token fallback reuses whichever denial the calling arm would already
have produced. I read both files in full and confirmed this.

**Rendered UI**: at `/dashboards/:id/panels?token=…` the viewer has exactly one non-loading,
non-success state. Screenshots taken and inspected in both themes
(`viewer-denied.png`, `viewer-denied-light.png`): identical "This link isn't available"
`EmptyState`, one copy string for all failure modes. `PublicDashboardViewerPage.tsx` ignores
the error object entirely (`.catch(() => setState("denied"))`), so there is no status-keyed
branch. Grepped the viewer, `publicDashboardService.ts` and `httpClient.ts` for `console` —
none on this path; the global interceptor only reacts to 401, never 404. The only console
output on a denial is the browser's own "Failed to load resource: 404" network line, which is
identical for every case.

One non-issue I chased and dismissed: with **no** token the component initialises straight to
`"denied"` and issues no request, so it skips the loading flash an invalid token produces.
That distinguishes only "did I supply a token", which the caller already knows. It leaks
nothing about the resource.

### 2. The `accessAlreadyGranted` flag

- `grep -rn accessAlreadyGranted --include=*.scala`: exactly **two** production call sites,
  both in `PublicDashboardRoutes.scala` (lines 82 and 161), both lexically inside the
  `authorizeResourceWithSharing { _ => … }` authorized block. Default is `false`; every other
  caller of `findAllByDashboardId` is unaffected. The only other hit is a test stub override.
- The predicate is `accessAlreadyGrantedPred || ownerPred || granteePred || publicPred`
  **on top of** the retained `.filter(_.dashboardId === dashboardId.value)`, so the flag
  widens the ACL but never the dashboard scope.
- `PublicDashboardRoutes` is mounted once, under `authDirectives.optionalAuthenticate`
  (`ApiRoutes.scala:684`), and both of its routes are wrapped by the directive. There is no
  route into a data-returning path with the flag true and no prior authorization.

**Panel-to-dashboard binding on `/rows`** — the thing this change's tests historically did not
assert. Verified live, not from the report:
- token A + a panel that really belongs to A → `200` with real rows
  (`{"items":[{"amount":10.0,"name":"Alpha"},…],"total":3}`).
- token A + **dashboard B's panel id under path A** → `404 {"message":"Panel not found"}`.
- token A + dashboard B's panel under path B → `404 {"message":"Dashboard not found"}`.

`resolveRows` resolves the panel through `findAllByDashboardId(dashboardId, …)` rather than a
by-id lookup, so the dashboard-level authorization is only ever spent on panels that are
genuinely on that dashboard. Correct.

### 3. Token security

- `ShareTokenService.generateRawToken`: `java.security.SecureRandom`, `new Array[Byte](32)`,
  base64url unpadded. Live-minted tokens are 43 chars → exactly 32 bytes.
- **At rest**: `psql` against the shared dev DB — `token_hash` is 64 hex chars;
  `SELECT count(*) WHERE token_hash = sha256(raw)` → **1**;
  `SELECT count(*) WHERE token_hash LIKE '%<raw>%'` → **0**. No plaintext persisted.
  `ShareToken` carries no plaintext field by construction.
- **Logs**: grepped `.concertino-backend.log` (the live server's stdout/stderr, confirmed via
  `/proc/1655615/fd/1`) for all four raw tokens minted during this review → 0 hits each.
- **List endpoint**: `GET …/share-tokens` returns only `id`/`dashboardId`/`expiresAt`/
  `revokedAt`/`createdAt`. Neither the raw token nor the hash appears. Confirmed live and in
  `ShareTokenProtocol.scala` (`ShareTokenResponse` has no such field).
- **Referrer**: the viewer page loads no cross-origin subresources, and modern browsers'
  default `strict-origin-when-cross-origin` strips the path (and thus the token) cross-origin.
- Comparison is on the SHA-256 hash via an indexed equality, not on the secret; timing
  variation between failure modes is bounded to one identical row fetch either way.

### 4. Hunt for remaining non-evidence — four mutations, all reproduced red

I did not accept any test on its comment. Baseline first: the eight share-token specs pass
40/40. Then:

| # | mutation | result |
|---|---|---|
| M1 | `accessAlreadyGranted = true → false` at both `PublicDashboardRoutes` call sites | **RED** — 2 failures in `ShareTokenPublicAccessSpec` (the two "actual panels"/"actual rows" tests). This is the cycle-1/2 defect and it is now genuinely guarded. |
| M2 | drop `shareToken.dashboardId == DashboardId(resourceId) &&` from the validator | **RED** — `ShareTokenValidatorSpec` "DIFFERENT resource" + the byte-identical-denial test |
| M3 | `ShareToken.isActive`: drop `revokedAt.isEmpty &&` | **RED** — "returns false for a revoked token" + the byte-identical-denial test |
| M4 | `ShareTokenRepository.revoke`: drop the query-level `user_id` filter | **RED** — `ShareTokenRepositoryRevokeSpec` "another owner's token id — the query-level user_id filter, not RLS, is what blocks this" |

M4 is the previously-flagged untested filter; it is now covered by a spec that isolates it
from RLS (which is vacuous under a superuser connection). All sources restored;
`git status` clean afterwards.

Frontend mutation: I made `PublicDashboardViewerPage` render a distinct copy for HTTP 404
specifically. `PublicDashboardViewerPage.routing.test.tsx` went **RED**. So the
indistinguishability test does have a reachable red arm.

`ShareTokenRlsSpec` is real, not vacuous: two genuinely distinct Hikari pools with
`SET ROLE helio_app_test` (non-BYPASSRLS) vs `helio_privileged`, never `DbContext(db, db)`,
and a positive fixture-liveness assertion that runs *before* the negative one.

### 5. Scope

Grepped every changed `backend/`+`frontend/` file for `frame-ancestors`, `X-Frame-Options`,
`Content-Security-Policy`, `iframe`, `embed` — zero hits (the only matches are the substring
"embedded" in `EmbeddedPostgres` test imports). The authorized minimal viewer is a titled
list of panel names/kinds behind `EmptyState`; no embed chrome, no chrome-stripping, no PDF/
PNG work. HEL-593 / HEL-596 / HEL-601 territory untouched.

### 6. Acceptance criteria — traced live

1. *Owner can mint, optionally set expiry, revoke; revoked/expired stop working immediately* —
   ran the whole loop: `POST` (201, token returned once) → `GET` list → `DELETE` (204) →
   replay → 404. Expiry: minted +8s, valid at t+0 (200), denied at t+10 (404). Past expiry
   rejected at mint (`400 expiresAt must be in the future`); garbage rejected
   (`400 must be an ISO-8601 instant`). Re-revoke is idempotent (204); unknown id → 404.
   In the browser: minted via the dialog, copied the URL out of the reveal field, logged out,
   opened it anonymously, saw the dashboard's panels. Screenshot `viewer-valid.png`.
2. *Valid tokens authorize; invalid denied consistently, no oracle* — §1 above.
3. *Only the owner can manage tokens* — registered a second real account and hit all three
   endpoints against another user's dashboard: list `404`, create `404`, revoke `404` — the
   same body an absent dashboard returns for the owner. `Forbidden` is deliberately collapsed
   to `NotFound` in `ShareTokenService`, which is the right call given the ticket's theme.
4. *Schema/OpenAPI updated; ScalaTest + Jest coverage* — three JSON Schemas present and
   consistent with the wire shape; `check-schema-drift.mjs` clean (77 schemas across 49
   protocol files), `check-spec-structure.mjs` clean (352 specs), `check-openspec-hygiene.mjs`
   clean, `check-scala-quality.mjs` clean.
5. *CSPRNG* — §3.

### 7. Gates re-run by me, not read from a report

- `sbt test`: **3935 succeeded, 0 failed**, 264 suites.
- `npx jest`: **2672 passed**, 260 suites.
- `npm run lint` (`--max-warnings=0`): clean. `npm run typecheck`: clean.

### 8. UI / design judgement (my own, against DESIGN.md)

Screenshots taken and looked at in **both** themes: `share-dialog-light.png` (dark),
`reveal-dark.png`, `share-dialog-light2.png` (light), `viewer-valid.png`,
`viewer-denied.png`, `viewer-denied-light.png`.

- **Tokens**: I grepped both new stylesheets for hardcoded colours/lengths. Every colour and
  radius is a `--app-*` token; every gap/padding is `--space-*`; every size is `--text-*`.
  The only literals are `min-height: 44px` (HIG touch target, deliberate and commented),
  `max-width: 720px` on the viewer, and media-query breakpoints. Clean.
- **Shared components**: reuses `Modal`, `TextField`, `ConfirmInline` (not `window.confirm`),
  `EmptyState`, `StatusChip`, `InlineError`, `IconButton`. The one raw `<input>` is
  unavoidable — `TextField`'s `type` union excludes `datetime-local`. I suspected a font/focus
  divergence there from the screenshot and checked computed style live: font family is
  identical to `.ui-input`, and the focus outline is the app's 2px accent ring. The mono look
  is Chromium's own date-field shadow DOM. Retracted.
- **Light/dark parity**: verified by toggling `helio-theme` and re-shooting. Both the dialog
  and the viewer render correctly in both; no washed-out or invisible text.
- **Consistency**: the reveal panel follows `ApiTokensSection`'s shown-once recipe and the
  token list follows `PipelineShareDialog`'s row shape. Status chips read Active/Expired/
  Revoked with sensible intents. This looks like it belongs in the app.

Nothing here is off-pattern enough to reject.

### 9. Judgement on the known focus-restore item (you asked)

**I agree with you — ship it, file a spinoff.** But the spinoff should be scoped wider than
"the share dialog", because I probed the root cause and it is not this feature's:

At 1440 I closed the dialog and read `document.activeElement` → `BODY`, reproducing the
report. I then walked the ancestor chain of the restore target. The trigger button itself is
`display: inline-flex; visibility: visible`, computed width 24px — but its parent
`div.popover.actions-menu` is **`display: none`** whenever the row is not hovered. A
`display:none` ancestor makes `.focus()` a no-op, which is why the restore silently fails.

That is pre-existing shared `ActionsMenu`/`DashboardList` CSS, not something HEL-590
introduced, and it means the *entire* dashboard-row actions menu (Rename, Duplicate, Export,
Delete — all shipped long before this ticket) is equally unreachable and unrestorable by
keyboard. Fixing it inside this change would mean editing shared chrome that every other row
action depends on: real scope creep on a security ticket, for a defect this ticket did not
cause. File it as "dashboard-list row ActionsMenu is `display:none` until hover, making it
keyboard-unreachable and focus-restore-proof", not as a share-dialog bug.

### Verdict: CONFIRM

### Non-blocking notes

1. **Spinoff scope** — see §9. File the a11y spinoff against the shared `ActionsMenu`/
   `DashboardList` hover-reveal, not against the share dialog.
2. `ShareTokenGenerationSpec` asserts the decoded token is `>= 16` bytes while design.md D3
   specifies 32. A mutation to `new Array[Byte](16)` would stay green. I confirmed the shipped
   value is 32 bytes live (43 base64url chars), so this is a loose assertion, not a defect —
   but tightening it to `shouldBe 32` costs nothing.
3. `V102__share_tokens_privileged_grant.sql` remains indistinguishable from absent by any
   test: `ShareTokenRlsSpec`'s harness issues `GRANT SELECT … ON ALL TABLES … TO
   helio_privileged` before its assertions, which masks V102 entirely. The migration's own
   header is honest about being belt-and-braces over V38's default privileges, and an
   idempotent `GRANT` is harmless, so I am not blocking on it — just recording that it is
   unverified rather than verified.
4. `PanelRepository.scala` now has two consecutive `/** … */` blocks above
   `findAllByDashboardId` (~lines 40–56); the first is orphaned by the second and will not
   appear in scaladoc. Cosmetic.
5. In the reveal state, two buttons labelled **"Done"** are visible simultaneously — the
   reveal's primary (dismiss the secret) and the modal footer's secondary (close the dialog).
   Different actions, same word. "Dismiss" or "Hide link" for the former would remove the
   ambiguity. Visible in `reveal-dark.png`.
6. `ShareTokenPublicAccessSpec`'s `"return panels for a valid token"` (status-code only) is
   literally the assertion that stayed green through both broken cycles. It is harmless now
   that the sibling data-asserting test exists, but consider deleting it so it can never be
   cited as evidence of the property it cannot detect.
7. The four-case loop in `PublicDashboardViewerPage.routing.test.tsx` feeds all four cases the
   *same* mock rejection, so the `Set(...).size === 1` assertion is trivially satisfied; its
   real discriminating power comes from the two hardcoded copy strings (which is why my
   status-branching mutation reddened it). Not vacuous, but the `Set` assertion is doing less
   work than its comment implies. The byte-identical property is proven properly one layer
   down, in `ShareTokenPublicAccessSpec`.
8. The public viewer shows no dashboard name — a recipient sees a bare list of panel titles
   with no indication of what they opened. Fine for the authorized minimal floor; worth a line
   in whatever ticket fleshes the viewer out.
