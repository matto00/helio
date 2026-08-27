## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence)

Read all four artifacts fresh; every claim re-derived from the worktree tree and from
dependency sources, not from the orchestrator's summary.

**CR1 (ephemeral-path contradiction) — FIXED, all four artifacts now agree on literal passthrough.**
- proposal.md:14-18 — "left as **literal text**, unchanged", with the backward-compatibility rationale.
- design.md:26-38 — Non-Goals, "resolved as literal passthrough, not fail-loud"; `TemplateInterpolator.resolve` never called there.
- tasks.md:17 (3.2) — "do NOT call `TemplateInterpolator` here", plus a code comment requirement.
- spec.md:8-12 and :28-30 — the fail-loud Requirement is now explicitly scoped to the `connectorId`-resolving path; the unconditional "or passed through literally" clause that round 1 flagged is gone.
- New test tasks.md 4.9 covers the ephemeral behavior. The false "called from both" claim in proposal.md is corrected.
- Independently checked the deviation from the ticket's own "Insertion point" prose ("a single shared interpolation function, called from both"): that prose's premise is factually wrong — `buildEphemeralRequest` takes `EphemeralRestConfig` (RestApiConnectorDriver.scala:242-246), which has no `parameters` store. The AC itself only requires authoring-time vs run-time parity, both reachable via `buildResolvedRequest`. Deviation is justified and documented, not silent.
- Also confirmed the passthrough is actually reachable: `Uri.apply` defaults to `ParsingMode.Relaxed` (Uri.scala:242) and `relaxed-path-segment-char = VCHAR -- "%/?#"` (CharacterClasses.scala:64), so `{`/`}` in a bare `url` parse today. The "works today and must keep working" claim survives.

**CR2 (spray-json default-value trap) — FIXED and accurate against the real code.**
- `RestApiConfigPayload` (DataSourceProtocol.scala:142-151) — confirmed all eight existing fields are `Option[...] = None`; the prescribed `parameters: Option[Map[String,String]] = None` matches the sibling pattern exactly.
- `toDomain` (:332-355) — confirmed the existing `.getOrElse(Map.empty)` idiom for `queryParams`/`headers`; design.md:81-82 / tasks 1.2 follow it.
- `fromDomain` (:357-367) — confirmed `queryParams`/`headers` already emit `None` when empty; the `None`-when-empty rule for `parameters` (design.md:83-85) genuinely preserves encode-side byte-identity.
- Both `jsonFormat8` sites confirmed live and correctly cited: `DataSourceProtocol.scala:391` (full path `backend/src/main/scala/com/helio/api/protocols/sources/DataSourceProtocol.scala`) and `DataSourceConfigCodec.scala:20`. Both named in tasks 1.2.
- Decode-regression test added as tasks 4.6a, asserting no-`parameters`-key blobs decode to `Map.empty` rather than the `__malformed__` sentinel. This is exactly the regression CR2 existed to prevent.

**CR3 (`URLEncoder` wrong for path segments) — FIXED, and the replacement is verified correct.**
- design.md:119-129 now specifies Pekko `Uri.Path.Segment` rendering and explains precisely why `URLEncoder` was wrong (`+` for space in a path).
- Verified in pekko-http-core 1.1.0 sources (`Uri.scala:1020-1028`): `renderPath` encodes each `Path.Segment` keeping only `pchar-base` = `unreserved ++ sub-delims ++ '@' ++ ':'` (CharacterClasses.scala:55-56). Therefore space → `%20`, and `/`, `?`, `#` are percent-encoded — the path-injection property design.md claims actually holds. `*` and `~` are sub-delim/unreserved and are correctly left literal (RFC 3986-legal), matching design.md:128.
- Verified the helper is buildable as described: `Path.toString` renders through `UriRendering.PathRenderer` (Uri.scala:588), so segment encoding is not lost by a naive `toString`.
- tasks 4.4 adds the space + `*` test and pins "space must become `%20`, not `+`".

**CR4 (no update path for `parameters`) — FIXED as an explicit stated limitation.**
- design.md:92-104 (Decision 2b) states create-time-only outright, correctly notes this is a pre-existing gap for *every* `RestApiConfig` field (confirmed: `UpdateDataSourceRequest(name: Option[String])`, DataSourceProtocol.scala:107), and names HEL-827 as the follow-up candidate rather than filing new scope. This is the "state it in Non-Goals with the follow-up named" branch of CR1's requirement, honestly done.

**Re-checked the rest of the design for soundness (unchanged findings from round 1 re-verified, not assumed):**
- Decision 4 credential unreachability still structurally true: `credentialValue` (RestApiConnectorDriver.scala:116) reaches only `buildAuthHeaders` (:141) and `injectAuthQueryParam` (:149); never merged into `config.headers`/`queryParams`/any interpolation map.
- Decision 3 query-param reasoning still correct: `uri.withQuery(Uri.Query(uri.query().toMap + (k -> v)))` at :119-120 percent-encodes on render.
- Decision 6 auth-header collision still fixed on main: `authHeaderNames` filter at :131-134.
- No new contradictions between proposal/design/tasks/spec introduced by the revisions; no `TODO`/`TBD`/deferred-decision placeholders remain in any of the four artifacts.

### Verdict: CONFIRM

All four round-1 change requests are genuinely resolved in the artifact text, and each fix's
technical premise holds against the actual dependency and application sources rather than
against assertion. The design is implementable as written.

### Non-blocking notes

- **AC test enumeration is slightly narrower than the ticket.** The ticket's AC says values are escaped correctly "including `&`, quotes, newlines, and unicode in **both a query param and a JSON body**". tasks 4.4 covers `&` in a query param and quote/newline/unicode in the body, but no quote/newline/unicode case in a query param. Cheap to widen 4.4's query-param case to carry a quote, a newline, and a non-ASCII character — the final gate will trace this AC literally.
- **tasks 4.9's "literal text" expectation needs care in the assertion.** On the ephemeral path the placeholder survives unresolved, but `Uri` rendering percent-encodes the braces (`%7B%7B`) since `{`/`}` are outside `pchar-base`. The test should assert "unchanged from pre-change behavior / not resolved and not failed", not a raw `{{` substring on the rendered URI.
- **tasks 1.3 is close to a no-op as written.** `CreateSourceRequest` (DataSourceProtocol.scala:166-171) already embeds `config: RestApiConfigPayload`, so once 1.2 lands, `parameters` threads through create automatically. Harmless, but the executor should not go looking for a separate field to add.
- Round 1's notes still stand and were not required to be addressed: spec.md's `body` clauses are now correctly hedged ("verified at the interpolator level ... not yet attached", spec.md:11-12/:57-59) — that note is resolved. The `parameters`-is-plaintext-and-unredacted observation (`HasSecrets[RestApiConfigPayload] = HasSecrets(Set.empty)`, :375) is still uncharacterized in the artifacts; one sentence saying `parameters` is explicitly not secret storage would close it.
- Environmental (unchanged): this worktree's `scripts/concertino/` is stale relative to `main`; I ran the report scripts from `/home/matt/Development/helio/scripts/concertino/`.
