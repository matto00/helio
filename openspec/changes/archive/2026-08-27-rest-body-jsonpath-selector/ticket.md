# HEL-826: REST request body + persisted response shaping (jsonPath is currently UI-only fiction)

## Description

Child 5 of HEL-820 (Connectors epic). Depends on child 3 (HEL-823, merged).

Two outright gaps in the REST source model:

**Gap 1 — no request body exists.** `RestApiConfig` (backend/src/main/scala/com/helio/domain/model/model.scala) has no `body` field. A POST/PUT source with a payload is not expressible at all. `RestApiConnector.buildRequest` constructs the request without one. Add request-body support: the payload itself, content type, and how it interacts with `method` (a body on a GET should be rejected or warned, not silently sent).

**Gap 2 — `jsonPath` is declared but not real.** The frontend's `RestApiConfigBody` declares `jsonPath?`, and `RestApiForm.tsx` renders a field for it, but `jsonPath` is not part of `RestApiConfig` or `RestApiConfigPayload` and there is no backend handling of it. CONFIRMED via direct read (see premise-validation.md / design.md): spray-json silently drops the unknown field at the payload→domain-model deserialization boundary. Never persisted, never read, never applied.

## Resolved scope decision (escalated to and answered by the human coordinator, 2026-08-27)

HEL-599 (v1.9, epic HEL-427, unstarted) is a fuller, dedicated response-shaping ticket covering root selector + bounded-depth flatten + pagination-loop composition + curated `fetchError` (HEL-468) + HEL-473 inference-facade integration. This ticket builds a **minimal root-selector slice only**, as a strict subset of what HEL-599 will ship:

- Same dot-path convention HEL-599 will use.
- Unset selector behaves byte-identically to today's `toRows` (top-level array → rows, single object → one row).
- Explicitly NOT building: bounded-depth flatten to dotted columns, pagination-loop composition, curated `fetchError` envelope, HEL-473 inference-facade integration. These remain HEL-599's job.

Rationale: most real REST APIs wrap their results (`{"data": [...]}`, `{"items": [...]}`). With zero root selection, this epic would ship REST sources that cannot consume a typical API — that's what makes a minimal selector genuinely valuable rather than a placeholder, while staying strictly inside HEL-599's future surface so HEL-599 extends rather than rewrites this code.

## Acceptance criteria

- [ ] A REST source can carry a request body with a content type, and it is actually sent — demonstrated against a real endpoint that echoes the payload
- [ ] Body + method interaction is defined (what happens on GET) and tested
- [ ] The `jsonPath` question is resolved via a minimal root-selector: it persists and applies end to end (form input → shaped rows), strictly scoped per the resolved scope decision above. Not left decorative.
- [ ] Body participates in templating per HEL-823 (reuses `TemplateInterpolator`, does not invent a second templating path), with correct escaping for the content type
- [ ] Overlap with HEL-599 reconciled and the decision recorded in design.md, with the deliberately-deferred capabilities enumerated explicitly

## Security contracts (carried from HEL-823, must remain true)

- The raw credential is never returned by any read path and is decrypted only at the outbound call.
- No template may reference the credential (test hostile `{{apiKey}}`/`{{credential}}`/`{{secret}}` templates in the body, exactly as HEL-823 did for other fields).
- A request body is a new injection surface: a templated value inside JSON must not break out of its string context. Test with quotes, newlines, unicode, and control characters, not just happy-path values.

## Known inherited defects to decide on deliberately (not silently pass along a 4th time)

- `splitUrl` uses `uri.query().toMap`, silently collapsing repeated query keys (`?tag=a&tag=b` → one entry). Known silent-corruption class (HEL-814, HEL-671).
- Auth-header collision: `buildResolvedRequest` emits `headers = authHeaders ++ baseHeaders` and only dedupes source headers against `defaultHeaders`, not against auth headers — a source header colliding with `Authorization` or the Connector's `apiKeyName` puts BOTH on the wire.

## Out of scope

- Pagination (HEL-591), OAuth2 (HEL-595), rate limiting (HEL-597) — all v1.9.
- Form parity + dual-support retirement (HEL-827) — do not touch HEL-822's dual-support path.
- Agent/MCP surface (HEL-828).
- In-chat credential capture (HEL-829).
- Flatten, pagination composition, curated fetchError envelope, HEL-473 inference-facade integration for response shaping — deferred to HEL-599 per the resolved scope decision above.

## Additional driver notes

- Note in the PR body whether spray-json's silent-unknown-field-drop (the root cause of gap 2) is structurally prevented anywhere else, or purely conventional — this is a triage finding for the coordinator, not scope to fix here.
- Confirm (not merely assert) that the unset-selector path is byte-identical to today's behavior, and that no migration is needed since nothing was ever persisted.
- If deferring either inherited defect above, say so explicitly in the PR body so the coordinator can file it.
