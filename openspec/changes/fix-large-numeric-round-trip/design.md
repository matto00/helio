## Context

`DataTypeRowRepository.listRows` (backend/src/main/scala/com/helio/infrastructure/persistence/pipelines/DataTypeRowRepository.scala:80)
calls `.parseJson.asJsObject` on each row's Postgres `jsonb::text` cast, using spray-json's
zero-arg `parseJson` extension, which defaults to `JsonParserSettings.default`
(`maxNumberCharacters = 100`, `maxDepth = 1000`). Verified against spray-json 1.3.6 sources
(`~/.cache/coursier/.../spray-json_2.13-1.3.6-sources.jar`, `JsonParser.scala:142-147`,
`JsonParserSettings.scala`): the check is `numberLength <= settings.maxNumberCharacters` — a
literal whose character length is **exactly** 100 already parses fine; only a length **> 100**
throws `ParsingException`. The ticket's ">=100 chars" framing is an off-by-one from the true
boundary; design/tests below use and report the verified boundary (100 passes, 101 fails).

`JsonParserSettings` exposes `withMaxNumberCharacters(Int)`, and `parseJson` has an overload
accepting settings (`string.parseJson(settings)` / `JsonParser(input, settings)`) — this is a
first-class, supported spray-json extension point, not a hack.

## Goals / Non-Goals

**Goals:**
- Make `listRows` round-trip any numeric value Postgres `jsonb` (arbitrary-precision `numeric`) can
  hold — including magnitudes well beyond `double precision`'s range — without weakening any other
  structural JSON validation (`maxDepth` unchanged). See Risks/Trade-offs for the residual,
  explicitly-documented limit of the chosen 400-char cap.
- No storage-format or migration change — this is a pure read-path (application-code) fix.

**Non-Goals:**
- Changing `overwriteRows`/the write path — it already round-trips correctly into Postgres; the
  defect is entirely in `listRows`'s re-parse of the read-back text.
- Changing the `data_type_rows.data` column type or any migration.
- Fixing unrelated `.parseJson` call sites — audited (corrected per design-gate skeptic round 1):
  `DataTypeRepository`, `MetricRepository`, `PanelRowMapper`, `PatchSetApplicationRepository`,
  `ApiTokenRepository`, `DashboardRepository`, `AuthoringConversationRepository` do not re-parse
  arbitrary Structured-value numeric data the way `listRows` does — not touched, not a shared
  defect. **`AlertEventRepository.scala:31` (`value = row.value.parseJson`, backing
  `value JSONB NOT NULL` in `V61__alert_events.sql:29`) and `AlertRuleRepository.scala:30`
  (`condition = row.condition.parseJson`) DO share the identical failure mode**: `value` is
  documented as "the observed metric value" sourced from the same DataType-row numeric data this
  ticket's fix addresses, parsed with spray-json's default (unraised) 100-char settings. This is
  reported per the ticket's AC — findings only, NOT fixed here; fixing it would widen scope beyond
  `DataTypeRowRepository` and requires its own ticket/escalation, per the driver's explicit
  scope-guidance constraint.

## Decisions

**D1: Raise `maxNumberCharacters` via `JsonParserSettings` at the `listRows` call site only.**
Use `raw.parseJson(JsonParserSettings.default.withMaxNumberCharacters(400))` (400 chars is
comfortable headroom over the ~309-digit max-`double` plain-decimal expansion, covering a sign
character, an optional decimal point, and future safety margin, while still bounding runtime —
spray-json's own limit exists because `BigDecimal` construction is ~quadratic in character count,
and 400 stays cheap). This is a one-line, additive change scoped to the single call site that has
the defect — no new dependency, no schema change, no migration.

