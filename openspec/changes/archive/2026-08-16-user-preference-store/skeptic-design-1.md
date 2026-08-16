## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

- **Naming-collision escalation is accurate and correctly resolved.** Verified the
  pre-existing UI-theming feature exists exactly as ticket.md's "Escalation
  Resolution" describes: `UserPreferences` case class in
  `backend/src/main/scala/com/helio/api/protocols/AuthProtocol.scala:11`, aliased at
  `com.helio.api.UserPreferences` via `backend/src/main/scala/com/helio/api/package.scala:22-23`;
  `UserPreferenceRepository` (singular) in
  `backend/src/main/scala/com/helio/infrastructure/UserPreferenceRepository.scala`;
  `user_dashboard_zoom` table (`UserDashboardZoomTable`, same file); `PATCH /api/users/me/update`
  wired in `ApiRoutes.scala:449`. Also confirmed pre-existing openspec capability specs
  `openspec/specs/user-preferences-persistence/` and `openspec/specs/user-preference-update/`
  describe this same unrelated feature. The new change's capability IDs
  (`agent-preferences-persistence`, `agent-preferences-api`) and identifiers
  (`AgentPreferences`/`AgentPreferencesRepository`/`AgentPreferencesService`/`agent_preferences`)
  do not collide with any of this. Route path `GET/PUT /api/preferences` — confirmed absent from
  `ApiRoutes.scala` today (`grep` for `pathPrefix("preferences")` / `/api/preferences` returns
  nothing), so no collision there either.
