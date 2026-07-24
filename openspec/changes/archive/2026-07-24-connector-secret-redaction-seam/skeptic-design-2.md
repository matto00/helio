## Skeptic Report — design gate (round 2)

### What I verified (with evidence)

- Read `ticket.md`, `proposal.md`, `design.md`, `specs/connector-secret-redaction/spec.md`,
  `tasks.md`, and `workflow-state.md` in full, fresh (not from round-1's narrative).
- **Round-1 fix verification (the specific ask for this round):** grepped all four artifacts
  for `Redacted` — the only remaining occurrences are in `design.md` lines 64–65, inside
  Decision 2's description of the *rejected* alternative, correctly framed as "No `Redacted[Config]`
  wrapper type... Considered:... Rejected:...". `proposal.md` "What Changes" bullet 2 (lines 12–14)
  and "Impact" (lines 42–44) now both correctly state the actual mechanism:
  `SecretRedaction.redact(payload)` called at `DataSourceResponse.fromDomain`, returning a plain
  `Config` with unchanged field types, no wrapper. No stray mention survived anywhere in
  `proposal.md`, `spec.md`, or `tasks.md`. The round-1 trap (implementer following proposal.md
  alone building the wrong thing) is fully closed.
- **Ground-truth check of the code the design describes**, not just internal artifact consistency:
  read `backend/src/main/scala/com/helio/api/protocols/DataSourceProtocol.scala` lines 178–255
  (`fromDomain`, `redactRestPayload`/`redactRestAuth`/`redactSqlPayload`) — matches design.md's
  Context section verbatim (SQL empty-password exemption via `p.password.isEmpty`, REST
  Option-presence masking via `a.token.map(_ => "***")`/`a.value.map(_ => "***")` gated on the
  `type` discriminator).
- Read `backend/src/test/scala/com/helio/api/protocols/DataSourceProtocolSpec.scala` lines 1–65
  and 135–174: confirmed the existing discriminated-union round-trip tests construct
  `RestSourceResponse`/`SqlSourceResponse` directly with raw `RestApiConfigPayload`/
  `SqlSourceConfigPayload` values (lines 34–41, 48–55) — this is the concrete evidence backing
  Decision 2's rejection of the `Redacted[Config]` wrapper (it would break these constructions).
  Confirmed the existing "credential redaction" block (lines 135–174) asserts on helper return
  values, not serialized JSON — exactly the gap the new task 2.1 JSON-serialization tests are
  meant to close, and this existing block is left untouched by every artifact.
- Read `backend/src/main/scala/com/helio/domain/Connector.scala` in full — confirmed it currently
  has **four** doc blocks (`'''Refresh semantics'''`, `'''ExecutionContext'''`, `'''Schema
  inference'''`, `'''Fetch-error envelope'''`), not three. `proposal.md`, `spec.md`, and `tasks.md`
  each describe the new `'''Secret redaction'''` block as sitting "alongside the existing three
  blocks" — an undercount by one. Noted below as non-blocking (doesn't create ambiguity about
  what to do).
- Checked `com.helio.services/` for the cited precedent files (`SchemaInferenceFacade.scala`,
  `CreateSourceEnvelope.scala`) — both exist, confirming design.md's placement precedent is real,
  not invented.
- Grepped for inline FQNs (`com\.helio\.[A-Za-z]+\.[A-Za-z]+`) across all artifacts — only hits are
  `com.helio.api.protocols` / `com.helio.services.SecretField.scala`, both prose references to
  package/file locations describing architecture, not inline-qualified Scala code identifiers.
  `check:scala-quality` (CONTRIBUTING.md line 119, 123) operates on `.scala` source, not planning
  docs; this doesn't trip the rule any artifact author would violate in code.
- Mechanical enforcement re-verified against spec.md's two requirements ("Missing declaration is a
  compile error, not a silent gap" and "Redaction is verified against the actual serialized JSON")
  and design.md's Risks section — the honest disclosure that a *new* connector's `fromDomain` case
  skipping `redact` entirely isn't compile-time-prevented, with the JSON-assertion test named as
  the load-bearing mitigation, is unchanged and still sound.
- `SecretBackend` extension point: `design.md` Decision 3 / `spec.md`'s "exactly one concrete
  implementation" requirement / `tasks.md` 1.1 all agree — one trait, one object
  (`InlineSecretBackend`), defaulted parameter, doc comment naming HEL-536, no dangling case.
- Boundary compliance re-checked: no env-var switch, no Flyway migration, no non-inline
  `SecretBackend` case anywhere in the four artifacts — matches the amended ticket scope exactly.
- Checked ticket AC1's "both API responses and logs never emit raw secret values" against actual
  connector code (`SqlConnector.scala`, `RestApiConnector.scala`): all `log.error(...)` calls log a
  curated category-prefix string plus the caught exception (`e`), never the config object itself
  (HEL-311 precedent already strips raw driver/exception tails). No code path in the connectors
  logs a config or auth value directly, so the "logs" clause of AC1 is already vacuously true today
  and this ticket doesn't need to (and doesn't) touch logging. None of the four artifacts mention
  logs — this is a defensible scoping choice, not a gap that would cause an implementer to miss
  something, but flagged as a non-blocking note since the AC text technically mentions it.

### Verdict: CONFIRM

The round-1 fix is complete and consistent — no stray `Redacted[Config]` references anywhere,
proposal.md's "What Changes"/"Impact" sections now match design.md/spec.md/tasks.md exactly, and
every claim in design.md that I could check against real source code (existing redaction logic,
existing test constructions, precedent module files, `Connector.scala`'s doc-block structure) holds
up. The redaction guarantee is mechanically enforced (implicit resolution at the one call site +
JSON-serialization test, not just documentation), the `SecretBackend` extension point has no
dangling case, byte-identical behavior is backed by concrete test tasks against both the pre-existing
unmodified test block and new JSON assertions, and no inline FQNs appear in any artifact.

### Non-blocking notes

1. `proposal.md`, `spec.md`, and `tasks.md` (task 1.5) describe the new `'''Secret redaction'''`
   doc block as going "alongside the existing three blocks" in `Connector.scala`. The file
   currently has four (`'''Refresh semantics'''` predates the three named). Minor undercount —
   doesn't create ambiguity for the implementer (add the new block near the others, same style),
   but worth a one-word fix ("three" → "four") if convenient during implementation.
2. Ticket AC1 mentions "logs never emit raw secret values" but no artifact addresses logging.
   Verified this is currently vacuously true (no connector logs config/auth values), so no
   implementation gap exists — but design.md could note this explicitly for completeness/audit
   trail on a security-sensitive ticket rather than leaving it silently unaddressed.
