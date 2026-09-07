## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

- **Read all artifacts**: ticket.md, proposal.md, design.md (D1–D8), tasks.md (sections 1–9), and all
  five spec deltas under `specs/` (mcp-data-source-tools, connectors/connector-management,
  connectors/connector-completion-token, connectors/connector-credential-binding,
  connectors/pending-connector-handoff).

- **D4 chokepoint enumeration, checked against the tree, not the summary.**
  `grep -rn "findByIdOwned\|findByIdInternal" backend/src/main --include=*.scala` — for
  `ConnectorRepository` specifically the call sites are:
  `RestApiConnectorDriver.scala:77,78`, `SourceService.scala:182` (`checkConnectorKind`),
  `ConnectorEntityService.scala:45,100`. That is **three** files, not four; design.md's Context
  names `WorkspaceContextService` as a fourth, but that file uses `connectorRepo.findAll`
  (`WorkspaceContextService.scala:246-247`), not either `findById*`. The enumeration of the two
  named methods is otherwise correct and complete. **However** the enumeration is scoped to
  `findById*` only, and that is where it misses things — see CR1/CR2.

- **The real consumers of `Connector.credentialId`** (`grep -rn "\.credentialId"`), which is what
  actually breaks when the field becomes `Option`:
  `RestApiConnectorDriver.scala:125` (`credRepo.decryptForUse(connector.credentialId, ...)`) — covered
  by D4 guard 1; and, inside `ConnectorRepository` itself, `rotateCredential` (repoints
  `credential_id`, then `credentialRepo.delete(existing.credentialId, ...)`) and `delete`
  (`credentialRepo.delete(existing.credentialId, ...)`). Neither `rotateCredential` nor `delete` is
  mentioned anywhere in design.md or tasks.md. `rotateCredential` is a live, routed path
  (`ConnectorEntityRoutes.scala:98` → `ConnectorEntityService.scala:136,145`).

- **`SqlConnectorDriver` is genuinely not a chokepoint** — confirmed it holds no
  `ConnectorRepository`; design's exclusion is stated, not silent. Correct.

- **The `authType: "none"` conflation claim is true.**
  `ImplicitConnectorConfig.forLegacySource` (`ImplicitConnectorConfig.scala:20-22`) returns
  `("none", None, None, "")` for `RestApiAuth.NoAuth`, and `SourceService.scala:135-146` passes that
  literal `""` straight into `ConnectorRepository.create`, which mints a real
  `connector_credentials` row before inserting. So a no-auth Connector really does hold an
  encrypted empty string, and pending (`NULL`) is structurally distinct from it. D1's `Option`
  representation is **not** rationalization: it is strictly stronger than a status column here,
  because the compiler cannot be persuaded to skip an `Option`, and `NULL` cannot disagree with
  itself the way `status='complete' AND credential_id IS NULL` could.

- **Token contract vs. `share_tokens`.** Read `openspec/specs/share-link-tokens/spec.md` (86 lines)
  against `specs/connectors/connector-completion-token/spec.md` (110 lines). The four load-bearing
  requirements are carried over faithfully: CSPRNG ≥128 bits with no derivable input; validity
  predicate with an **exclusive** expiry boundary; byte-identical responses across
  expired/consumed/nonexistent *including* the "no failure path costs an extra query" clause; and
  secret-disclosed-only-at-mint. Both claimed divergences are in fact tightenings: `expires_at NOT
  NULL` removes the `share_tokens` "no expiry" arm (the completion spec explicitly states an
  unbounded token "SHALL NOT be representable"), and single-use consumption is strictly narrower
  than revocable-until-someone-revokes. The completion spec also adds a requirement `share_tokens`
  has no analogue for (token cannot complete a different Connector). This comparison holds up.

- **No second credential-write path is planned.** Task 4.3 and the
  `connector-credential-binding` delta both bind through `ConnectorCredentialRepository.create`
  and fail closed on encryption failure without consuming the token. Sound — subject to CR1, which
  is about a *pre-existing* second write path the plan does not account for.

- **MCP surface.** `helio-mcp/src/helioApi.ts:356` hardcodes `credential: ""` as a literal;
  `server.test.ts:230` holds the denylist (`auth/apiKey/token/password/credential`). Tasks 5.2 and
  8.5 keep both frozen and the `mcp-data-source-tools` delta re-asserts them. No planned route puts
  a *credential* into model context. But the completion **token** deliberately does — see CR3.