Alternatives considered:
- *Round-trip large numbers as `text` at the repository boundary* (ticket's suggestion #2): would
  require changing what `JsObject` shape callers receive (a string instead of `JsNumber`) or a
  custom pre-parse rewrite step — meaningfully larger blast radius across every caller
  (`PipelineRunService`, `BoundPanelService`, etc.) for no benefit over D1, since spray-json
  already supports exactly this via settings. Rejected — solves a problem D1 doesn't have.
- *Global `maxNumberCharacters` raise via a shared implicit/JsonProtocols default* (ticket's
  suggestion #1, "globally"): broader blast radius than necessary — every other `.parseJson` call
  in the codebase would silently accept longer numbers too, undermining the "check for any other
  reason it's capped" caution the ticket itself calls out. D1 scopes the raise to the one call
  site that actually needs it.
- *Read-path canonicalization avoiding re-parse entirely* (ticket's suggestion #3): would mean
  hand-rolling numeric literal handling outside spray-json's parser — more code, more risk, no
  advantage over the built-in settings knob. Rejected.

**D2: No migration/storage-format change — confirms the ticket's own escalation gate is not
triggered.** D1 is purely additive application code; `data_type_rows` schema, the `jsonb` column
type, and every already-persisted row are untouched. Per the ticket's own scope constraint
("STOP and escalate... before implementing" for a storage-format/migration change), this decision
explicitly does NOT require escalation — recorded here so the skeptic/evaluator can verify the
constraint was actually evaluated, not skipped.

**D3: Regression test targets `DataTypeRowRepository` directly (DB-backed), not through
`WorkspaceContextService`'s all-DataTypes fan-out.** HEL-373's own postmortem (see ticket) shows
routing this exact defect through the fan-out poisons 8 unrelated tests in the same spec file.
Testing `overwriteRows`/`listRows` directly avoids that blast radius while still exercising the
real Postgres `jsonb::text` cast (a pure-unit test with a hand-written JSON string would not
reproduce Postgres's own canonicalization behavior, which is exactly what causes the >100-char
strings in the first place).

## Risks / Trade-offs

- [Risk, corrected per design-gate skeptic round 1] The cap is NOT bounded by `double precision`.
  `V29__data_type_rows.sql:5` declares `data JSONB NOT NULL` — Postgres `jsonb` numerics are
  arbitrary-precision `numeric`, and `overwriteRows` (`DataTypeRowRepository.scala:26-33`) writes
  `row.compactPrint::jsonb` from an arbitrary `BigDecimal`-backed `JsNumber` with no range check.
  A perfectly writable value such as `1e400` (large exponent) or `5e-324` (a denormal-magnitude
  fraction, ~325-char plain-decimal expansion) is not bounded by the max-`double` 309-digit figure
  this section previously argued from. **This is a known, explicitly-recorded residual limit, not
  a claim that 400 is sufficient for every writable value**: raising the cap to 400 moves the
  write-succeeds-then-read-throws ceiling from ~100 chars to ~400 chars; it does not eliminate the
  class of defect for pathological inputs beyond that. Closing it fully would mean either capping
  what `overwriteRows` accepts (a write-path/validation change, out of scope for this ticket per
  proposal.md Non-goals) or removing the character cap entirely (reintroducing the quadratic
  `BigDecimal`-construction cost concern below, unbounded). 400 is chosen as a large, practical
  improvement — not a mathematically total fix — and this trade-off is deliberate and documented,
  not an oversight.
- [Risk] Raising the cap increases worst-case `BigDecimal` construction cost per row →
  Mitigation: cost is bounded by the 400-char cap itself (quadratic in a small, fixed N), and only
  applies to the pathological long-number case — ordinary rows are unaffected.

## Planner Notes

- Self-approved: scoping the settings raise to the single `listRows` call site (D1) rather than a
  global default, and not pursuing the ticket's suggestions #2/#3 — both are self-approvable
  design decisions within the ticket's own "pick one at triage" framing, not scope changes.
- No external dependency, no breaking API change, no migration — none of Planning's own escalation
  triggers apply. The ticket's driver-supplied "escalate before migration" constraint is
  confirmed NOT triggered (D2) and is not itself a reason to escalate.
