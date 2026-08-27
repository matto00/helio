## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Worktree HEAD: `b3e866fd` (HEL-824). All code claims below re-derived by direct read, not from
the artifacts' narrative.

### What I verified (with evidence)

**Artifacts read in full:** `ticket.md`, `proposal.md`, `design.md`, `tasks.md`,
`specs/rest-api-connector/spec.md`.

**HEL-599 scope constraint honored — YES.** design.md Non-Goals + Decision 1 + spec.md
"Minimal response root-selector (jsonPath)" (spec lines 140-151) all name the same four
deferred capabilities as the ticket's resolved scope decision (flatten, pagination-loop
composition, curated `fetchError` envelope, HEL-473 inference-facade integration), and add a
fifth self-imposed narrowing (no array-index/wildcard syntax). Decision 1's "unset →
byte-identical, same 3-way match applied at the walk's end" keeps `toRows` extensible rather
than rewritable. No scope creep into HEL-599 territory found.

**Inherited-defect claim 1 — `splitUrl` duplicate-key collapse: design.md is CORRECT.**
`RestSourceConnectorMigration.splitUrl` (lines 82-89) returns `queryPairs.toMap` plus a
`hasDuplicateKeys` flag, and `migrateOne` (lines 130-138) does log the loud warning — so the
migration-time half is guarded, as design.md says. The *unguarded* half is also confirmed
present: `RestApiConnectorDriver.buildResolvedRequest` builds
`uri.withQuery(Uri.Query(uri.query().toMap + (k -> v)))` on every live request, silently
collapsing repeats. design.md's "confirmed still present, but only partially… deferred" is an
accurate reading of the code.

**Inherited-defect claim 2 — auth-header collision: design.md is CORRECT, the ticket text is
stale.** `RestApiConnectorDriver.buildResolvedRequest` already computes
`authHeaderNames = authHeaders.map(_.name().toLowerCase).toSet` and applies
`mergedHeaders.filterNot { case (k, _) => authHeaderNames.contains(k.toLowerCase) }` before
`headers = authHeaders ++ baseHeaders`. Case-insensitive, auth wins. Already fixed on main; no
action needed. tasks.md 6.4(b) correctly records this for the PR body.

**Other premises spot-checked and true:** `RestApiConfig.body: Option[String]` already exists
(model.scala:519) with no `bodyContentType`/`rootSelector`; `EphemeralRestConfig` (model.scala:529)
has only `url`/`method`/`headers`; `TemplateInterpolator.resolveJsonBody`/`jsonEscape` exist
(lines 90/106) with no production call site; `jsonPath` is frontend-only
(`RestApiForm.tsx`, `AddSourceModal.tsx:120,151`, `dataSourceService.ts:37`) and absent from
`RestApiConfigPayload` (DataSourceProtocol.scala:142-157) — so the "never persisted, no
migration needed" claim holds.

### Verdict: REFUTE

Three specific gaps. None touch the HEL-599 boundary or the defect calls (those are sound); all
three are "the design as written cannot reach its own acceptance criteria from the real UI."

### Change Requests

1. **`rootSelector` is missing from the ephemeral path, contradicting Decision 4 — and this
   silently breaks the create flow's schema inference.** design.md Decision 4 says
   "`inferSchemaEphemeral`/`fetchEphemeral` thread `rootSelector` into `toRows` the same way",
   and tasks.md 2.3 says to forward `body`/`bodyContentType`/**`rootSelector`** through
   `toEphemeral` — but Decision 4's own first sentence and tasks.md 1.2 give `EphemeralRestConfig`
   only `body`/`bodyContentType`. There is no field for `rootSelector` to be threaded into; an
   implementer following 1.2 then 2.3 hits a compile error and has to guess.
   This is not cosmetic. `AddSourceModal.handlePreview` (AddSourceModal.tsx:110-121) sends the
   user's `jsonPath` to `inferFromJson` → `SourceService.inferRest`'s `(None, Some(url))` branch
   → `toEphemeral` (SourceService.scala:216-221) → `inferSchemaEphemeral` →
   `toRows` (RestApiConnectorDriver.scala:324). If `rootSelector` is dropped there but honored on
   the persisted config (Decision 5), a wrapped response like `{"data": [...]}` infers a schema
   from the *wrapper object* (one row, one field `data`) while the created source then produces
   the *shaped* rows — a schema/rows mismatch of exactly the silent-corruption class this epic
   keeps hitting. Add `rootSelector: Option[String] = None` to `EphemeralRestConfig` in tasks.md
   1.2 and Decision 4, and add a task-4.2 test asserting infer-then-create agree on the shaped
   schema for a wrapped response.

2. **The body editor is unreachable from the real UI as designed — no method selector exists.**
   Decision 6 / tasks.md 5.2 specify the body textarea is "shown only for POST/PUT/PATCH; hidden
   for GET". But `method` is hardcoded `"GET"` in all three places the only live REST-source UI
   builds a config: `RestApiForm.tsx:23` (`buildConfig`), `AddSourceModal.tsx:119`
   (`handlePreview`), `AddSourceModal.tsx:150` (`handleCreate`). `RestApiForm`'s props are
   `{ url, jsonPath, onUrlChange, onJsonPathChange }` — there is no method control and no method
   state in the modal. Under the design as written the body field can never render, which makes
   ticket AC #1 ("actually sent — demonstrated against a real endpoint") and tasks.md 5.3
   ("create a REST source with a POST body" in the running dev app) unachievable. Either add a
   method selector (form prop + `AddSourceModal` state + all three `buildConfig`/config sites) to
   Decision 6 and task 5.2, or state explicitly that the body is API-only this ticket and amend
   AC #1 / task 5.3 accordingly. Do not leave it implicit.

3. **tasks.md 4.1's `toRows` call-site enumeration is wrong and misses a user-visible one.** It
   lists "`fetch`, `inferSchema`, `fetch(maxRows)`, `inferSchemaEphemeral`". `fetch` returns
   `JsValue` and is not a `toRows` call site. The actual call sites are
   `RestApiConnectorDriver.scala:284` (`inferSchema`), `:289` (`fetch(maxRows)`), `:324`
   (`inferSchemaEphemeral`), and **`SourceService.scala:312`
   (`previewRest`: `connector.toRows(json).take(10)`)** — the last is omitted. `previewRest` has
   `source.config` in scope, so it can and must pass `rootSelector`; missing it means "Preview
   source" shows unshaped rows while the pipeline reads shaped ones. Correct the enumeration to
   the four real sites.

### Non-blocking notes

- `proposal.md`'s Impact list names two files that do not exist at this HEAD:
  `backend/src/main/scala/com/helio/domain/RestApiConnector.scala` (actual:
  `domain/connectors/RestApiConnectorDriver.scala`, renamed by HEL-825) and
  `backend/src/main/scala/com/helio/JsonProtocols.scala` (actual: `com/helio/api/JsonProtocols.scala`).
  design.md and tasks.md use the correct paths; only the proposal is stale. Worth fixing so the
  proposal doesn't read as pre-HEL-825.
- Decision 1's miss-behavior (zero rows + warn log) is the right call given HEL-599 owns the
  error envelope, but it is a genuinely user-hostile failure mode in the interim (a typo'd
  selector is indistinguishable from an empty API). The Risks section already acknowledges this;
  no change requested, but it is the most likely source of a support question this ships.
- tasks.md 6.1's "~13 pre-existing `NoKeyConfigured` failures" baseline is asserted, not
  measured, in the artifacts. The executor should capture the pre-change baseline count itself
  rather than trusting the number, so it cannot mask a new failure.
