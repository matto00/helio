# Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed commit: the branch advanced during this review. Review began at `f4d2e184`; the executor
committed `a5ae0243` ("Fix formatting in connectorHandlers.test.ts") mid-review. **All verdicts below are
against `a5ae0243`**, with the one finding that `a5ae0243` resolved noted explicitly.

## Phase 1: Spec Review — FAIL

Verified present and matching design.md's literal decisions:

- **D1** — `credential_id` nullable (V103), `Connector.credentialId: Option[...]`, `isPending`.
- **D2** — `connector_completion_tokens` mirrors `share_tokens`; `expires_at NOT NULL`; `TokenHashing.sha256Hex`
  reused (no second hashing helper); owner-only RLS + `GRANT SELECT, UPDATE TO helio_privileged`.
- **D3 (mandate item 1) — CONFIRMED IN THE ACTUAL WRITE.**
  `ConnectorCompletionTokenRepository.consume` filters
  `tokenHash === … && consumedAt.isEmpty && supersededAt.isEmpty && expiresAt > now`, returning
  `affectedRows > 0`. Every validity condition is in the conditional `UPDATE`, not only in the in-memory
  validator. The supersede-vs-consume race is closed and covered by a test.
- **Mandate item 2 — CONFIRMED.** Two distinct columns, `consumed_at` and `superseded_at`, not one
  overloaded column, with the D9 semantics documented in the migration.
- **D4/D4a (mandate item 3) — all three guards independently present**, not factored into one call:
  1. `RestApiConnectorDriver.resolveConnector` — a single funnel serving both the `Owned` and `Internal`
     branches, placed beside the HEL-845 kind guard, before URI composition and before `decryptForUse`.
  2. `SourceService.checkConnectorPending` (line 200), invoked at line 112 as a check separate from
     `checkConnectorKind` (line 110).
  3. `ConnectorRepository.rotateCredential` (line 226) returns `ConnectorRotationPending` for a pending row.
- **D5/D6/D7/D8/D9/D10** — optional-auth body-carried completion endpoint, `pending` on the agent-facing
  summary with no auth-shape disclosure, implicit completion signalling, public completion route,
  atomic mint-with-supersede, `completed_at`/`completed_by` stored on `connectors` (not derived from
  `consumed_at`).
- **Mandate item 8 — CONFIRMED.** Migration is `V103__pending_connectors.sql`; the diff edits no existing
  migration file (`git diff --name-only` touches only the new V103).
- **Mandate item 5 — CONFIRMED.** `credentialDenylist.ts` is byte-unchanged from `main`; all five
  `rejectCredentialField` entries intact; `.strict(UNRECOGNIZED_KEY_MESSAGE)` intact;
  `helioApi.createConnector`'s `credential: ""` is still a hardcoded literal. The two new MCP inputs
  (`apiKeyName`, `apiKeyPlacement`) are non-secret shape metadata, and `createPendingConnector` carries no
  credential field at all.

Issues:

1. **Task 7.1 (contracts) is unchecked and undone.** No `schemas/` or `openspec/` wire shapes were authored
   for `CompletionRequest`, `CompletionTokenResponse`, or `CreatePendingConnectorRequest`. This is a
   binding constraint from both CLAUDE.md ("keep schema updates in the same change as related
   client/server code") and the ticket's own "Binding constraints" section. The executor's stated
   justification — that `check:schemas` does not enumerate connector types today — explains why the gate
   stays green; it does not discharge the rule. Three new wire shapes shipped with no contract artifact.
2. **Task 8.4 is unchecked and undone** — see Phase 2 finding 2. This is a ticket-AC-adjacent gap, not only
   a task-list gap.
3. Task list accuracy: every other item is marked `[x]` and each one I sampled is genuinely implemented.
   Tasks 7.1 and 8.4 are honestly left unchecked and disclosed in `files-modified.md` — the handoff is
   candid, which is the right behavior; the gaps are still blocking.

No scope creep found. No AC silently reinterpreted. No regressions to the HEL-845 kind guard (it remains a
separate check with its own message and its own spec).

## Phase 2: Code Review — FAIL

### Gates (all re-run by me at `a5ae0243`, not taken from the executor's report)

| Gate | Result |
| --- | --- |
| `npm run lint` | PASS |
| `npm run format:check` | PASS at `a5ae0243` — **FAILED at `f4d2e184`** (see below) |
| `npm run typecheck` | PASS |
| `npm test` (root jest) | PASS — frontend 261 suites / 2676 tests; **helio-mcp 24 suites / 239 tests** |
| `npm run check:helio-mcp-types` | PASS (`tsc --noEmit -p helio-mcp/tsconfig.typecheck.json`) |
| `npm run check:no-credential-leak` | PASS — 6138 files scanned, 0 violations |
| `npm run check:schemas` | PASS |
| `npm run check:openspec` | PASS |
| `npm run check:scala-quality` | PASS (clean; 158 pre-existing soft warnings) |
| `cd backend && sbt test` | **FAIL** — 3966 tests, 1 failed, 1 suite aborted |

**helio-mcp explicitly (per HEL-1004, since CI selects nothing under `helio-mcp/**`):** I confirmed
`npx jest --listTests` returns 24 helio-mcp files, ran the root suite, and all 24 passed — including
`connectorHandlers.test.ts`, `connectorSchema.test.ts`, `read.buildListConnectorsResult.test.ts`,
`helioApi.createConnector.test.ts` and `server.test.ts`. `check:helio-mcp-types` passed. Stated explicitly
rather than inferred from a CI summary.

Issues:

1. **BLOCKING GATE FAILURE — `CredentialSurfaceEnumerationSpec` is red.** Confirmed reproducible in
   isolation (`sbt 'testOnly com.helio.services.assistant.CredentialSurfaceEnumerationSpec'`), so this is
   not a load flake:

   ```
   backend/src/test/scala/com/helio/services/assistant/CredentialSurfaceEnumerationSpec.scala:89
   HashSet(… 14 files …) was not equal to Set(… 13 files …)
   ```

   The change made `helio-mcp/src/tools/connectorHandlers.test.ts` match the `credential` token, and the
   allow-list was not updated (the file is untouched by this diff). This is *precisely* the change-detector
   HEL-829 built so that a new credential-mentioning agent-surface file forces a human to record a
   justification. On a credential-shaped change, shipping with this spec red is not acceptable. The fix is
   almost certainly to add the file to the allow-list **with its documented reason**, not to silence the
   spec — but that judgement is the point of the gate.

2. **Task 8.4 / mandate item 7 — the "completed Connector actually becomes usable" assertion does not
   exist.** `ConnectorCompletionServiceSpec` is otherwise strong and asserts content rather than status
   codes (`completedBy shouldBe Some("anonymous")`, `isPending shouldBe false`, connector still pending
   after a lost race). But `isPending shouldBe false` is the *same predicate the guards read*, so it proves
   the guards will now let the Connector through — not that the credential bound through
   `encrypt → consume → repointPendingCredential` is the right one, decryptable, or usable. Grep confirms:
   the spec never calls `decryptForUse`, never re-reads `"the-real-secret"`, and no test anywhere exercises
   REST source creation against a just-completed Connector. This is the exact shape of the HEL-590 failure
   the ticket instructions call out: a green suite over a feature whose end state is never demonstrated.
   The new `repointPendingCredential` path is novel code with no round-trip coverage.

3. **Mandate item 4 — the recording credential repository exists, but its assertion is only *partly*
   failable; the `Internal`-branch test is vacuous.** I verified by mutation: I deleted the
   `case Some(c) if c.isPending => Left(...)` arm from `RestApiConnectorDriver.resolveConnector`, re-ran
   `RestApiConnectorDriverPendingGuardSpec`, and restored the file (worktree confirmed clean afterward).
   Result:

   - Owned-branch test: **FAILED** (`"Connector credential not found" did not include substring "pending"`)
     — good, the guard's presence is detected.
   - Internal-branch test: **PASSED with the guard deleted** — it asserts only `result.isLeft shouldBe true`
     and `decryptCallCount shouldBe 0`, and the downstream defensive arm in `buildResolvedRequest`
     (`case (_, None) => Left("Connector credential not found")`) satisfies both without the guard.
   - `decryptCallCount shouldBe 0` therefore never fires against guard removal on **either** branch, for the
     same reason: the defensive fallback also declines to decrypt. The recorder is real and would catch a
     decrypt, but it is not the thing proving the D4 guard exists.

   D4 names the `Internal` branch specifically. As written, that branch has no failable assertion, so a
   future refactor could remove the authoritative guard and this spec would stay green on that branch.

4. `ConnectorCompletionTokenRepository.consume` composes the predicate with a Scala-side
   `Instant.now()` rather than SQL `now()` as design.md D3 literally writes. Functionally equivalent here
   (single-statement conditional update; the clock skew between app and DB is not a correctness factor for
   an hour-scale expiry) and the atomicity property D3 actually cares about is preserved — recording it so
   the divergence from the literal decision is not silent. Non-blocking.

5. `check:schemas` failed once with a transient `ENOENT` on `helio-mcp/src/tools/proposal.ts` (a file that
   demonstrably exists and reads fine) and passed on every subsequent run. I attribute this to concurrent
   filesystem activity from the parallel sbt run, not to this diff. Recorded for transparency; not a change
   request.

6. **Resolved during review:** at `f4d2e184`, `npm run format:check` **failed** on
   `helio-mcp/src/tools/connectorHandlers.test.ts` — the committed content was unformatted and only an
   uncommitted working-tree edit made the gate pass. Commit `a5ae0243` committed that fix. Noting it because
   it is a recurring hazard: a gate that passes in the executor's dirty worktree but not at the commit under
   review.

7. `AssistantConversationRoutesSpec` failed once in the full run ("Request was neither completed nor
   rejected within 1 second") and **passed in isolation**. Load-induced flake in an area this diff does not
   touch. Environmental — not a change request, and not counted toward the FAIL.

Code quality otherwise: comments consistently cite the governing decision (D1/D3/D4/D9/D10) rather than
restating the code; no inline fully-qualified names in the new Scala; no `any` escape hatches; no dead code
or leftover TODOs; the new repository mirrors `ShareTokenRepository`'s established shape rather than
inventing a parallel one; pool assignment (`withUserContext` for owner writes, `withSystemContext` for the
anonymous lookup/consume) is correct and justified in place. The defensive `case (_, None)` arm in
`buildResolvedRequest` is good fail-closed practice and correctly documented as unreachable-by-design.

## Phase 3: UI Review — FAIL

Servers started via `scripts/concertino/start-servers.sh` (backend 9294, frontend 6387), both reported
`READY` from a fresh start, not a reused-healthy probe.

Verified good:

- `/connectors/complete?token=…` renders for an **unauthenticated** browser with no redirect to `/login` —
  D8's whole premise works.
- Unhappy path is graceful: a bogus token yields an inline `role="alert"` — "This completion link is invalid
  or has expired. Ask for a new one." No blank screen, no unhandled exception, form stays usable.
- Missing-token case renders its own copy rather than a broken form.
- Submit is correctly disabled while empty and during `loading`.
- **No credential leakage observed.** The only console error is the browser's own `400 (Bad Request)` line
  for `/api/connectors/completion`; it carries no credential. I grepped both `.concertino-backend.log` and
  `.concertino-frontend.log` for the two probe values I submitted — **0 matches in each**.
- **Caller-indistinguishability holds on the wire.** `POST /api/connectors/completion` with a bogus token
  and with an empty token both return byte-identical
  `{"message":"This completion link is invalid or has expired"}`, `Content-Length: 60`.
- Breakpoints 1440 / 1100 / 768 / 360: no horizontal overflow, card reflows 400px → 312px cleanly.
- Interactive elements have accessible names (`combobox "Authentication type"`,
  `textbox "Bearer token value"`, `button "Submit credential"`).

Issues:

1. **The "Authentication type" `<Select>` is a dead control.** `ConnectorCompletionPage.tsx:33` holds
   `authType` in state and `:71-77` renders a chooser for it, but `completeConnector`
   (`connectorCompletionService.ts:20`) posts only `{ token, credential }` — the selection is never
   transmitted and never affects the outcome. Its only effect is relabelling the field
   (`:82` "API key value" vs "Bearer token value"). This is user-visible misinformation in a security flow:
   a human handed a link for an `api_key`-shaped pending Connector can select "Bearer token", see the form
   agree with them, submit successfully, and have the credential bound under the pending row's *actual*
   shape regardless. It also contradicts D9, which states the pending row persists its intended auth shape
   and "the completion page renders from it" — the page instead asks the human to guess. The file's own
   comment acknowledges the page cannot know the shape, but the resolution chosen (ask, then discard the
   answer) is worse than either alternative.

2. Happy path could not be exercised end to end from the browser: minting a token requires an authenticated
   agent-side `create_connector`, and the token is deliberately returned only once. The backend spec covers
   mint → complete, but note that this is the same coverage gap as Phase 2 finding 2 — no layer, UI or
   backend, demonstrates a completed Connector being *used*.

Non-blocking: `ConnectorCompletionPage.tsx:70` has `<label htmlFor="completion-auth-type">` pointing at an
id that no element defines (`Select` receives `ariaLabel`, not `id`). The accessible name still resolves via
`ariaLabel`, so this is cosmetic — but the dangling `htmlFor` should be removed or the id wired through.

## Overall: FAIL

## Change Requests

1. **Fix `CredentialSurfaceEnumerationSpec`** (`backend/src/test/scala/com/helio/services/assistant/CredentialSurfaceEnumerationSpec.scala:89`).
   Add `helio-mcp/src/tools/connectorHandlers.test.ts` to the allow-list **with a one-line documented reason**
   in the same style as the existing thirteen entries (it mentions "credential" because it asserts the
   pending-handoff path rejects credential-shaped keys). Do not weaken or delete the assertion. Re-run
   `cd backend && sbt test` and confirm a fully green suite.

2. **Add the task 8.4 usability demonstration.** In `ConnectorCompletionServiceSpec`, after the successful
   `complete(...)` in the "end to end" case, assert the bound credential actually round-trips — e.g.
   `credentialRepo.decryptForUse(completed.credentialId.get, owner)` returns `Some("the-real-secret")` —
   and add a case proving `SourceService`'s REST create path, which refuses the Connector while pending,
   **succeeds** against the same Connector once completed. Status-quo `isPending shouldBe false` is the
   guards' own predicate and cannot catch a mis-bound or undecryptable credential from the new
   `repointPendingCredential` path.

3. **Make the `Internal`-branch pending guard test failable**
   (`backend/src/test/scala/com/helio/domain/connectors/RestApiConnectorDriverPendingGuardSpec.scala:117-129`).
   Assert on the message the way the Owned case does — `err should include("pending")` — instead of only
   `result.isLeft shouldBe true`. Verified by mutation: with the D4 guard deleted, that test currently
   passes, because `buildResolvedRequest`'s defensive `case (_, None)` arm produces a `Left` and skips
   decryption on its own. After the change, re-run the mutation yourself and confirm **both** branch tests
   go red, then restore.

4. **Resolve the dead auth-type control** in `frontend/src/features/connectors/ui/ConnectorCompletionPage.tsx`.
   Pick one and implement it fully:
   (a) send `authType` in the `CompletionRequest` body and have the backend validate it against the pending
   row's stored shape, refusing a mismatch with the same generic message; or
   (b) per D9, have the completion response/route render from the pending row's persisted auth shape and
   remove the chooser, leaving only the correctly-labelled credential field.
   Do **not** leave a control whose value is collected, displayed as authoritative, and discarded.

5. **Author the task 7.1 contract artifacts.** Add `schemas/` entries for `CompletionRequest`,
   `CompletionTokenResponse`, and `CreatePendingConnectorRequest` following the kebab-case
   `<name>.schema.json` convention, and update `openspec/` for `POST /api/connectors/completion`,
   `POST /api/connectors/:id/completion-token`, and `POST /api/connectors/pending`. `check:schemas` not
   enumerating connector types today is why the gate stays green; it is not a waiver of CLAUDE.md's
   same-change API-contract rule, which the ticket restates as binding. If you judge this genuinely
   out of scope, say so explicitly in the handoff as a deferral with a named follow-up ticket rather than
   leaving the task unchecked.

## Non-blocking Suggestions

- Remove the dangling `htmlFor="completion-auth-type"` at `ConnectorCompletionPage.tsx:70`, or thread an
  `id` through `Select`.
- `ConnectorCompletionTokenRepository.consume` uses a Scala-side `Instant.now()` where D3 writes SQL
  `now()`. Equivalent in effect; consider a one-line comment noting the deliberate divergence so a future
  reader does not read it as an oversight.
- `f4d2e184` failed `format:check` and only the executor's uncommitted working-tree edit made it pass
  (fixed in `a5ae0243`). Worth running the gates against `git stash`-clean state before declaring them
  green.

## Database hygiene

My review created **no** rows. Every completion probe I issued was rejected before any write (both returned
the generic invalid-token error), so no `connector_completion_tokens` or `connectors` rows were minted, and
nothing needed deleting. The backend test suites run against embedded Postgres
(`EmbeddedPostgres.builder()`), not the shared dev database. The one temporary source mutation I made
(deleting the D4 guard arm to prove failability) was restored; `git status --porcelain` in the worktree is
clean.