- **Task 8.1's recording-repository requirement is real, not ceremonial.** The assertion is "no
  decryption occurred", made against a recording `ConnectorCredentialRepository`; if the executor
  deletes the D4 guard-1 check, `decryptForUse` is reached at `RestApiConnectorDriver.scala:125`
  and the recorder observes the call, so the test goes red. It is failable by mutation, and the
  task correctly names the vacuous alternative (repo-less fixture) it exists to avoid.

- **Scope.** Large but a single coherent vertical slice: splitting it would leave either a nullable
  column with no writer or a token table with no consumer, each unshippable on its own. I do **not**
  recommend a split. Tasks 4.4 (owner status endpoint) and 6.3 (pending badge on the connectors
  page) are the only trimmable fat if the change runs long.

### Verdict: REFUTE

Three specific gaps. Each is a real hole in the plan, not a nit; all three are cheap to close in
the artifacts.

### Change Requests

1. **`ConnectorRepository.rotateCredential` is an unaddressed second bind path onto a pending
   Connector, and it can silently violate a requirement this change is adding.**
   `ConnectorEntityRoutes.scala:98` → `ConnectorEntityService.scala:136` →
   `ConnectorRepository.rotateCredential` mints a credential and repoints `credential_id`. Run
   against a *pending* Connector it completes that Connector through a path that knows nothing about
   completion tokens — leaving the outstanding token live against a now-usable Connector. That is
   precisely the state `connector-completion-token`'s "A pending Connector SHALL NOT remain an open
   slot after completion" forbids, and D3 exists to prevent. It also currently calls
   `credentialRepo.delete(existing.credentialId, ...)` on what becomes an `Option`.
   Add a decision to design.md (and matching tasks) stating what `rotateCredential` does when
   `credentialId` is `None`: either refuse (rotation is not completion) or treat it as a completion
   that also invalidates outstanding tokens. Do not leave this to be discovered as a compile error
   and improvised — it is a credential-binding path.

2. **`ConnectorRepository.delete` and the agent-facing `WorkspaceContextService` projection are
   missing from the enumeration.** `delete` calls `credentialRepo.delete(existing.credentialId, ...)`
   and must handle a pending Connector without failing (the design's own risk note says an abandoned
   pending Connector is "deletable through the existing owner CRUD path" — nothing in the plan
   actually establishes that). Separately, `WorkspaceContextService.buildConnectors`
   (`WorkspaceContextService.scala:246-247`) builds `ConnectorSummary` for the **agent's** workspace
   context via `findAll`; D6 adds `pending: Boolean` to the projection but tasks.md never names this
   call site, so an agent could see a pending Connector in workspace context indistinguishable from a
   usable one and bind a source to it. Add both to the D4 enumeration and to tasks section 3, and
   correct the Context line that names `WorkspaceContextService` as a `findById*` caller — it is a
   `findAll` caller.

3. **The completion token's transit through model context is the change's central security
   assumption and is never stated as a threat.** D6 says the token "is returned exactly once, in the
   `create_connector` result that mints it" — that result *is* the agent's context, and by extension
   its transcript and any logging around it. So a single-use bearer capability to attach a credential
   to the owner's Connector is deliberately deposited somewhere the human is not the only reader, and
   the human receives it only by way of the agent. D5 asserts "single-use and short-lived" as
   mitigation but never names the adversary those properties are mitigating. Add an explicit threat
   statement to design.md's Risks: who can read the token, what they can do with it (bind an
   attacker-chosen credential to the owner's pending Connector and thereby complete it — note they
   cannot *read* any secret), and why the chosen mitigations are judged sufficient. If the answer
   involves an additional control — e.g. binding completion to the owner's session when the human
   happens to be authenticated, or a materially shorter default expiry than the "conservative short
   default" currently left unspecified — decide it here rather than at implementation time. Also fix
   the associated hole in the plan: the expiry default is described as "configurable with a
   conservative short default" and never given a value, so it is currently unimplementable as
   written.

### Non-blocking notes

- The token contract, the `Option`-over-status-column decision, the no-second-write-path
  constraint, the recording-repository evidence requirement, and the helio-mcp-has-no-CI caveat
  (task 8.9) are all well above the bar. My objections are about coverage, not soundness.
- Task 8.2's "confirm two mutations are not one axis wearing two labels" and 8.10's
  "confirm deletion by querying, not by exit status" are exactly right and worth keeping verbatim.
- Consider whether task 4.4's owner status endpoint is needed at all: D7 says the agent learns of
  completion implicitly, and the owner already sees pendingness through the existing connectors
  list (task 6.3). It looks like the one piece of scope this change could shed.
