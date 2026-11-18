## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed commit: `953b473436bf7b14948dca649ae8b008b0f403c5` (branch `feature/assistant-model-picker/HEL-1755`).
Diff base: `5bd0e7f94` (live `resolve-review-base.sh` after `git fetch origin main`; it is the merge-base with
`origin/main` = `96ed5156b` HEL-1750). `git merge-tree` of HEAD with `origin/main` is clean.

Fresh gate runs (by me, in `WORKTREE_PATH`):
- `npm run lint`: exit 0, zero warnings.
- `npm run format:check`: all files formatted.
- `npm test` (`HELIO_JEST_MAX_WORKERS=3`, `nice -n 19`): exit 0. Root 66 suites / 579 tests; frontend 792 suites / 9672 tests, all passed.
- `npm --prefix frontend run build`: exit 0. `npm run typecheck`: clean.
- `cd backend && sbt -J-Xmx3g testFull` (`nice -n 19`): `Suites: completed 709, aborted 0`; `Tests: succeeded 9688, failed 0, canceled 5`; `All tests passed.` I read the summary lines, not only the exit code. All new specs ran: `ClaudeModelRequestSpec`, `ClaudeModelCatalogSpec`, `AssistantModelSwitchSpec`, `AssistantModelSelectionRoutesSpec`, `UserPreferencesRoutesSpec`, `AssistantDailyUsageRepositorySpec`.
- `npm run check:scala-quality`: clean, with soft file-size warnings only.

I made no live Anthropic call (C14). I ran no converse request against the lane backend. The live-check AC is judged on
`evidence/live-check.md`.

### Phase 1: Spec Review — PASS (with one doc finding, see Phase 2 CR3)

- AC1 (owner picks each of three models, conversation keeps its pick, Settings default): implemented and observed in
  the running app. A PATCH persisted `claude-haiku-5-5`. With a Settings default of Sonnet, both a new chat and an
  existing conversation with no stored model showed "Sonnet 5.5".
- AC2 (beta weighted rule 1/4/8, owner uncounted, C15): `ClaudeModelCatalog` defaults, `HELIO_BETA_MODEL_WEIGHTS`
  override, and `incrementIfUnderCap(..., weight)` with `count + weight <= limit` and a `weight > limit`
  short-circuit before the first-row INSERT. Owner skips the counter.
- AC3 (each turn records its model): the route stamps new assistant turns. Client-supplied `model` is stripped on
  create and `/messages`. The repository format writes and reads `model`.
- AC4 (400 outside the allow-list; the test fails first): converse and PATCH both return 400 before any read, charge,
  model call or write. Live probes: PATCH `claude-opus-4-8` gave 400 "Unknown model ..."; PATCH `model: 5` gave 400;
  preferences `assistantModel: "gpt-4"` gave 400. The red is a recorded mutation (5.1), not a pre-implementation run.
  red-first.md says so openly. The mutation reproduces the pre-fix behaviour (an unknown key was ignored, 200), so I
  accept it as the AC's "fails first".
- AC5 (switching models, both directions, tool use and thinking, no 400): `AssistantModelSwitchSpec` covers all 9
  ordered pairs on synthetic fixtures (design D6, skeptic CR4). It has a positive control showing the fake does reject
  a foreign thinking block. The live switch conversation (Haiku -> Opus with a thinking block -> Haiku, every turn
  tool-using) returned 200 on every hop.
- AC6 (live check within the $2 cap, response model asserted): live-check.md records 12 hops, each with a request-id,
  response model equal to the pinned id, `stop_reason` and usage. I re-derived the Opus line from the recorded usage
  and the api-contract.md prices: about $0.125 cache write plus about $0.025 for the rest, about $0.15, which matches
  the recorded figure. The total of $0.218 is far under the $1.50 stop. Conversations were deleted by exact id. The
  orphaned blob files in the home-directory uploads root were left alone, correctly, per CLAUDE.md.
