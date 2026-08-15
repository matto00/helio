## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### Note on tooling
Same as round 1: `scripts/concertino/{next-report-number.sh,persist-evidence.sh,emit-event.sh}` are
absent from this worktree's git-ignored `scripts/concertino/` (only `assert-phase.sh`, `cleanup.sh`,
`setup-worktree.sh`, `start-servers.sh`, `.concertino.env`, `README.md` are present, dated Aug 15
14:12). I invoked the main checkout's copies (path-parameterized, worktree-agnostic, verified by
reading their source in round 1) against this worktree's paths. Bookkeeping only, not a review gap.

### What I verified (with evidence)

**1. Gap 1 (missing JSON Schema contract update) — CLOSED.**
- `schemas/assistant-conversation.schema.json` (read in full) is `title: "AssistantConversationResponse"`,
  currently `required: [id, title, pinned, updatedAt, transcript]`, `additionalProperties: false` — the
  correct file, matching `AssistantConversationResponse`'s actual `jsonFormat5` (confirmed in
  `AssistantConversationProtocol.scala:43-49,67-68`).
- design.md D7 and tasks.md task 4.3 now explicitly name this file and describe "2 optional boolean
  properties matching the case class." proposal.md's Impact section states it explicitly
  (`schemas/assistant-conversation.schema.json: gains 2 optional properties...`) and correctly narrows
  the "no migration changes" line to DB migrations only.
- Verified the planned *shape* against this repo's own established convention for `Option[Boolean]`
  response/request fields, not just against the drift-checker's mechanics (which only diffs property
  *names*, not `required`/type — read `scripts/check-schema-drift.mjs` in full, confirmed it does not
  enforce `required` semantics). Found two directly comparable precedents:
  `schemas/put-pipeline-schedule-request.schema.json` (`enabled: Option[Boolean]`,
  `PipelineScheduleProtocol.scala:29`) and `schemas/create-alert-rule-request.schema.json`
  (`enabled: Option[Boolean]`, `AlertRuleProtocol.scala:32`) — both represent the optional boolean as
  a plain `{ "type": "boolean" }` property, absent from `required`, with a description noting
  "spray-json omits `None` on the wire." `AssistantConversationResponse`'s formatter is the standard
  `jsonFormat5` macro (soon `jsonFormat7`), the same omit-on-`None` spray-json behavior — so this is
  exactly the right shape for this repo's convention, not a guess. (I also ran
  `node scripts/check-schema-drift.mjs` against the current tree to confirm it's clean today, matching
  round 1's finding, before reasoning about what the diff would look like post-implementation.)
- Verdict: Gap 1 is genuinely and correctly closed — right file, right shape, right convention match.

**2. Gap 2 (D4 system-prompt nuance) — CLOSED.**
- Read the actual current text at `backend/src/main/scala/com/helio/services/AssistantSystemPrompt.scala:57-58`:
  *"If find turns up nothing relevant to the goal, don't give up: propose_pipeline or propose_combined
  can create the data the goal needs from scratch."* — unconditioned, exactly as round 1 described.
- design.md D4 (revised) now explicitly requires this EXACT sentence be "EDITED in place to become one
  explicit branch of a single if/else, not left untouched next to a new, separately-worded clause,"
  spelling out the qualifying clause ("...for goals concrete enough to act on") and the else-branch
  wording. tasks.md task 3.1 mirrors this precisely: "Edit `AssistantSystemPrompt.text`'s EXISTING
  'don't give up, propose anyway' sentence in place... one linked if/else, never two separately-worded,
  unlinked absolute instructions on the same 'find returns nothing' trigger." This is unambiguous —
  both documents now agree the old sentence is edited, not left standing.
