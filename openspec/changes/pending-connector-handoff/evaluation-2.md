# Evaluation Report — Cycle 2 (evaluation-2.md)

Reviewed commit: `5b19d5df` ("Address cycle-2 evaluation: fix credential allow-list, mutation-verified
pending guard, completion round-trip proof, live auth-shape lookup, wire-shape schemas").

`git status --porcelain` was **empty before and after** every gate run and every probe in this cycle — the
cycle-1 hazard (a gate passing only because of an uncommitted working-tree edit) does not recur. All gate
results below are against the committed tree.

## Cycle-1 change requests — verification

### CR1 — `CredentialSurfaceEnumerationSpec` — CLOSED

`helio-mcp/src/tools/connectorHandlers.test.ts` was added to the allow-list with a documented reason, plus
a six-line comment explaining *why* the file now matches (the handler mints a pending Connector instead of
refusing outright, and every occurrence is prose, never a value in transit). Critically, **the assertion
itself was not weakened**: it is still exact set equality —

```scala
val actual = filesContainingToken(new File(root, "helio-mcp/src"), "credential").toSet
actual shouldBe allowedMatches.keySet
```

Only the title string changed ("thirteen" → "fourteen"). No narrowing of the scanned directory, no
predicate relaxation, no `should contain allElementsOf` softening. The spec is green in the full run.

### CR2 — round-trip / usability proof — CLOSED, and genuinely non-tautological

`SourceServiceSpec` gained "refuses createRest while the Connector is pending, then SUCCEEDS against the
SAME Connector once completed", which exercises the real path rather than re-deriving the guards' predicate:

1. `svc.createRest(request, user)` is asserted `isLeft` while pending — the real `SourceService` path.
2. Completion runs through the real `ConnectorCompletionService` (wired in `beforeAll` against the real
   `ConnectorCompletionTokenRepository`), i.e. the same `encrypt → consume → repointPendingCredential`
   ordering the anonymous endpoint uses — not a direct repository write.
3. **The same `request` value then succeeds**, with `created.fetchError shouldBe None` — this is the ticket
   AC and the HEL-590 failure mode, now actually demonstrated.
4. The credential is decrypted with a **real** `ConnectorCredentialRepository` and asserted equal to the
   exact submitted value: `decryptForUse(credentialId, owner) shouldBe Some("the-real-round-trip-secret")`.
   This is the round-trip `isPending shouldBe false` could never give.

The test also incidentally proves D9's re-mint match key works, since it asserts
`minted.connectorId shouldBe pending.id` — a mismatch would fork a second row and fail.

### CR3 — Internal-branch guard failability — CLOSED, independently reproduced

The executor asserted on the message. I did **not** take that on trust; I re-ran the mutation myself:

1. Deleted the `case Some(c) if c.isPending => Left(...)` arm from
   `RestApiConnectorDriver.resolveConnector`.
2. Ran `sbt 'testOnly com.helio.domain.connectors.RestApiConnectorDriverPendingGuardSpec'` — **2 tests
   failed**, both branches, each with `"Connector credential not found" did not include substring "pending"`
   (lines 108 and 136). In cycle 1 only line 108 fired.
3. Restored the file, confirmed `git status --porcelain` empty, re-ran — **3/3 green**.

So the Internal-branch assertion is now genuinely failable, and the vacuity I found in cycle 1 is gone.

**Are the two branch tests one axis wearing two labels?** No, though they do share a mutation. The guard is
a single `case` arm inside `resolveConnector`, which by design is the one funnel serving both contexts, so
no mutation can kill one branch's guard without the other's — that is D4's intent, not a test defect. The
axis the two tests independently cover is the *lookup* path: the Owned test passes
`ConnectorResolveContext.Owned(user)` (→ `findByIdOwned`) while the Internal test passes
`ConnectorResolveContext.Internal` (→ `findByIdInternal`) and constructs no `AuthenticatedUser` at all, so
it cannot pass through the owned path. They would diverge if a future change routed `Internal` around
`resolveConnector` — which is precisely the regression worth guarding. The third case
("does not reject a complete Connector") remained green under the mutation, confirming the failures isolate
to pendingness rather than an always-reject mutation.

### CR4 — live auth-shape lookup — CLOSED; not an oracle

**Sourced from the pending row:** `describePending` resolves the token → `findByIdUnscoped` → parses the
row's own `config` via `ConnectorAuthShape.parse`. Verified live end-to-end, not just read: I minted a
pending Connector with `authType: "api_key"`, `apiKeyName: "X-Probe-Key"`, `apiKeyPlacement: "header"` and
the anonymous `GET` returned exactly `{"apiKeyName":"X-Probe-Key","apiKeyPlacement":"header","authType":"api_key"}`.

**Not a new oracle.** `describePending` and `complete` now share one private `resolveValidToken`, so they
cannot drift on what counts as usable. Every failure mode — empty token, unknown token, invalid/expired/
consumed/superseded (`!token.isValid`), connector missing, connector no longer pending, authenticated
non-owner — collapses to the single `RefusalError`. Probed live against a **freshly restarted** backend:

| Case | Status | Body | Length |
| --- | --- | --- | --- |
| unknown token | 400 | `{"message":"This completion link is invalid or has expired"}` | 60 |
| empty token | 400 | identical | 60 |
| long junk token | 400 | identical | 60 |
| **consumed** token (replayed after a real completion) | 400 | identical | 60 |

Byte-identical across all four, matching the POST endpoint's own refusal exactly. The lookup is read-only
(never consumes, never mutates), and it discloses nothing beyond what the same token already authorizes its
holder to do via `complete`. The response type is a narrow dedicated case class that deliberately excludes
`defaultHeaders` (free-form, potentially credential-shaped — HEL-828's concern) and the server-owned
`implicit` flag.

**Freshness note:** the backend from cycle 1 was still listening on 9294 and returned `401` for the new
`GET` route (falling through to the authenticated tree), which would have read as "the endpoint refuses
anonymous callers". I killed PID 418076 and restarted before observing anything — every Phase-3 result above
is from a backend built at `5b19d5df`.

**UI:** the dead "Authentication type" `<Select>` is gone. With a real token the page renders a single
field labelled **"API key value"**, derived from the fetched shape. Six new tests in
`ConnectorCompletionPage.test.tsx` cover it, including the one that matters most — *"submits ONLY
{ token, credential } — never the fetched authType"* — which pins the fix against regressing back into
sending a guessed value.

### CR5 — wire-shape contracts — CLOSED

Four schema files added, and each matches the actual Scala case class field-for-field, including
optionality (`apiKeyName`/`apiKeyPlacement` are `Option` and correctly absent from `required`):

| Schema | Protocol type | Endpoint(s) |
| --- | --- | --- |
| `completion-request.schema.json` | `CompletionRequest(token, credential)` | `POST /api/connectors/completion` |
| `completion-token-response.schema.json` | `CompletionTokenResponse(connectorId, token, expiresAt)` | `POST /api/connectors/pending`, `POST /api/connectors/:id/completion-token` |
| `create-pending-connector-request.schema.json` | `CreatePendingConnectorRequest(name, kind, baseUrl, authType, apiKeyName?, apiKeyPlacement?)` | `POST /api/connectors/pending` |
| `pending-connector-auth-shape-response.schema.json` | `PendingConnectorAuthShapeResponse(authType, apiKeyName?, apiKeyPlacement?)` | `GET /api/connectors/completion?token=…` |

Confirmed against observed live payloads, not only against source: the mint returned exactly
`{connectorId, expiresAt, token}` and the describe returned exactly `{apiKeyName, apiKeyPlacement, authType}`.
The schemas are also genuinely *wired in* rather than orphaned files — `check:schemas` now reports **81**
shapes checked, up from 77 at cycle 1, so drift in any of the four will fail the gate. All four endpoints
are recorded in the `openspec/` deltas under new "Wire Contract" sections in the two relevant spec files.

## Phase 1: Spec Review — PASS

Tasks 7.1 and 8.4 are now checked and genuinely done. Every design decision re-verified in cycle 1 (D1–D10,
the conditional consume predicate, the two distinct invalidation columns, the three independent guards, the
MCP no-credential invariants, V103) remains intact — the cycle-2 diff touches none of them destructively.
The `complete` refactor into `resolveValidToken` preserved the empty-token check (moved, not dropped) and
the full compensation ordering. Expiry observed live at exactly 60 minutes, matching D9's default.

The new `GET` surface is an addition beyond the original plan, introduced to satisfy CR4. It is documented
in the spec deltas and design-consistent with D9's "the completion page renders from it", so I treat it as
in-scope rather than scope creep.

## Phase 2: Code Review — PASS

All gates re-run by me against the clean committed tree:

| Gate | Result |
| --- | --- |
| `cd backend && sbt test` | **PASS — 3972 tests, 268 suites, 0 failed, 0 aborted** |
| `npm run lint` | PASS |
| `npm run format:check` | PASS |
| `npm run typecheck` | PASS |
| `npm test` (root jest) | PASS — frontend 262 suites / 2682 tests; **helio-mcp 24 suites / 239 tests** |
| `npm --prefix frontend run build` | PASS |
| `npm run check:helio-mcp-types` | PASS |
| `npm run check:no-credential-leak` | PASS — 6139 files scanned, 0 violations |
| `npm run check:schemas` | PASS — 81 shapes (was 77) |
| `npm run check:openspec` | PASS |
| `npm run check:scala-quality` | PASS (clean; 159 pre-existing soft warnings) |

**helio-mcp explicitly (HEL-1004 — CI selects nothing under `helio-mcp/**`):** the root suite ran all 24
helio-mcp test files and all 239 tests passed, and `check:helio-mcp-types` passed. Stated as a fresh
first-hand result, not inferred from a CI summary.

Both cycle-1 backend failures are resolved: `CredentialSurfaceEnumerationSpec` is green with the assertion
intact, and `AssistantConversationRoutesSpec` (a cycle-1 load flake) passed in the full clean run — I
deliberately ran the backend suite with nothing else executing to avoid re-inducing it.

Code quality: the `complete`/`describePending` refactor is a genuine de-duplication rather than a copy —
one shared validity helper, correctly documented as existing so the two "can never drift". Comments cite
the governing decision or the evaluation CR that prompted them. No dead code, no `any`, no untyped escape
hatches, no inline fully-qualified names in the new Scala.

## Phase 3: UI Review — PASS

Servers restarted at `5b19d5df` before observation (see CR4 freshness note).

- **Happy path, live end to end:** minted a pending Connector → page rendered the correct `api_key` field
  from the live lookup → submitted → *"Credential submitted. The Connector is now ready to use"* → the
  Connector reported `pending: false`, `completedAt: 2026-09-07T03:09:41.241152Z`,
  `completedBy: 9532cfcf-…` (D10's owner-visible signal, recording the authenticated principal because the
  browser carried an owner session — which also exercises task 4.5's authenticated-owner path).
- **Unhappy paths:** unknown token, empty token and a replayed consumed token all render the generic
  `role="alert"` message; a missing `token` param renders its own copy without calling the service. No blank
  screens, no unhandled exceptions.
- **No console errors** beyond the browser's own `400` network line for the deliberately-rejected requests;
  it carries no credential.
- **No credential or token in logs:** grepped `.concertino-backend.log` and `.concertino-frontend.log` for
  both the submitted credential value and the raw token — **0 matches in each**.
- Accessible names present on all interactive elements; the cycle-1 dangling `htmlFor` is gone with the
  chooser it belonged to.
- Breakpoints 1440 / 1100 / 768 / 360 render without overflow (card reflows 400px → 312px).

## Overall: PASS

All five cycle-1 change requests are genuinely closed, verified against the tree and — for CR2, CR3 and
CR4 — by my own execution rather than by reading the diff or the commit message.

## Non-blocking Suggestions

- `describePending` has tests for an invalid token and an already-completed Connector, but not for
  **superseded** or **expired** tokens specifically. These are structurally covered (the shared
  `resolveValidToken` funnels them into the same `RefusalError`, and `complete`'s own 8.3b tests cover the
  states), so this is a completeness nit rather than a gap — but since the GET is a new anonymous surface,
  two more cases there would pin it directly.
- The spec's "Invalid completion tokens are indistinguishable from one another" requirement is phrased
  generically enough to cover the new GET, but it was written for the POST. Consider adding an explicit
  scenario naming the lookup endpoint so a future reader does not have to infer the coverage.
- The completion token now also travels in a **backend** query string (`GET /api/connectors/completion?token=…`),
  where previously it appeared only in the frontend URL. D5's reasoning for keeping the *credential* out of
  the query string (access logs, `Referer`) applies with lower severity to the token, which is single-use
  and short-lived. I confirmed the backend logs it nowhere, so this is not a live leak — but if an access-log
  layer or a reverse proxy is added later, this is the line that would start recording tokens. A header or
  a POST-shaped lookup would sidestep that permanently.
- `ConnectorCompletionTokenRepository.consume` still composes its predicate with a Scala-side
  `Instant.now()` where design.md D3 writes SQL `now()` (carried over from cycle 1; equivalent in effect,
  atomicity preserved).

## Database hygiene

This cycle I **did** create rows in the shared dev database, and removed them:

- Created: one `connectors` row (`32addc39-3bfa-42a6-9e68-9487d81f7b1e`, "HEL955 eval probe"), its
  `connector_completion_tokens` row, and the `connector_credentials` row bound at completion.
- Deleted via `DELETE /api/connectors/:id` (204).
- **Confirmed by querying, not by exit status:**
  `SELECT count(*) FROM connectors WHERE id='32addc39-…'` → **0**;
  `SELECT count(*) FROM connector_completion_tokens WHERE connector_id='32addc39-…'` → **0** (cascade
  confirmed — this also live-validates D4a's delete-cascades claim);
  `SELECT count(*) FROM connectors WHERE name LIKE 'HEL955%'` → **0**;
  orphaned `connector_credentials` created in the last 2 hours → **0**.

Backend test suites run against embedded Postgres, not the shared dev DB. The temporary guard mutation for
CR3 was restored and the worktree verified clean.
