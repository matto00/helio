## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Cold review at HEAD `5b19d5df`. Everything below is derived from the diff, the files, executed
tests, mutation runs I performed myself, and a live probe of the running backend/frontend. The
executor's and evaluator's reports were read as claims only.

### What I verified (with evidence)

**Ground truth.** `git diff --stat main...HEAD` — 63 files. Migration: exactly one new file,
`V103__pending_connectors.sql`, and `git diff --stat main...HEAD -- backend/.../db/migration/`
shows *only* that file (58 insertions, no deletions) — no applied migration was edited. No
duplicate V103.

**1. Pending Connector structurally unusable — all three guards present and independently
effective (mutation-verified by me).**
- Baseline: `sbt 'testOnly ...RestApiConnectorDriverPendingGuardSpec'` → 3/3 green.
- **Mutation D4 (driver guard):** deleted the `case Some(c) if c.isPending => Left(...)` arm from
  `RestApiConnectorDriver.resolveConnector` → **2 tests FAILED** (Owned and Internal branches).
  Restored byte-identically (`cp` from a pre-mutation copy; `git status` clean afterwards).
  The cycle-1 vacuity is genuinely fixed — the Internal test now asserts the message, so the
  downstream `case (_, None) => Left("Connector credential not found")` defensive arm no longer
  satisfies it.
- **Mutation D4 guard 2 (`SourceService.checkConnectorPending`):** removed the call → `SourceServiceSpec`
  **2 tests FAILED**. Independently effective. Restored.
- Guard 3 (`ConnectorEntityService` read paths permit reading pending metadata) present as designed.
- `credentialId: Option[...]` (D1) forces the enumeration; `rotateCredential` refuses pending
  (`ConnectorRotationPending`), `delete` handles `None`, both covered by passing tests.

**2. Conditional consume predicate.** `ConnectorCompletionTokenRepository.consume` does contain
every validity condition in the actual write:
`filter(r => r.tokenHash === tokenHash && r.consumedAt.isEmpty && r.supersededAt.isEmpty && r.expiresAt > now)`.
The shipped code satisfies D3/D9. **But it is not protected by any test** — see CR1.

**3. Anonymous read surface `GET /api/connectors/completion?token=…`.** Live probe against the
running branch binary (freshness proven functionally — this route does not exist on `main`):
| token | status | body |
|---|---|---|
| `bogus-token` | 400 | `{"message":"This completion link is invalid or has expired"}` |
| `` (empty) | 400 | identical |
| 43-char base64-shaped, never existed | 400 | identical |
Consumed / superseded / already-completed cases collapse to the same `RefusalError`
(`ConnectorCompletionServiceSpec` asserts `shouldBe Left(ConnectorCompletionService.RefusalError)`
for invalid and for already-completed). Query cost: an unknown or invalid token costs **one**
lookup (`findByHash`); only a *valid* token proceeds to the second (`findByIdUnscoped`) — no
failure path costs an extra query. Disclosure is a dedicated narrow type
(`PendingConnectorAuthShapeResponse` = authType + apiKeyName + apiKeyPlacement) that deliberately
excludes `defaultHeaders` and the server-owned `implicit` flag; never the credential (there is
none). I could not construct an existence oracle from it. **This endpoint passes.**

**4. MCP surface accepts no credential.** `connectorSchema.ts` adds only `apiKeyName` (string) and
`apiKeyPlacement` (`"header"|"query"`) — non-secret shape metadata; `.strict()` and every
`rejectCredentialField(...)` denylist entry are untouched in the diff. `helioApi.createConnector`
still hardcodes nothing secret and `createPendingConnector` posts only name/kind/baseUrl/authType/
apiKeyName/apiKeyPlacement. The HEL-828 surviving-test evidence is
`CredentialSurfaceEnumerationSpec` + the rewritten `connectorHandlers.test.ts`, which assert
`api.createConnector` is *never* invoked on the credentialed branch.

**5. Completion works end to end, asserted on content.** `SourceServiceSpec`'s
"refuses createRest while the Connector is pending, then SUCCEEDS against the SAME Connector once
completed" runs the real encrypt → consume → `repointPendingCredential` path and then asserts a
successful `createRest` with `fetchError shouldBe None` and a credential that decrypts back to the
exact submitted value. This is real content-level proof, not a status-code assertion.

**6. No real credential anywhere.** All fixture secrets are obvious literals
(`the-real-round-trip-secret`, `secret-1`, `attacker-secret`); master keys are per-run
`SecureRandom`. Token is returned only at mint time; nothing logs it.

