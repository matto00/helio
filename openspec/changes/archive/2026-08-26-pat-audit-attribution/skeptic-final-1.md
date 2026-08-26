## Skeptic Report — final gate (round 1, skeptic-final-1.md)

### What I verified (with evidence)

**Diff vs. plan (no scope drift).** `git log --oneline main..HEAD` → one commit
(`de708cc9`). `git diff main...HEAD --stat` → 22 backend files (18 main, 4 test) + change
artifacts. I read the full main-source diff and the full test diff. Every touched main file
maps 1:1 to an entry in `files-modified.md` and to a task in `tasks.md`; no file is touched
that isn't listed, and no listed file is missing. `git status --porcelain` shows only the
untracked `evaluation-1.md` — nothing uncommitted.

**Out-of-scope gaps untouched (confirmed, not assumed).** The diff contains no change to
`WorkspaceTeardownService`, no change to `DataSourceService.refresh` / `SourceService.refresh`
(only their `audit(...)` helper one-liners changed), and no change to
`AuthService.completeOAuth` (`AuthService.scala` is not in the diff at all). No drive-by fixes.

**AC1 — session cookie → `source=ui`, null `actor_token_id`.** Traced to real code and a real
assertion, not a green run:
- `AuthDirectives.scala:57-62` — cookie branch maps `findValidSession`'s result through
  `.copy(source = AuditSource.Ui, tokenId = None)`.
- `AuthDirectivesSpec.scala` "resolve a session-cookie request with source=ui and no token id"
  asserts the resolved principal renders exactly `<uid>|ui|none` through a real
  `directives.authenticate` route.
- `AuditMutationInstrumentationSpec.scala` "record a session-cookie dashboard update with
  source=ui and null actor_token_id" drives a real `PATCH /api/dashboards/:id` against
  embedded Postgres and asserts `AuditSource.asString(rows.head.source) shouldBe "ui"` **and**
  `rows.head.actorTokenId shouldBe None`. Both halves of the AC are asserted.

**AC2 — PAT bearer → `source=pat` + correct token id.** `AuthDirectives.scala:32-37` maps the
new `(user, tokenId)` pair to `source = AuditSource.Pat, tokenId = Some(tokenId)`;
`ApiTokenRepository.findUserByTokenHash` (`:44-55`) now selects `(t.id, t.userId)`. The
integration test mints a **real** PAT through `POST /api/tokens`, performs the *same* dashboard
PATCH with only an `Authorization: Bearer` header (via a new `rawRoutesFor()` that deliberately
omits the auto-injected session cookie — otherwise cookie precedence would silently defeat the
test), and asserts `source == "pat"` and `actorTokenId shouldBe Some(ApiTokenId(tokenId))` —
the exact id, not merely "defined". This is the strongest form of the AC.

**AC3 — revocation preserves historical attribution.** Test creates a PAT, mutates, `DELETE
/api/tokens/:id` (asserted 204), then re-reads the audit row and asserts `actorTokenId` is still
`Some(ApiTokenId(tokenId))`. Real delete against real Postgres, so a cascading FK would fail it.

**AC4 — `sbt compile test` green.** Re-run independently by me, not trusted from
`evaluation-1.md`: `Total number of tests run: 3443 / succeeded 3443, failed 0`, `EXIT=0`
(log at `/tmp/hel483-sbt.log`).

**`AuditSource.Mcp` unused; no invented member.** `grep -rn "AuditSource\." main/` over the whole
backend returns 12 hits, none of which is `.Mcp`. `model.scala`'s diff adds only the two
`AuthenticatedUser` fields — the `AuditSource` ADT itself is untouched.

**Test fakes not weakened.** `AuthDirectivesSpec.scala:41` — the fake's return type reshapes to
`Option[(AuthenticatedUser, ApiTokenId)]` and still resolves only `patToken`; nothing removed,
two assertions added. `RateLimitDirectiveSpec.scala:50` — reshapes `resolvable.get(hash).map(_._1)`
to project `(user, tokenId)` from the same 3-tuple map; the fixture map, the `findPrincipalByTokenHash`
override, and every existing rate-limit assertion are unchanged. Neither diff deletes or relaxes
an assertion.

