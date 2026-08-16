## Skeptic Report — design gate (round 3, skeptic-design-3.md)

### What I verified (with evidence)

- **Round 2's Change Request 1 (proposal.md "What Changes" bullet) is fixed.** Re-read
  `proposal.md:20-25` fresh: the routes bullet now reads "wire DTOs (`AgentPreferencesResponse`,
  `PutAgentPreferencesRequest`) and their formatters in a new per-domain
  `AgentPreferencesProtocol.scala`, mixed into `JsonProtocols` (CONTRIBUTING.md: 'Don't add new
  formatters to the aggregator directly' — see `ImageUploadProtocol.scala`/
  `PipelineScheduleProtocol.scala` for the precedent)." The stale "formatters in
  `JsonProtocols.scala`" phrasing is gone from `proposal.md` (confirmed via
  `grep -n "formatters in \`JsonProtocols" openspec/changes/user-preference-store/*.md`: the only
  remaining hit is `ticket.md:14`, the original human-authored ticket text, which design.md
  already establishes this plan is permitted to override on implementation-detail points — same
  pattern as the ticket's stale "V59" migration number being correctly overridden to V81).
- **Round 2's Change Request 2 (proposal.md "Impact/Affected code") is fixed.** Re-read
  `proposal.md:50-58` fresh: it now lists
  `backend/src/main/scala/com/helio/api/protocols/AgentPreferencesProtocol.scala` ("new — wire
  DTOs + formatters") immediately alongside `JsonProtocols.scala` ("mixes in the new trait; no
  formatters added directly"). Matches `tasks.md` 3.1 exactly.
- **All three artifacts (proposal.md, design.md, tasks.md) are now mutually consistent on this
  point.** `tasks.md` 3.1 directs creating `AgentPreferencesProtocol.scala` with
  `AgentPreferencesResponse`/`PutAgentPreferencesRequest` + a `.fromDomain` converter, then mixing
  the trait into `JsonProtocols`; `proposal.md`'s "What Changes" and "Impact" sections now say the
  same thing in the same terms; `design.md` Decision 4a's "`AgentPreferences` (domain case class)
  and its wire DTO carry only the four content fields" is consistent with (not contradicted by)
  this — it never named a formatter-location file to begin with, so it needed no correction, as
  round 2 also found.
- **Round 2's non-blocking note (wire DTO class names left implicit) is now resolved.** `tasks.md`
  3.1 explicitly names `AgentPreferencesResponse` (GET/PUT response) and
  `PutAgentPreferencesRequest` (PUT request body), decoupled from the domain `AgentPreferences`
  case class, with an `AgentPreferencesResponse.fromDomain` converter — no more ambiguity between
  "a DTO literally named `AgentPreferences`" and "a DTO for `AgentPreferences`." `tasks.md` 3.3
  now sets the schema title to `"AgentPreferencesResponse"` explicitly, matching the wire DTO name
  rather than the domain name.
- **Schema-title resolution mechanics re-verified against the actual script.** Read
  `scripts/check-schema-drift.mjs` fresh (lines 1-130): it parses `case class <Name>(...)` out of
  `JsonProtocols.scala` + every `.scala` file under `api/protocols/`, then looks up each schema's
  `title` in that map (`classes.get(title)`). A schema titled `AgentPreferencesResponse` will
  resolve once `AgentPreferencesProtocol.scala` (task 3.1) declares
  `final case class AgentPreferencesResponse(...)` — exactly the mechanism task 3.3 now targets.
  Cross-checked the precedent directly: `schemas/api-token.schema.json:4` has `"title":
  "ApiTokenResponse"` (the wire type, not domain `ApiToken`), and
  `backend/src/main/scala/com/helio/api/protocols/ApiTokenProtocol.scala` declares
  `ApiTokenResponse` with no `ownerId` field — confirming the repo convention of excluding the
  owner/session-scoped id from the response DTO, which the planned `AgentPreferencesResponse`
  (per task 3.1, holding only the four content fields) also follows.
- **`PipelineScheduleProtocol.scala` precedent re-read fresh and matches what's now planned**:
  `PipelineScheduleResponse`/`PutPipelineScheduleRequest` are distinct case classes from the
  domain `PipelineSchedule`, with a `PipelineScheduleResponse.fromDomain` companion-object
  converter and a `trait PipelineScheduleProtocol extends SprayJsonSupport with
  DefaultJsonProtocol` holding only `implicit val ...Format` definitions — the exact shape
  `AgentPreferencesProtocol.scala` is now planned to take.
- **CONTRIBUTING.md:48 re-read fresh**: "Per-domain JSON formatters live under
  `com.helio.api.protocols`; the aggregator `JsonProtocols` only mixes them in. Don't add new
  formatters to the aggregator directly." `JsonProtocols.scala`'s `extends` chain re-checked
  (still 36 mixed-in per-domain traits, zero formatters of its own) — the plan as revised complies.
- **No regressions on previously-verified ground truth.** Migration numbering still correct:
  `ls backend/src/main/resources/db/migration/ | sort -V | tail` tops out at
  `V80__assistant_conversations.sql`, so `V81__agent_preferences.sql` (task 1.2) is still the
  right next number. RLS pattern (`V42__api_tokens.sql`/`V54__image_uploads.sql`,
  `ENABLE`+`FORCE`, single `USING`-only policy) is unchanged and still correctly cited. The
  naming-collision escalation resolution (`AgentPreferences*`/`agent_preferences` vs. the
  pre-existing `UserPreferences`/`UserPreferenceRepository`/`users.preferences` UI-theming
  feature) is unchanged and still correctly non-colliding.
- **Spec files (`specs/agent-preferences-api/spec.md`, `specs/agent-preferences-persistence/spec.md`)
  re-read fresh, unchanged from round 2, still internally consistent with tasks/design**: GET
  default-object scenario, PUT full-replace-clears-omitted-fields scenario, 401-unauthenticated
  scenarios, and the four RLS isolation scenarios all trace cleanly to tasks 3.2/4.2/4.3.
  Confirmed the specs' generic wording ("the stored `AgentPreferences` object," not the literal
  wire-DTO class name) matches this repo's own convention for capability specs — cross-checked
  `openspec/specs/pipeline-schedule-crud-api/spec.md`, which likewise says "the full schedule" /
  "the created schedule" rather than naming `PipelineScheduleResponse` — so this is not a new
  inconsistency to flag.