**UI.** Started servers via `scripts/concertino/start-servers.sh` (reported "already healthy …
reusing" — freshness re-established functionally via the new route probe above). Screenshot of
`/connectors/complete?token=bogus` at
`/tmp/claude-1000/-home-matt-Development-helio/2179eccd-d39c-47cc-8d27-ea431f13eae6/scratchpad/completion-invalid.png`
— the card matches the `auth-page`/`auth-card` sibling pattern (OrbitMark, title, subtitle),
spacing and typography consistent with LoginPage. Console shows only the expected 400s from the
deliberately-bogus token (doubled by React StrictMode in dev), no JS errors.

### Verdict: REFUTE

The security-critical mechanics are, as far as I can measure, **correct in the shipped code**. What
fails is evidence and one design decision that was silently narrowed: two of the change's own
highest-risk behaviours are asserted by no test at all (one of them an explicit ticket AC, marked
`[x]` in tasks.md), and D10's owner-visible completion signal — the linchpin the design's own
residual-risk acceptance rests on — is stored and served but never shown to anyone.

### Change Requests

1. **The conditional-consume predicate is untested; the "supersede-vs-consume race" test is
   vacuous.** I deleted `&& r.supersededAt.isEmpty && r.expiresAt > now` from
   `backend/src/main/scala/com/helio/infrastructure/persistence/sources/ConnectorCompletionTokenRepository.scala:consume`
   and re-ran `ConnectorCompletionServiceSpec` — **14/14 still green** (reproduced twice). The
   reason is visible in the test itself
   (`ConnectorCompletionServiceSpec.scala`, "close the supersede-vs-consume race"): it supersedes
   *before* the submission, so `resolveValidToken`'s in-memory `token.isValid` rejects it and the
   conditional `UPDATE` is never reached. Its own comment ("the observable contract is identical
   either way") is exactly the inverted reasoning D3 warns against — D3 requires the predicate,
   *not* the in-memory validator, to be what closes the race. Add a test that exercises the write
   predicate directly: e.g. call `tokenRepo.consume(hash)` on a token that was superseded/expired
   *after* being read as live (or introduce a seam so `complete` can be interrupted between
   `resolveValidToken` and `consume`), and assert it returns `false` and the Connector stays
   pending. The new test must go red under the mutation above.

2. **No expiry test exists anywhere — ticket AC4 is not met, and tasks 4.7 / 8.3 are falsely
   checked.** `grep -rn -i "expir" backend/src/test/.../ConnectorCompletionServiceSpec.scala`
   returns only an import, the 60-minute constructor argument, and a comment. There is no test in
   which a token actually expires. AC4 is "The completion URL expires, and expiry behavior is
   specified and tested"; tasks.md:99-101 (`4.7`) demands precisely "a token expires, completion is
   refused, a re-mint succeeds, and the human completes with the new token" and is marked `[x]`;
   task 8.3 ("expiry boundary is exclusive") is marked `[x]` with nothing behind it.
   `ConnectorCompletionService.clampExpiry` (the D9 24-hour ceiling, the value the whole residual-risk
   paragraph is argued against) has **zero** test coverage. Add: (a) the 4.7 end-to-end expiry-recovery
   test, (b) an exclusive-boundary assertion on `ConnectorCompletionToken.isValid`, (c) `clampExpiry`
   unit tests for over-ceiling, zero/negative, unparseable and absent inputs. Un-check any task whose
   evidence does not exist.

3. **D10's owner-visible completion signal is plumbed but never rendered — the design's stated
   mitigation is not actually delivered.** design.md D10 is explicit: "The Connector list (task 6.3)
   shows **when and by whom** a Connector was completed through the handoff path", and the Risks
   section states the up-to-24-hour residual risk is acceptable *"only because of D10's
   owner-visible completion signal"*. `completed_at`/`completed_by` are stored (V103), returned in
   `ConnectorMeta`, and typed in `frontend/src/features/connectors/types/connector.ts:47-48` — but
   `ConnectorsPage.tsx` renders only a "Pending completion" chip and **never reads `completedAt` or
   `completedBy`**. tasks.md:119 quietly narrowed 6.3 to "Surface pending status", dropping the
   by-whom/when half. Either render the completion signal on the connectors list (with a test
   asserting `anonymous` vs a user principal is visibly distinguished), or bring the divergence back
   to the design gate and re-argue the residual-risk acceptance without it. Shipping the field
   unrendered is the weakest of the three options.

4. **Completion page's error state ignores the sibling error pattern it claims to mirror.**
   `frontend/src/features/connectors/ui/ConnectorCompletionPage.tsx` renders both failure messages as a
   bare `<p role="alert">…</p>` with no class, so the error reads as ordinary body text (see the
   screenshot: "This completion link is invalid or has expired" is visually indistinguishable from
   the subtitle). The page's own header comment says it "mirrors LoginPage.tsx's markup/class
   conventions", and `LoginPage.tsx:110,113` uses `<div className="auth-error">`, which
   `auth.css:190-196` styles with `--app-error` / `--app-error-surface` tokens. Use `auth-error`
   (keeping `role="alert"`) for both the shape-lookup failure and the submit failure.

### Non-blocking notes

- `helio-mcp/src/tools/read.ts:51-53` — the empty-list hint still tells the agent "create_connector
  … creates unauthenticated (authType: none) Connectors only; a credentialed host is completed by a
  human at the in-app /connectors page." That is now stale: the credentialed path mints a pending
  Connector and returns a completion URL. Worth updating in the same change.
- D5 mitigations include "no logging or echoing of the token", but the new `GET` carries the token
  in a query string, so it will appear in any infra-level access log (Cloud Run) even though the app
  itself logs no URIs. The page URL already contains the token, so this adds no new *capability* —
  but the mitigation sentence is now slightly stronger than reality.
- `evaluation-2.md` is untracked in the worktree (`git status --porcelain` → `?? …/evaluation-2.md`)
  while `evaluation-1.md` is committed. Delivery-artifact drift; commit it before delivery.
- `ConnectorCompletionToken.isValid`'s doc says it is "used ONLY for read-side display logic (e.g.
  tests asserting the invariant)". It is in fact the live validity check in
  `ConnectorCompletionService.resolveValidToken`, and no test asserts it. Correct the comment while
  addressing CR2.

### Housekeeping

All three mutations were reverted byte-identically; the worktree tree is clean apart from the
pre-existing untracked `evaluation-2.md`. All backend tests I ran use embedded Postgres — I created
no rows in the shared dev database; my only live-server interaction was three `GET`s with invalid
tokens (read-only, no writes). `cleanup.sh` was not invoked.