- AC7 (UI in light and dark, desktop and phone): the executor's 12 screenshots plus my own run (Phase 3).
- AC8 (`CLAUDE_MODEL` row updated): done. It also drops a still-true fact (CR3).
- Tasks: all checked. They match the diff.
- Constraints: C15, C16, C17 (no sampling, `budget_tokens`, `thinking` or `tool_choice` for catalog models,
  enforced in `ClaudeClient.wireTemperature(requested, modelId)` and asserted in `ClaudeModelRequestSpec`), C18 (V140)
  and C20 (shared `Select`, `FormField` in Settings) are all honored.
- Shared files confirmed unmodified by this branch:
  `git diff --name-only 5bd0e7f94...HEAD | grep -iE 'Select|ActionsMenu|panelFit|PortalPopover'` matches only
  `AssistantModelSelectionRoutesSpec.scala` and a spec.md (name collisions). `frontend/src/shared/ui/Select.tsx`,
  `shared/chrome/ActionsMenu.*`, `shared/ui/selectPanelFit.ts`, `shared/ui/panelFit.ts` and
  `hooks/usePortalPopover.ts` are untouched. HEL-1750 changed several of them on `main` after this branch's base;
  the merge is textually clean.
- Schemas: converse-request, assistant-conversation (+ the per-turn `model`), summary, update-request, both
  user-preferences schemas and the new `assistant-models-response.schema.json` are all updated.

### Phase 2: Code Review — FAIL

Code quality is good overall. `ClaudeModelSpec` can only be built inside `ai`, so no raw client string reaches the
wire. `AssistantModelPolicy` is the one effective-model rule, and the server returns `effectiveModel` so the client
never derives it. PATCH uses a hand-written absent/null/string decoder. The preferences clear-key SQL uses fixed
literals. Error paths revert optimistically. Tests are meaningful and DB-backed where it matters. No `any`, no inline
FQNs, no dead code.

Issues:

1. **C13: many guards have no recorded mutation.** red-first.md records 6 backend and 4 frontend mutations
   (5.1, 5.3, 5.4, 5.5 at the route, 5.6 strip-only, skeptic (b), F1 to F4). These guards, several of them carrying
   ACs, have none:
   - AC3 per-turn stamping. The route's `m.copy(model = Some(answered))`
     (`AssistantConversationRoutes.scala`, converseFlow) is guarded by "send exactly that id, store it on the
     conversation and stamp the answer with the response model" and "record each turn's own model when the model
     changes between turns" (`AssistantModelSelectionRoutesSpec.scala:172,195`). No mutation is recorded.
   - AC1 default on create. `val stamped = userDefault.filter(modelPolicy.catalog.isSelectable)` is guarded by
     "start on the user's default and clear back to the server default" (`:280`). No mutation is recorded.
   - The effective-model fall-through (`AssistantModelPolicy.effective`/`defaultFor`) is guarded at `:224`, `:237`
     and `:248`. No mutation is recorded.
   - The repository weighting SQL. Revert `message_count + $weight <= $limit` to `message_count < $limit`, or remove
     the `weight > limit` short-circuit (`AssistantDailyUsageRepository.scala`). Guarded by
     `AssistantDailyUsageRepositorySpec.scala:166,176,185,191`. The recorded 5.5 mutation only changes the route's
     weight argument, so it never exercises these repository guards.
   - Preferences `assistantModel` validation and drop-on-read (`UserPreferencesRoutes.scala`,
     `UserPreferenceRepository.scala`) are guarded at `UserPreferencesRoutesSpec.scala:351,363`. No mutation is
     recorded.
   - Catalog env narrowing and weight parsing (`ClaudeModelCatalog.fromEnv`/`parseWeights`) are guarded in
     `ClaudeModelCatalogSpec`. No mutation is recorded.
   - The response `model` decode and the mismatch WARN (`ClaudeProtocol.scala` `model = ...`, `ClaudeClient.logHop`)
     are guarded at `ClaudeModelRequestSpec.scala:93,121`. No mutation is recorded.
   - Frontend: the server-default option (`modelOptions.ts` `composerPickerModel`), the transcript label wiring in
     `ActiveConversationPanel.tsx` (the test at `ActiveConversationPanel.test.tsx:417`), and Settings' null-clear
     (`AssistantModelSection.test.tsx:122`). No mutations are recorded.