- **AC traceability re-checked once more, still holds:** AC1 ("table + RLS")→1.2; AC2
  ("GET/PUT semantics")→3.2; AC3 ("RLS ScalaTest")→4.2; AC4 ("round-trip all four fields")→4.1+4.3;
  AC5 ("schema + `sbt test` + no FQNs")→3.3+4.4. No AC left uncovered; no task outside the
  ticket's stated scope.

### Verdict: CONFIRM

Round 3's four listed revisions are all verified present and correct in the actual files (not
merely claimed): `proposal.md`'s "What Changes" bullet and "Impact/Affected code" list now agree
with `tasks.md` 3.1 on the `AgentPreferencesProtocol.scala` per-domain-trait approach, and
`tasks.md` 3.1/3.3 now name the wire DTOs and schema title explicitly enough for
`check-schema-drift.mjs` to resolve without ambiguity. `proposal.md`, `design.md`, `tasks.md`, and
`specs/` are now mutually consistent on every point the prior two rounds flagged, and I found no
new contradictions, placeholders, or scope drift on this fresh pass. The plan is sound enough to
implement.

### Non-blocking notes

- `AgentPreferencesResponse` is not explicitly specified to omit or include `userId`/`ownerId`.
  Precedent (`ApiTokenResponse`, `ImageUploadResponse`) omits the owner id from response DTOs
  since it's implicit in the session-scoped route; a competent implementer will almost certainly
  follow that pattern, but `tasks.md` 3.1 could say so in one clause to remove the last sliver of
  inference. Not blocking — no AC depends on it and the precedent is unambiguous.
- Report-tooling note (unchanged from rounds 1-2, not a design defect): this worktree's
  `scripts/concertino/` still lacks `next-report-number.sh`/`persist-evidence.sh`/`emit-event.sh`.
  I again invoked the canonical copies from the main checkout
  (`/home/matt/Development/helio/scripts/concertino/...`) against this worktree's paths to produce
  this report.
