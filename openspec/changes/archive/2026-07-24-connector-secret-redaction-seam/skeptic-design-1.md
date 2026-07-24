## Skeptic Report — design gate (round 1)

### What I verified (with evidence)

- Read `ticket.md` in full, including the "SCOPE AMENDED" banner and HEL-536 boundary
  (lines 8–25, 44–110).
- Read `proposal.md`, `design.md`, `specs/connector-secret-redaction/spec.md`, `tasks.md`
  in full.
- Checked `CONTRIBUTING.md` lines 29, 119, 149 for the "no inline FQN" rule — none of the
  four OpenSpec artifacts contain an inline fully-qualified name.
- Boundary compliance: `proposal.md` "Impact"/"Non-goals" and `tasks.md` contain no env-var
  switch, no Flyway migration, and no non-inline `SecretBackend` case — matches the amended
  ticket scope. `design.md`'s "HEL-460 / HEL-536 boundary" section correctly frames the split
  without re-litigating it.
- Mechanical enforcement: `spec.md`'s "Missing declaration is a compile error, not a silent
  gap" requirement is backed by a real Scala mechanism (implicit `HasSecrets[Config]` resolution
  at `SecretRedaction.redact`'s call site) — not an unenforceable SHALL. `design.md`'s Risks
  section (lines 105–110) honestly discloses what this does *not* catch: a brand-new connector's
  `fromDomain` case that skips calling `redact` entirely is not compile-time-prevented; the
  JSON-serialization test (spec.md "Redaction is verified against the actual serialized JSON",
  tasks 2.1) is named as the load-bearing check for that gap today. This matches the review
  brief's ask exactly.
- `SecretBackend` extension point: `design.md` Decision 3 and `spec.md`'s "SecretBackend has
  exactly one concrete implementation today" requirement confirm one concrete case
  (`InlineSecretBackend`), no sealed-trait enumeration, no dangling unimplemented branch.
- Byte-identical behavior: `spec.md`'s "inline redaction reproduces today's exact wire output"
  requirement and scenarios (SQL empty-password exemption, REST Option-presence-triggers-masking)
  are backed by concrete test tasks (2.1–2.3) that assert against actual serialized JSON, and
  task 2.4 requires the pre-existing `DataSourceProtocolSpec` "credential redaction" block to
  pass **unmodified**.
- Test-file immutability / `Redacted[Config]` rejection: `design.md` Decision 2 (lines 64–77)
  explicitly rejects a `Redacted[Config]` wrapper type on the response case classes because it
  would change `SqlSourceResponse`/`RestSourceResponse.config`'s field types, breaking
  `DataSourceProtocolSpec`'s existing discriminated-union round-trip tests (which construct
  those response types directly with raw payloads). This reasoning is sound and matches the
  ticket's "existing tests must pass unmodified" constraint. `spec.md` and `tasks.md` both
  correctly follow this decision — neither mentions a `Redacted` type; `SecretRedaction.redact`
  returns a plain `Config`.

### Verdict: REFUTE

### Change Requests

1. `proposal.md` lines 12–14 ("What Changes" bullet 2) describes adding a `Redacted[Config]`
   wrapper "that can only be constructed via `HasSecrets[Config].redact`" where "a response
   `config` typed as `Redacted[X]` cannot compile without a `HasSecrets[X]` instance in scope."
   This is the *exact* approach `design.md` Decision 2 explicitly rejects (by name, with
   reasoning) because it breaks `DataSourceProtocolSpec`'s existing tests. Remove this bullet's
   `Redacted[Config]` description and replace it with the actual mechanism: `SecretRedaction.redact(payload)`
   is called at the one production call site (`DataSourceResponse.fromDomain`) and returns a
   plain, already-masked `Config` with unchanged field types — no wrapper, no field-type change.
2. `proposal.md` lines 42–44 ("Impact" section) states "`SqlSourceResponse`/`RestSourceResponse.config`
   field types change to `Redacted[...]`". Per design.md Decision 2, the response case classes'
   field types do **not** change (that's precisely why the wrapper was rejected — to avoid
   breaking `DataSourceProtocolSpec`'s round-trip tests, which the ticket forbids editing).
   Correct this line to state that `redactSqlPayload`/`redactRestPayload`/`redactRestAuth` are
   replaced by calls to `SecretRedaction.redact` with no change to the response case classes'
   field types.

An implementer who reads only `proposal.md` (a primary planning artifact) would build the
wrapper-type approach design.md says must not be built, and would be forced to edit the
existing `DataSourceProtocolSpec` tests the ticket explicitly protects — a direct violation
of the ticket's acceptance criteria and CONTRIBUTING.md's verification discipline. `spec.md`
and `tasks.md` are internally consistent with `design.md` and do not need changes for this
issue.

### Non-blocking notes

- None beyond the above — the rest of the design (SecretField/HasSecrets model, SecretBackend
  extension point, wire-payload-layer placement, HasSecrets-in-companion-object layering) is
  sound and well-justified against the ticket's constraints.