2. **The "Server default" option silently refuses the pick when a user default is set (observed in the running
   app).** Steps: save Settings default = Sonnet 5.5, open a conversation, pick "Server default (claude-opus-4-8)".
   The PATCH sends `model: null`, and the server resolves through D3 to the user default. The picker snaps back to
   "Sonnet 5.5", and the list shows `effectiveModel: claude-sonnet-5-5` for conversation
   `06b18643-f60b-4a10-811e-e19d547cc569`. The option names a model the user can never select on that conversation.
   Its label promises `claude-opus-4-8`, but the user gets their own default. `ModelPicker.tsx` also sets
   `optimisticEffective` to `models.serverDefault.id` when clearing, so the UI flashes the server default first and
   then flips. This bites wherever `CLAUDE_MODEL` is not selectable: today that is local dev, and in prod it is any
   `CLAUDE_SELECTABLE_MODELS` narrowing that excludes the prod default.

3. **CLAUDE.md lost a still-true operational fact.** The old `CLAUDE_MODEL` row said "prod pins `claude-haiku-5-5`
   in `.github/workflows/cd-backend.yml` and `infra/deploy-backend.sh`. See HEL-1636." The new row drops the prod-pin
   sentence and the HEL-1636 reference. The pin still exists: `cd-backend.yml:101` (`CLAUDE_MODEL=claude-haiku-5-5`)
   and `infra/deploy-backend.sh:123`. This matters more now, because that pin decides the prod server default and
   therefore whether the composer shows a "Server default" option at all.

### Phase 3: UI Review — PASS

Lane servers were started with `start-servers.sh` and `assert-phase.sh servers` passed. I logged in as the dev
account (owner tier). No converse was sent.

- Composer picker on an existing conversation: shared `Select` with combobox name "Model". Options are
  "Server default (claude-opus-4-8)" (the dev default is non-catalog), Haiku 5.5, Sonnet 5.5 and Opus 5.5.
  Keyboard works: ArrowDown + Enter sent one PATCH (200) and the stored model became `claude-haiku-5-5`. Picking
  "Server default" with no user default cleared it back to `claude-opus-4-8`.
- No-conversation state: after "New chat" the picker shows `defaultModel`. A pick of Opus 5.5 is held, and Send stays
  disabled on an empty draft. A fresh "New chat" resets to the default, which was Sonnet after the Settings save.
- Settings: an "Assistant" section with `FormField` "Default model" (accessible name, hint text). Saving Sonnet
  updated `/api/assistant-models` `defaultModel`, `/me` preferences, and the effective model of conversations with no
  stored model. I restored the original state afterwards with `assistantModel: null`.
- Transcript label: no conversation in the dev DB has stamped turns, and I may not create one (C14). I injected
  `model` into the GET detail response client-side (an XHR getter shim; the server's stamping is covered by the
  backend specs). The muted label renders once per answer group, under the closing text bubble, 7 labels for 7 user
  messages. Styling: `--text-xs` (12px) and `--app-text-muted` (dark `#aaa49c`, light `rgb(100,94,86)` =
  `#645e56`), tokens only.
- Themes: dark and light both checked on desktop. Phone at 390px (light): the picker is 44px tall beside Send, with no
  horizontal overflow. 768px and 1100px: no overlap with Send and `scrollWidth` equals the viewport. The executor's
  dark-phone open-listbox screenshot shows the HEL-1750-era placement working.
- Console: no errors during the tested flows after the session reload. The earlier errors were the pre-login
  `/api/auth/me` 401 and my own deliberate 400/403 probes.
- DESIGN.md [mechanical]: new CSS uses only tokens for colour, font size and gap. `260px` and `360px` are layout
  widths with no token, matching existing precedent such as `EmptyState.css` `max-width: 360px`. No inline styles. No
  hand-rolled controls.

Evidence (persisted):
- `/home/matt/Development/helio/.concertino/runs/HEL-1755/evidence/openspec/changes/assistant-model-picker/evidence/eval1-transcript-label-light-desktop.png`
  (despite the filename, this one is the DARK theme)
- `/home/matt/Development/helio/.concertino/runs/HEL-1755/evidence/openspec/changes/assistant-model-picker/evidence/eval1-label-picker-open-light-desktop.png`
- `/home/matt/Development/helio/.concertino/runs/HEL-1755/evidence/openspec/changes/assistant-model-picker/evidence/eval1-newchat-pick-dark-desktop.png`
- `/home/matt/Development/helio/.concertino/runs/HEL-1755/evidence/openspec/changes/assistant-model-picker/evidence/eval1-composer-light-phone.png`