- Checked for a lingering contradiction elsewhere per the prompt's instruction: grepped all of
  ticket.md/proposal.md/design.md/tasks.md for "existing sentence"/"stays"/"untouched"/"unedited."
  proposal.md's "What Changes" section (line 24) reads "...the existing 'don't give up, propose
  anyway' guidance stays for goals concrete enough to act on" — read carefully, this means the guidance
  *continues to apply, now qualified*, not "stays verbatim/untouched." It is consistent with, not
  contradictory to, D4/task 3.1's edit-in-place plan. ticket.md's own Scope bullet ("Claude should ask
  a clarifying question, not guess") is goal-level and doesn't prescribe implementation wording, so no
  conflict there either. Planner Notes at the bottom of design.md also correctly summarize the fix.
- Verdict: Gap 2 is genuinely and correctly closed — one conditional, two textually-linked branches, no
  remaining artifact describes the old sentence as staying unedited.

**3. Fresh look — other issues checked, none found blocking.**
- Traced both ACs to concrete design/task coverage: AC1 (three failure modes, each with a deterministic
  test + defined UI state) — find-zero-results → D2/task 2.2 + spec `assistant-conversation-loop`
  (`searchedWithNoResults`) + test 7.2, UI via D5/task 6.2 + spec `chat-message-rendering` "asking a
  follow-up" scenario; hop-cap-hit → D1/task 4.1-4.2 + spec `assistant-live-converse` + test 7.3, UI via
  D5/task 6.1 (cut-short `ToolCallIndicator`) + task 6.2; tool-execution-error → D3/task 1.1 + spec
  `claude-api-client`'s widened requirement + test 7.1. For the third failure mode's "defined UI state,"
  confirmed `ToolCallIndicator.tsx:65-74` (`isError` → `faCircleExclamation` icon,
  `tool-call-indicator--error` class, "Failed" summary) is *already built and already tested*
  (`ToolCallIndicator.test.tsx:39-50`, referencing tasks.md 5.4 from an earlier ticket) — D3's hardening
  correctly reuses this existing UI state for free by converting more failure shapes into the same
  `isError` tool_result path, rather than requiring new frontend work the plan doesn't call for. Not a
  gap; a proportionate reuse. AC2 (telemetry, tool-call count + hop-cap-hit rate, "queryable the same
  way HEL-401's...telemetry is") — D6/task 5 + spec `assistant-tool-loop-telemetry` + test 7.4; "the
  same way" correctly means log-line-only (no query API precedent exists for HEL-401 either, confirmed
  in design.md's own Context section), not a new requirement smuggled in.
- Verified all 4 "Modified Capabilities" named in proposal.md (`claude-api-client`,
  `assistant-conversation-loop`, `assistant-live-converse`, `chat-message-rendering`) already exist as
  base specs (`ls openspec/specs/` confirms all 4 directories), and the one "New Capability"
  (`assistant-tool-loop-telemetry`) does not — the New/Modified split is accurate, not mislabeled.
  Cross-checked the specific `claude-api-client` requirement being widened
  (`openspec/specs/claude-api-client/spec.md:196-200`) against design.md's characterization — matches
  verbatim (`Left`-only today, correctly described as being widened).
  Confirmed no field-name collisions between this change's new requirements and the base specs'
  existing `AssistantTurnResult`/`AssistantConversationResponse` requirements.
- Confirmed the starting-state field counts design.md/tasks.md cite are accurate against real code:
  `AssistantTurnResult` (`AssistantProtocol.scala:30-37`) has 6 fields today, missing
  `searchedWithNoResults` (task 2.1's target); `AssistantConversationResponse` is `jsonFormat5`
  (confirmed above). Both match the plan's stated starting points exactly.
- Scanned all 4 artifacts + spec deltas for `TODO`/`TBD`/"figure out"/"placeholder" — zero hits.
- No scope drift found: all planned work traces to one of the two ACs; no unrelated refactor bundled in.

### Verdict: CONFIRM

### Non-blocking notes

- Round 1's non-blocking note (tasks.md doesn't say *why* `AssistantTurnResult.toolCallCount`'s
  cumulative-history scoping is unsuitable for telemetry's per-turn `toolCallCount`, task 5.2 correctly
  re-derives it instead) remains unaddressed but is still non-blocking — worth a one-line code comment
  at implementation time, not a design-gate blocker.
- The hop-cap-exhausted case's persisted transcript ends in a dangling `tool_use` with no accompanying
  assistant prose (confirmed via `ClaudeClient.scala`'s `history :+ assistantTurn` and
  `AssistantService.toTurnResult`'s synthetic "Reached the maximum..." string never being appended to
  `fullHistory`) — so the AC's "clear ... message" for that case will necessarily be UI-authored copy
  (the `MessageTurn`/`ToolCallIndicator` badge text), not backend-sourced prose. This is a reasonable,
  implicit design choice (booleans + UI copy over persisting synthetic assistant text), consistent with
  D1/D5, but tasks.md doesn't spell out that the actual user-facing copy lives in the frontend component
  rather than coming from the backend — worth a one-line callout when 6.1/6.2 are implemented so the
  executor doesn't go looking for `result.text` on the wire.
