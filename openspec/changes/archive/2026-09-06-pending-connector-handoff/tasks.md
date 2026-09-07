# Tasks — Pending-connector handoff

## 1. Schema

- [x] 1.1 Re-derive the next migration version from the tree at the moment of writing (`ls
      backend/src/main/resources/db/migration`; main was at V102 at planning time). Never edit an applied
      migration — Flyway checksums the whole file including comments, and this machine shares one
      `flyway_schema_history` across every worktree.
- [x] 1.2 Migration: `ALTER TABLE connectors ALTER COLUMN credential_id DROP NOT NULL;` with a comment
      explaining pendingness (design.md D1).
- [x] 1.3 Migration: `connector_completion_tokens(id, connector_id FK ON DELETE CASCADE, user_id FK,
      token_hash TEXT, expires_at TIMESTAMPTZ NOT NULL, consumed_at TIMESTAMPTZ NULL,
      superseded_at TIMESTAMPTZ NULL, created_at)` — **two distinct columns for two distinct invalidation
      events** (design.md D2/D9): `consumed_at` = successfully used to bind; `superseded_at` = a newer token
      was minted. A token is valid only when both are NULL and it has not expired;
      unique index on `token_hash`; index on `connector_id`; `ENABLE`+`FORCE ROW LEVEL SECURITY`;
      owner-only policy mirroring `share_tokens_owner` (V101); `GRANT SELECT, UPDATE` to `helio_privileged`
      (V102's pattern — the privileged pool performs the unauthenticated lookup and the consume).
- [x] 1.4 Verify the migration applies cleanly against the shared dev DB, and record what it changed.

## 2. Domain + persistence

- [x] 2.1 `Connector.credentialId` becomes `Option[ConnectorCredentialId]`; add `isPending`. Fix every
      resulting compile error deliberately — that error list is the chokepoint enumeration (design.md D1).
- [x] 2.2 `ConnectorRepository`: `rowToDomain` maps the nullable column; add `createPending(...)` that
      inserts with no credential and mints no credential row; add `bindCredential(...)`.
- [x] 2.3 New `ConnectorCompletionTokenRepository` mirroring `ShareTokenRepository`: owner-scoped
      insert/list via `ctx.withUserContext`; `findByHash` via `ctx.withSystemContext` (the only
      unauthenticated lookup); conditional `UPDATE ... WHERE consumed_at IS NULL AND superseded_at IS NULL
      AND expires_at > now()` returning the affected row count for atomic single-use consumption
      (design.md D3). **Every validity condition must be in this predicate**, not only in the in-memory
      validator — otherwise a token superseded by a concurrent re-mint still binds.
- [x] 2.4 Token minting reuses `java.security.SecureRandom` (32 bytes, url-safe Base64) and the existing
      `TokenHashing.sha256Hex`. Do not add a second hashing helper.

## 3. Guards (fail closed)

- [x] 3.1 `RestApiConnectorDriver.resolveConnector` — reject a pending Connector on **both** the `Owned`
      and `Internal` branches, beside the existing HEL-845 kind guard, before URI composition and before
      any `decryptForUse`. This is the authoritative guard.
- [x] 3.2 `SourceService` REST create path — a **separate** pending check alongside `checkConnectorKind`,
      not folded into it, so a correct-kind pending Connector is still refused.
- [x] 3.3 Confirm `SqlConnectorDriver` needs no guard and record why (it holds no `ConnectorRepository`
      dependency; `SqlSourceConfig` carries its own credentials).
- [x] 3.4 `ConnectorEntityService` read paths continue to return a pending Connector's metadata to its owner.
- [x] 3.5 **`rotateCredential` refuses a pending Connector** (design.md D4a) with a 400-class error naming
      the completion path. Rotation is not completion — otherwise it binds a credential while leaving the
      outstanding completion token live against a now-usable Connector.
- [x] 3.6 **`delete` handles a pending Connector**: the `credentialRepo.delete(existing.credentialId, …)`
      call becomes conditional on the `Option`; deleting a pending Connector removes the row, cascades its
      completion tokens, and binds nothing. Test it — the design's "abandoned pending Connectors are
      deletable" claim is only true if this works.
- [x] 3.7 **`WorkspaceContextService.buildConnectors` (`findAll`, line ~253)** carries `pending` in the agent-facing
      `ConnectorSummary`, so an agent cannot mistake a pending Connector for a usable one. This is a
      `findAll` call site, not `findById*`.
- [x] 3.8 Assert **both** `ImplicitConnectorConfig` synthesis points still always produce a **complete**
      Connector and never a pending row: `RestSourceConnectorMigration` (`connectorRepo.create`, ~131) and
      `SourceService` (~138, the legacy bare-`url` path). Write sites, not chokepoints.

## 4. Completion endpoint

- [x] 4.1 `ConnectorCompletionValidator` mirroring `ShareTokenValidator`: one privileged lookup by hash,
      all state checks in memory, every failure mode returning one indistinguishable result.
- [x] 4.2 Optional-auth route mounted beside `PublicDashboardRoutes` inside
      `authDirectives.optionalAuthenticate` in `ApiRoutes` (retaining rate-limiting and CSRF). Token and
      credential travel in the **body**, never the query string (design.md D5).
- [x] 4.3 Binding writes through the existing envelope-encrypted `ConnectorCredentialRepository.create`
      path only. Encryption failure refuses the request, binds nothing, and does not consume the token.
- [x] 4.4 Expiry defaults to **60 minutes** with `expires_at NOT NULL`. Configuration may set a shorter or
      longer value; the code clamps with `min(configured, 24h)` against a hard-coded **24-hour ceiling**,
      which is reachable and is the worst case the threat model is argued against (design.md D9). No separate owner status endpoint is built — dropped deliberately; the owner
      sees pendingness through the connectors list (6.3) and the agent learns implicitly (D7).
- [x] 4.5 When the completion request carries an authenticated session, that user MUST be the Connector's
      owner (an authenticated non-owner is refused). An unauthenticated completion stays allowed — that is
      the point of an out-of-band handoff.
- [x] 4.6 **Re-mint (design.md D9) — no dead ends.** `create_connector` against an existing pending
      Connector matching on **owner + kind + normalized base URL + intended auth shape** re-mints on that
      row instead of duplicating. Implement the normalization exactly as D9 states (lowercase scheme/host,
      drop default port, strip one trailing slash, path/query case-sensitive, no DNS). A differing auth
      shape creates a separate pending Connector rather than stranding the human on the wrong form. On
      multiple matches the most recently created wins.
- [x] 4.6a **Owner re-mint endpoint**: `POST /api/connectors/:id/completion-token`, authenticated and
      owner-scoped, standard not-found mapping for non-owner or non-pending. Response carries the token
      secret and `expiresAt` — the only response that ever does, never re-readable. Add its wire shape to
      `schemas/` and `openspec/` under task 7.1.
- [x] 4.6b **Minting is atomic with superseding** (design.md D9), exactly as binding is atomic with
      consumption (D3): one transaction sets `superseded_at` on every live token for that Connector and
      inserts the new one — never a window with two live tokens or none. Test the concurrent case, and
      specifically the **supersede-vs-consume race**: a token validated as live, then superseded while its
      submission is in flight, must NOT bind.
- [x] 4.6c **Owner-visible completion signal (design.md D10).** Add `completed_at` and `completed_by` to
      `connectors` in the migration (task 1.2) — `completed_by` records the authenticated principal or an
      explicit `anonymous`. Do NOT derive the signal from `connector_completion_tokens.consumed_at`: that
      row is cascaded on delete, and a bare timestamp cannot distinguish a teammate from a transcript
      reader. The connectors list surfaces both, and the owner re-mint endpoint reports
      "already completed" distinctly from "not found" **to the authenticated owner only**. The anonymous
      completion endpoint's responses stay byte-identical across every failure mode — verify both halves,
      since the whole residual-risk acceptance rests on this signal existing.
- [x] 4.7 Test the full expiry-recovery path end to end: a token expires, completion is refused, a re-mint
      succeeds, and the human completes with the new token. Ticket AC "the completion URL expires, and
      expiry behavior is specified and tested" is not satisfied by only asserting that an expired token
      authorizes nothing.

## 5. helio-mcp

- [x] 5.1 `create_connector` creates a pending Connector for a credentialed host and returns
      `connectorId` + completion URL. Keep `authType` a `z.string()` so any value reaches the handler.
- [x] 5.2 `.strict()` schemas and every `rejectCredentialField` entry stay exactly as they are. Add no
      parameter that could carry a secret; `helioApi`'s hardcoded `credential: ""` stays hardcoded.
- [x] 5.3 Update the pending-Connector error message from `create_rest_data_source` to name the completion
      state and URL.

## 6. Frontend

- [x] 6.1 Completion page on a route **outside** `ProtectedRoute` (`AppRoutes.tsx`'s public-dashboard
      precedent), reusing `ConnectorCredentialField`. Follow `DESIGN.md`.
- [x] 6.2 An unauthenticated service call for submission — do not reuse the authenticated
      `connectorEntityService` thunks. Credential stays in local `useState` for the submit's lifetime only.
- [x] 6.3 Surface pending status on the existing connectors page, AND the D10 owner-visible
      completion signal (when/by-whom a Connector was completed, distinguishing an anonymous
      completion from a named principal) -- skeptic-final-1.md CR3 restored the by-whom/when half
      this line had quietly dropped.
- [x] 6.4 Do not modify `ActionsMenu` or `MobileNavSheet` (HEL-1003 owns them). Escalate if the change
      wants them.

## 7. Contracts

- [x] 7.1 Add/extend `schemas/sources/*.schema.json` for the new wire shapes and update `openspec/` in this
      same change (CLAUDE.md API-contract rule). Note no connector schema file exists yet — follow the
      kebab-case `<name>.schema.json` convention.
- [x] 7.2 Run `npm run check:schemas`.

## 8. Tests and evidence

- [x] 8.1 Fetch-time guard: assert **no decryption occurred** using a *recording* credential repository, so
      the assertion can actually fail. A repo-less fixture never decrypts and would pass vacuously.
- [x] 8.2 Before demanding any mutation, confirm the red arm can fire; confirm each failure isolates to the
      intended step, and that two mutations are not one axis wearing two labels.
- [x] 8.3 Token tests: expiry boundary is exclusive; single-use replay refused; failed submission does not
      consume; expired/consumed/nonexistent are byte-identical to the caller; no failure path costs an extra
      query.
- [x] 8.3b Test that a superseded token and a consumed token are both caller-indistinguishable from expired
      and nonexistent (design.md D9) — the second invalidation event must not become an oracle. Test the
      owner-side distinguishability of D10 separately, and confirm it does not leak into the anonymous
      endpoint.
- [x] 8.3a Test that `rotateCredential` against a pending Connector is refused (3.5), that an authenticated
      non-owner cannot complete (4.5), and that deleting a pending Connector succeeds and cascades its
      tokens (3.6).
- [x] 8.4 Assert response **content**, not only status codes — a completed Connector must actually become
      usable, demonstrated by the source-creation call succeeding.
- [x] 8.5 HEL-828 regression: denylist and `.strict()` tests survive unchanged and still fail on a
      credential-shaped key.
- [x] 8.6 Assert no credential value appears in any response body or log on any path.
- [x] 8.7 Never place a real credential in a fixture, test, comment, or ticket. Run
      `npm run check:no-credential-leak`.
- [x] 8.8 Run `npm run lint`, `typecheck`, `format:check`, `check:schemas`, `check:scala-quality`,
      `check:openspec`, and the frontend/backend test suites.
- [x] 8.9 **helio-mcp is not selected by CI (HEL-1004).** Verified at planning time: `helio-mcp` has no
      `test` script of its own, but the ROOT `jest.config.cjs` does collect its tests — `npx jest
      --listTests` returns 24 files under `helio-mcp/src/**`. So run the root suite AND
      `npm run check:helio-mcp-types`, name the helio-mcp test files that ran, and state their results
      explicitly. A green CI summary does not cover this package.
- [x] 8.10 Delete any database rows this run created and confirm the deletion by querying afterwards, not
      by the delete command's exit status. Report what the run modified.

## 9. Gate-Chain Implications Checklist

- [x] 9.1 If any `.husky/**` file or a script it invokes is touched, add a `## Gate-Chain Implications
      Checklist` section to `design.md` answering: What does it execute? What environment does it inherit,
      and from where? Does it write anything outside its own sandbox? Does it behave differently from a
      linked worktree than from a main checkout? What happens on its first run? Otherwise record that the
      diff touches no gate-chain file.
