## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence)

- **Round 1's blocking defect is fixed in tasks.md.** Re-read `tasks.md` task 3.1 fresh: it now
  directs creating `backend/src/main/scala/com/helio/api/protocols/AgentPreferencesProtocol.scala`
  holding the wire DTO(s) + Spray JSON formatter(s), citing CONTRIBUTING.md's "Don't add new
  formatters to the aggregator directly" rule by name, then mixing the new trait into
  `JsonProtocols`'s `extends` chain. I independently re-read `CONTRIBUTING.md:48` and
  `JsonProtocols.scala` (still a zero-formatter aggregator, 36 mixed-in per-domain traits, e.g.
  `... with ImageUploadProtocol with ... with AssistantConversationProtocol`) and confirmed this
  is exactly the structural pattern the plan now follows — task 3.1 is no longer a pre-commit-gate
  regression.
- **The precedent it follows is real and correctly cited.** Read
  `backend/src/main/scala/com/helio/api/protocols/ImageUploadProtocol.scala` and `ApiTokenProtocol.scala`
  fresh: both define a wire-facing case class with a distinct, non-domain-colliding name
  (`ImageUploadResponse`, not `ImageUpload`; `ApiTokenResponse`, not `ApiToken`) plus a
  `.fromDomain` converter where applicable, then a `trait ...Protocol extends SprayJsonSupport
  with DefaultJsonProtocol` holding only the `implicit val ...Format` definitions. `design.md`
  Decision 4a's own language — "`AgentPreferences` (domain case class) and its wire DTO carry only
  the four content fields" — already treats the domain type and the wire DTO as two distinct
  things, consistent with this precedent, so the wire DTO is not expected to literally reuse the
  domain class's simple name (which would itself reintroduce a same-package-adjacent naming
  collision requiring an import alias / inline-FQN workaround — exactly what AC5's "no FQNs
  inlined" forbids). Non-blocking naming-precision note below.
- **`schemas/api-token.schema.json` confirms the title convention task 3.3 now points at.** Read
  it fresh: `"title": "ApiTokenResponse"` — the wire-type name, not the domain type name `ApiToken`.
  Task 3.3 says the new schema follows "`schemas/api-token.schema.json`'s conventions," which
  correctly transmits (even if implicitly) that the schema title must be the wire DTO's class
  name, letting `scripts/check-schema-drift.mjs` resolve it (I re-read that script fresh: it scans
  only `JsonProtocols.scala` + `api/protocols/*.scala` for `case class <title>(...)`, matching a
  schema's `title` field — a wire DTO declared per task 3.1 in the new protocols file satisfies
  this).