**Provenance survives the scoped-token path.** I checked `confineScopedToken` (which calls the
*other* lookup, `findPrincipalByTokenHash`): it discards the resolved user (`case Success(Some((_, tokenId, ...)))`)
and the request still flows through `authenticate` → `resolveApiToken`, so a scoped PAT still
lands `source=Pat` + its token id. No provenance hole there.

**Scheduler attributed `system`, verified by measurement.** `PipelineSchedulerService.scala:110`
sets `source = AuditSource.System` explicitly, and `PipelineSchedulerServiceSpec` now wires a
**real** `AuditService` and asserts by raw SQL that the fired run's `pipeline.run.submit` row has
`source = 'system'` and `actor_token_id IS NULL`. This is a real regression guard, not a
tautology — with the default `Ui` it would read `"ui"` and fail.

**No spec drift.** The already-published `openspec/specs/audit-mutation-instrumentation/spec.md`
makes no claim about `source` values, so nothing there is falsified by this change and no MODIFIED
delta is owed. The new `audit-actor-attribution` delta's five requirements each map to a shipped
test.

**No UI review performed** — the diff touches zero files under `frontend/`; backend-only, as stated.

### Verdict: REFUTE

The implementation is correct and well-tested; I could not refute a single behavioral claim. But
the change leaves two Scaladoc comments **immediately above the lines it edited** now asserting the
exact opposite of what the code does — and one of them tells the next reader that this ticket's
work has not been done yet. This repo has repeatedly paid for confidently-false in-code
documentation (see the HEL-495 doc-correction commits on `main`), and both fixes are one line each.

### Change Requests

1. `backend/src/main/scala/com/helio/services/dashboards/DashboardService.scala:47-49` — the
   helper's Scaladoc reads "HEL-477 design.md Decision 3: `source` is always `AuditSource.Ui`, a
   documented known-wrong placeholder until the attribution follow-up ticket lands." The
   attribution follow-up ticket (HEL-483) *is* this change, and line 53 now passes
   `user.tokenId, user.source`. Replace the stale sentence with the current fact (e.g. "HEL-483:
   `source`/`actor_token_id` come from the caller's resolved credential via
   `AuthenticatedUser`").

2. `backend/src/main/scala/com/helio/services/panels/PanelService.scala:78` — same defect, shorter
   form: "HEL-477 design.md Decision 3: `source` is always `AuditSource.Ui`." is now false as of
   line 81. Update it the same way.

(For completeness, I checked every other `auditService.record` call site's surrounding comments:
`AuthService.scala:90` is the only remaining hardcoded `AuditSource.Ui`, and per design.md
Decision 5 that is correct — a PAT cannot perform a login/register/logout — with no misleading
comment attached. No further stale-comment instances exist.)

### Non-blocking notes

- The MFA-via-PAT test asserts `rows.head.actorTokenId shouldBe defined` rather than the exact
  minted token id, unlike its dashboard sibling which asserts the exact id. It would catch a
  `None` regression but not a wrong-token-id regression. Worth tightening to the exact id if the
  test is being touched anyway; not blocking, since the exact-id path is already pinned by the
  dashboard test through the identical `AuthDirectives` resolution.
- Task 4.5 names `confirmEnrollment`/`regenerateBackupCodes`/`disable`; only `confirmEnrollment`
  is covered by a test. The other two go through the same one-line `audit(..., source = user.source,
  tokenId = user.tokenId)` edit, so coverage risk is low, but the task text overstates what shipped.
- `ApiTokenRepository.scala:58-59` — `findPrincipalByTokenHash`'s doc says "Same privileged pre-auth
  lookup as [[findUserByTokenHash]] (unchanged, left for every existing caller)". The parenthetical
  was written when `findUserByTokenHash` was the untouched one; it is mildly confusing now, though
  not outright false in the way CR1/CR2 are. Optional cleanup.