- **Migration numbering is correct.** `ls backend/src/main/resources/db/migration/ | sort -V | tail`
  shows the last migration on this branch is `V80__assistant_conversations.sql`; design.md's
  "Migration number" note (checked live at planning time, overriding the ticket's stale "V59")
  correctly assigns `V81__agent_preferences.sql`.
- **RLS pattern precedent is real and matches what's proposed.** Read `V42__api_tokens.sql` and
  `V54__image_uploads.sql`: both use `ENABLE`+`FORCE` and a single `USING`-only owner policy
  (no separate `WITH CHECK`), exactly as design.md Decision 2 specifies for `agent_preferences`.
- **RLS test-extension precedent is real.** `RlsOwnerTablesSpec.scala` already has an
  `image_uploads` section (lines ~300-353) that seeds via `ImageUploadRepository.insert` (not raw
  SQL) and asserts owner isolation — the exact pattern design.md Decision 5 / tasks.md 4.2 propose
  reusing for `agent_preferences`. `ImageUploadRepository.insert` (lines ~28-29) confirms the
  `ctx.withUserContext(upload.ownerId.value)(...)` write-path convention Decision 3 also cites.
- **Acceptance criteria trace to tasks:** AC1→1.2, AC2→3.2, AC3→4.2, AC4→4.1+4.3, AC5→3.3+4.4. No
  AC is left uncovered; no task falls outside the ticket's stated scope.
- **`JsObject`-field-in-domain-model precedent is real** (`WorkspaceContextDataType.sampleRows:
  Vector[JsObject]` formatted via `jsonFormat10` in `WorkspaceContextProtocol.scala:202-203`;
  `TextPanelConfig.fieldMapping: JsObject = JsObject.empty` in `TextPanel.scala`), so
  `Option[JsObject]` fields on `AgentPreferences` are technically feasible as planned.

### A concrete, binding-doc-contradicting gap (blocking)

**Task 3.1 directs formatters into the wrong file, and this will fail this repo's own enforced
pre-commit gate.**

- Tasks.md 3.1: *"Add Spray JSON formatters for `AgentPreferences` to
  `backend/src/main/scala/com/helio/api/JsonProtocols.scala`."*
- This directly contradicts `CONTRIBUTING.md:48` (binding, cited by this project's own
  `CLAUDE.md`): *"Per-domain JSON formatters live under `com.helio.api.protocols`; the aggregator
  `JsonProtocols` only mixes them in. **Don't add new formatters to the aggregator directly**."*
- I read `JsonProtocols.scala` directly: its own docstring says *"This trait carries zero formats
  of its own — it exists only to give downstream call sites... a single `extends JsonProtocols`
  mix-in."* `grep -n "implicit val\|implicit object" JsonProtocols.scala` confirms zero formatter
  definitions in that file; it is purely `trait JsonProtocols extends ResourceProtocol with
  AuthProtocol with ApiTokenProtocol with ... with AssistantConversationProtocol` (36 mixed-in
  per-domain traits, one per resource — no `AgentPreferencesProtocol` among them, because tasks.md
  never plans to create one).
- I confirmed this is universal, not a stylistic preference, by checking every comparable
  owner-scoped, small, GET/PUT-shaped resource: `ApiTokenResponse` lives in its own
  `api/protocols/ApiTokenProtocol.scala` (not `model.scala`'s `ApiToken`); `MetricResponse` lives
  in `api/protocols/MetricProtocol.scala`; `ImageUploadResponse` lives in
  `api/protocols/ImageUploadProtocol.scala` (a distinct wire DTO from the domain `ImageUpload`
  case class); and the closest structural analogue — `PUT /api/pipelines/:id/schedule`, another
  owner-scoped upsert — has `PipelineScheduleResponse`/`PutPipelineScheduleRequest` with a
  `.fromDomain` converter in `api/protocols/PipelineScheduleProtocol.scala`, decoupled from the
  domain `PipelineSchedule` case class, and its response **does** surface `updatedAt`
  (see next section).
- This is not merely a style violation — it will concretely **break `.husky/pre-commit`**, which
  runs `npm run check:schemas` (`scripts/check-schema-drift.mjs`) before `npm test`. I read that
  script: its case-class scan sources are only
  `backend/src/main/scala/com/helio/api/JsonProtocols.scala` and every `.scala` file under
  `backend/src/main/scala/com/helio/api/protocols/` — it does **not** scan `domain/model.scala`.
  Task 1.1 puts `AgentPreferences` in `domain/model.scala`; task 3.1 puts only formatter code
  (not a class declaration) into `JsonProtocols.scala`. When task 3.3's
  `schemas/agent-preferences.schema.json` (title `"AgentPreferences"`) is checked, `classes.get
  ("AgentPreferences")` will be `undefined` (no such `case class` textually appears in either
  scanned location), and the script will fail with `"no case class 'AgentPreferences' found in
  JsonProtocols.scala or api/protocols/*.scala (add to SKIP set ... if intentional)"`. I confirmed
  the script currently passes cleanly on this branch (`node scripts/check-schema-drift.mjs` →
  `schemas in sync with JsonProtocols (55 checked across 43 protocol files)`), so this is a real
  regression the plan as written would introduce, not a pre-existing gap.

### Change Requests

1. **Rewrite tasks.md 3.1 (and design.md/proposal.md's file-impact lists) to add a new
   `backend/src/main/scala/com/helio/api/protocols/AgentPreferencesProtocol.scala`** defining the
   wire-facing request/response case class(es) and their Spray JSON formatter(s) there — following
   the `PipelineScheduleProtocol.scala` / `ApiTokenProtocol.scala` / `ImageUploadProtocol.scala`
   pattern (a DTO decoupled from the domain `AgentPreferences` case class, with a
   `.fromDomain`/`.toDomain` conversion), and mix `AgentPreferencesProtocol` into `JsonProtocols`'s
   `extends` chain in `JsonProtocols.scala`. Task 3.3's schema title must then match whatever
   case-class name is actually declared in that new file (e.g. `AgentPreferencesResponse`), not
   the domain class name, so `check-schema-drift.mjs` can resolve it. Proposal.md's "Affected code"
   bullet list (currently omitting any `api/protocols/` file) needs the same correction.

### Non-blocking notes

- **`updated_at` is dropped between the DB row and the wire/domain shape with no stated reason.**
  The migration (task 1.2) creates `updated_at TIMESTAMPTZ NOT NULL DEFAULT now()`, but the
  `AgentPreferences` domain case class (tasks.md 1.1) and the GET/PUT response scenarios in
  `specs/agent-preferences-api/spec.md` never mention it. Every comparable resource with a
  DB timestamp surfaces it end-to-end (`ImageUpload.createdAt`, `ApiToken.createdAt`/
  `lastUsedAt`/`expiresAt`, and especially `PipelineScheduleResponse.updatedAt` for the closest
  upsert analogue). Not a blocker — no AC requires it — but design.md should make this an explicit
  Decision (surfaced or intentionally internal-only) rather than a silent omission, since a future
  reader will otherwise assume it was forgotten.
- **`extras: JsObject` (non-`Option`, required) has no stated default-on-missing-key behavior for
  `PUT` requests.** Decision 4 / the `agent-preferences-api` spec's "PUT fully replaces existing
  preferences" scenario implies any previously-set field can be omitted from a `PUT` body to clear
  it, which works naturally for the `Option` fields (spray-json treats a missing key as `None`) but
  is not obviously true for a required, non-`Option` `JsObject` field unless the eventual DTO gives
  it an explicit default (as `TextPanelConfig.fieldMapping: JsObject = JsObject.empty` does
  elsewhere, paired with a hand-written `decode` rather than the bare macro format). Worth a
  one-line Decision addendum once Change Request 1 is resolved and the actual wire DTO exists, so
  the implementer doesn't have to infer it.
- Report-tooling note (not a design defect): this worktree's `scripts/concertino/` directory is
  missing `next-report-number.sh`/`persist-evidence.sh`/`emit-event.sh` (present on `main` but not
  synced into this worktree, which predates their addition). I invoked the canonical copies from
  the main checkout (`/home/matt/Development/helio/scripts/concertino/...`) against this worktree's
  paths to produce this report; the orchestrator may want to re-sync worktree scripts for later
  gates.

### Verdict: REFUTE