- **Round 1's two non-blocking notes are now addressed.** `design.md` gained Decision 4 (missing
  `extras` key on `PUT` is treated identically to an explicit `{}` — clears, never merges) and
  Decision 4a (`updated_at` is deliberately repository-internal only, with a stated rationale:
  no consumer in this ticket's scope vs. `ApiToken`/`ImageUploadResponse`'s user-facing
  timestamps). The `agent-preferences-api` spec's "PUT fully replaces existing preferences"
  scenario is worded generically enough ("a body omitting a previously-set field... is cleared,
  not retained") to cover the `extras` case Decision 4 specifies. Both are satisfied.
- **AC traceability re-checked, still holds:** AC1→1.2, AC2→3.2, AC3→4.2, AC4→4.1+4.3,
  AC5→3.3+4.4. No AC left uncovered; no task outside the ticket's stated scope. Re-verified the
  naming-collision escalation, migration numbering (`V81`, `db/migration/` still tops out at
  `V80__assistant_conversations.sql`), and RLS-pattern precedents (`V42__api_tokens.sql`,
  `V54__image_uploads.sql`, `RlsOwnerTablesSpec.scala`'s `image_uploads` section) exactly as round
  1 verified them — no drift on this branch since round 1.

### A concrete gap: round 1's Change Request 1 was only partially applied (blocking)

Round 1's Change Request 1 explicitly required correcting **three** artifacts: "Rewrite tasks.md
3.1 **(and design.md/proposal.md's file-impact lists)** ... Proposal.md's 'Affected code' bullet
list (currently omitting any `api/protocols/` file) needs the same correction." Only `tasks.md`
was actually revised. `design.md` needed no correction (it never named a formatter-location file
to begin with). `proposal.md` was **not touched at all** — I grepped it fresh
(`grep -n "JsonProtocols\|protocols/" proposal.md design.md tasks.md`) and confirmed it still
contains the exact defect round 1 was written to eliminate:

- `proposal.md:21` ("What Changes" bullet 4, the primary human-facing summary of the change)
  still reads: *"Add `GET /api/preferences` and `PUT /api/preferences` on the authenticated route
  tree; wire into `ApiRoutes.scala`; **formatters in `JsonProtocols.scala`**; a JSON Schema under
  `schemas/`."* This directly contradicts the now-correct `tasks.md` 3.1 and restates the
  CONTRIBUTING.md-violating instruction verbatim.
- `proposal.md:46-53` ("Impact / Affected code") still lists only
  `backend/src/main/scala/com/helio/api/JsonProtocols.scala` and omits the new
  `backend/src/main/scala/com/helio/api/protocols/AgentPreferencesProtocol.scala` file entirely —
  the exact gap round 1 named.

This is not a stylistic nit: `proposal.md` is the primary "why/what" artifact a reader (or a
fresh-context executor cross-checking task intent) consults first, and it now actively disagrees
with the corrected `tasks.md` on the one point that was round 1's entire basis for REFUTE. Leaving
this contradiction in place risks the exact regression round 1 was written to prevent, if anyone
follows proposal.md's literal wording over tasks.md's. This is squarely "tasks contradict
proposal" — one of the explicit categories this gate exists to catch — and it was an explicit,
numbered item in the prior round's required revisions that was simply not done.

### Change Requests

1. **Update `proposal.md:21`** ("What Changes" bullet 4) to match the corrected plan: replace
   "formatters in `JsonProtocols.scala`" with language describing the new per-domain
   `AgentPreferencesProtocol.scala` trait (wire DTO + formatters) mixed into `JsonProtocols`,
   consistent with `tasks.md` 3.1.
2. **Update `proposal.md`'s "Impact / Affected code" list (currently lines 48-53)** to add
   `backend/src/main/scala/com/helio/api/protocols/AgentPreferencesProtocol.scala` alongside the
   already-listed `JsonProtocols.scala` (which is still correctly affected, since the new trait
   must be mixed into its `extends` chain).

### Non-blocking notes

- **Wire DTO class name is still only implied, not spelled out, in `tasks.md` 3.1.** It says "the
  `AgentPreferences` wire DTO(s)," which reads ambiguously as either "a DTO literally named
  `AgentPreferences`" (which would collide with the domain class of the same simple name across
  packages, forcing an import alias/inline-FQN to disambiguate anywhere both are referenced — e.g.
  a `.fromDomain` converter in the new protocol file itself) or "the wire DTO(s) *for*
  `AgentPreferences`" (matching precedent: `AgentPreferencesResponse`/similar, distinct from the
  domain name). Given `design.md` Decision 4a and the `ImageUploadProtocol.scala`/
  `ApiTokenProtocol.scala` precedent task 3.1 cites, a competent implementer will almost certainly
  land on the latter — but naming the wire type explicitly (e.g. `AgentPreferencesResponse`,
  `PutAgentPreferencesRequest`) in `tasks.md` 3.1/3.3 would remove the residual ambiguity for free.
- Report-tooling note (unchanged from round 1, not a design defect): this worktree's
  `scripts/concertino/` still lacks `next-report-number.sh`/`persist-evidence.sh`/`emit-event.sh`.
  I again invoked the canonical copies from the main checkout
  (`/home/matt/Development/helio/scripts/concertino/...`) against this worktree's paths.

### Verdict: REFUTE