### Overall: FAIL

### Change Requests

1. **Record the missing mutations (C13).** For each guard below, apply a one-line mutation, run the spec, record the
   failing assertion in `evidence/red-first.md`, then revert. If a mutation stays green, strengthen the test until it
   goes red.
   - (a) Converse route: replace `m.copy(model = Some(answered))` with `m` → the `AssistantModelSelectionRoutesSpec`
     stamping tests (`:172`, `:195`).
   - (b) Create route: replace `stamped` with `None` → `:280`.
   - (c) `AssistantModelPolicy.effective`: drop `.filter(catalog.isSelectable)` on `stored` → `:224`.
   - (d) `AssistantDailyUsageRepository.incrementIfUnderCap`: restore `WHERE ... message_count < $limit`, and
     separately remove the `weight > limit` short-circuit → `AssistantDailyUsageRepositorySpec` `:176`, `:185`.
   - (e) `UserPreferencesRoutes`: accept any `JsString` for `assistantModel` → `UserPreferencesRoutesSpec:351`.
     `UserPreferenceRepository`: drop the `isSelectable` read filter → `:363`.
   - (f) `ClaudeModelCatalog.fromEnv`: ignore `CLAUDE_SELECTABLE_MODELS` → `ClaudeModelCatalogSpec`.
     `parseWeights`: drop the `>= 1` filter → the same spec.
   - (g) `ClaudeProtocol` response format: drop the `model` field read → `ClaudeModelRequestSpec:93`/`:100`.
   - (h) Frontend: in `composerPickerModel`, always return `{ value: effectiveId, options }` → `modelOptions.test.ts:36`.
     In `ActiveConversationPanel.tsx`, pass `modelLabel={undefined}` → `ActiveConversationPanel.test.tsx:417`.
     In `AssistantModelSection.onChange`, send `next` instead of `null` for `SERVER_DEFAULT_VALUE` →
     `AssistantModelSection.test.tsx:122`.

2. **Make the composer's null option honest when a user default exists.**
   - `modelOptions.ts` / `ModelPicker.tsx`: when the user has a saved default (`models.defaultModel.id` differs from
     `models.serverDefault.id`), the null-clearing option must say what it resolves to. For example, label it
     "Your default (<label>)" using `models.defaultModel`. Otherwise, store an explicit model.
   - `ModelPicker.tsx` `onChange`: set `optimisticEffective` for a clear to `models.defaultModel.id`, not
     `models.serverDefault.id`, so the UI does not flash and flip.
   - Add a test: with `defaultModel = Sonnet` and `serverDefault = claude-opus-4-8`, the clear option's label names
     what a clear resolves to, and the optimistic value equals it. Record its red (C13).

3. **CLAUDE.md `CLAUDE_MODEL` row:** restore the prod-pin sentence ("prod pins `claude-haiku-5-5` in
   `.github/workflows/cd-backend.yml` and `infra/deploy-backend.sh`") and the HEL-1636 reference alongside the new
   HEL-1755 text.

### Non-blocking Suggestions

- **Flyway ordering hazard (driver coordination, C18):** V140 merges before the reserved V138/V139, and the backend
  has no `outOfOrder` setting (`grep outOfOrder backend/` finds nothing). Once V140 is applied to a database, a later
  V138 or V139 is a resolved-but-unapplied lower version. Flyway's default validation rejects that at startup. The
  driver should confirm how the HEL-1740/1742 lanes will number their migrations if this lane merges first.
- `assistantConversations.modelError` survives a conversation switch. Consider clearing it in
  `selectConversation.pending` / `startNewConversation`.
- Responses omit `model` when nothing is stored (spray omits `None`) rather than sending `null`. This is
  schema-compatible because the field is not required. Just noting it.
- The branch is one commit behind `origin/main` (HEL-1750). The merge is clean, but re-run the composer placement
  check after rebasing, since HEL-1750 changed `selectPanelFit.ts` and `usePortalPopover.ts`, which the shared
  `Select` uses.
