## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD: `0fa5e42798a9190b904e8e868d0742cf4ceba05a` (branch `feature/assistant-model-picker/HEL-1755`).
Diff base: resolved live with `resolve-review-base.sh` (main/origin) = `96ed5156b`. The script exited 0.

### What I verified (with evidence)

- **Spawn-cwd guard.** `assert-cwd.sh` returned `READY ambient=/home/matt/Development/helio branch=feature/assistant-model-picker/HEL-1755`.

- **origin/main and Flyway.**
  - After `git fetch`, `origin/main` = `6e334120a` (HEL-1754). The branch is one commit behind it.
  - `comm` of the changed-file lists for `96ed5156b..origin/main` and `96ed5156b..HEAD` is empty, so the two sides touch no common file.
  - **The highest migration on origin/main is V137** (`V137__lock_pipelines_for_definition_writes.sql`). The branch adds `V140__assistant_conversation_model.sql`, so origin/main has gained no higher migration and the driver rule calls for no renumber.
  - Across every live worktree, the only other migration above V137 is HEL-1740's `V141__outputs_kind_insight.sql`. No V138 or V139 exists anywhere. The backend has no `outOfOrder` setting.

- **AC1: the owner can pick each model, a conversation keeps its pick, and Settings sets the default.**
  - Allow-list: `ClaudeModelCatalog.scala` (3 ids, `select` only).
  - Model resolution: `AssistantModelPolicy.effective` applies stored model, then user default, then server default.
  - PATCH `model` and the converse `model` field: `AssistantConversationRoutes.scala`.
  - Create stamps the user default (`stamped = userDefault.filter(isSelectable)`).
  - User default: `UserPreferencesRoutes` handles `assistantModel` (set, null clears, anything else 400).
  - Frontend: `ModelPicker.tsx`, `AssistantModelSection.tsx`, and the pending pick sent on the first converse.
  - Tests: `AssistantModelSelectionRoutesSpec` ("keep using the stored model on later turns", "start on the user's default and clear back to the server default").

- **AC2: beta can pick, under the 1/4/8 weighted counter.**
  - Default weights are in `ClaudeModelCatalog.definitions`, overridable with `HELIO_BETA_MODEL_WEIGHTS`.
  - `incrementIfUnderCap(..., weight)` charges with the SQL `message_count + $weight <= $limit`, and short-circuits `weight > limit`.
  - Owner is uncounted (`ChatAccessService.checkConverseCap`).
  - Tests: "charge Haiku 1, Sonnet 4 and Opus 8", "deny Opus but allow Haiku when 3 units are left", "never count an owner", plus the concurrency case in `AssistantDailyUsageRepositorySpec`.

- **AC3: each turn records its model.**
  - The route stamps every new assistant message with `responseModel.getOrElse(resolvedModel)`.
  - Client-supplied turns have their model stripped on create and on `/messages`.
  - The repository format writes and reads `model`.
  - Tests: "record each turn's own model when the model changes between turns" and "never take a client-supplied model".

- **AC4: an id outside the allow-list is a 400, and the test fails first.**
  - The converse and PATCH routes validate before any read, charge or call.
  - `red-first.md` mutation 5.1 shows 3 tests FAILED with `200 OK was not equal to 400`.

- **AC5: model switches never 400.**
  - `AssistantModelSwitchSpec` runs all 9 ordered pairs. Each pair is tool use plus thinking on model A, then model B. A fake transport answers 400 on any thinking block from another model or any forbidden sampling, `budget_tokens` or `tool_choice` field.
  - A positive control proves the fake does reject.
  - The mechanism is `persistable` (`AssistantService.scala:233`), which drops Thinking/RedactedThinking/Opaque, and the model is fixed per `sendWithTools` loop.

- **AC6: live check (recorded, not re-run, per C14).**
  - `evidence/live-check.md` matches the raw capture in `.concertino/scratch/HEL-1755/live1.txt` and `live2.txt`. All 12 hops have a request-id, `requested=` equal to `response-model=`, and HTTP 200. That covers one tool turn per model plus Haiku to Opus to Haiku, with Opus emitting a thinking block on turn 2 and Haiku turn 3 still returning 200.
  - Spend was $0.218 against the $2 cap.
  - The lane `.concertino-backend.log` has since been overwritten by later restarts (0 hop lines), so the scratch captures are the only surviving raw record.

- **AC7: UI.** Details are in the UI judgment section below.

- **AC8: the CLAUDE.md `CLAUDE_MODEL` row now reads "SERVER DEFAULT ... overridable per conversation".** It keeps the prod-pin note. There are new rows for `CLAUDE_SELECTABLE_MODELS` and `HELIO_BETA_MODEL_WEIGHTS`, and a new endpoint entry.

- **Contracts.**
  - `converse-request`, `update-assistant-conversation-request`, `assistant-conversation(-summary)`, `user-preferences` and `update-user-preferences-request` all gain `model` / `assistantModel`.
  - There is a new `assistant-models-response.schema.json`.

- **Request-shape rule.** `ClaudeClient.wireTemperature(requested, modelId)` returns `None` for any catalog id. No `thinking` or `tool_choice` field is ever added. `ClaudeModelRequestSpec` covers this.

- **Gates I ran myself.**
  - `sbt -J-Xmx3g testOnly` on the 10 changed or affected specs (`AssistantModelSelectionRoutesSpec`, `ClaudeModelCatalogSpec`, `ClaudeModelRequestSpec`, `AssistantModelSwitchSpec`, `AssistantDailyUsageRepositorySpec`, `UserPreferencesRoutesSpec`, `AssistantConversationRoutesSpec`, `ClaudeRoutesChatGateSpec`, `AssistantTelemetrySpec`, `ClaudeNoAnswerAndStripSpec`): `Suites: completed 10, aborted 0`, `Tests: succeeded 130, failed 0`, `All tests passed.`
  - `jest --maxWorkers=2 src/features/assistant src/features/settings src/features/auth src/app/App.test.tsx`: 39 suites, 440 tests, all passed.
  - `npm run typecheck` exit 0. `npm run lint` exit 0.
  - For the full suite I relied on the evaluator's pasted `testFull` summary (709 suites, 9688 succeeded, 0 failed) and on `npm test` at the same HEAD, which is unambiguous.

- **UI judgment.** Servers were started with `start-servers.sh` and `assert-phase.sh servers` returned PASS.
  - Composer, dark, desktop 1440: the picker is the shared `Select` at the composer's left with Send right-aligned. It is tokens-only (`ModelPicker.css`: `--space-1`). Screenshot: `/home/matt/Development/helio/.concertino/runs/HEL-1755/evidence/openspec/changes/assistant-model-picker/evidence/skeptic-composer-dark-desktop.png`
  - Composer open, light, phone 390: the listbox opens upward and stays fully inside the viewport, clear of the bottom nav. The selected option has an accent wash and the trigger is beside Send. Screenshot: `/home/matt/Development/helio/.concertino/runs/HEL-1755/evidence/openspec/changes/assistant-model-picker/evidence/skeptic-picker-open-light-phone.png`
  - Settings, light, desktop: an "Assistant" section with a `FormField` + `Select` and a hint. Its heading matches its siblings. Screenshot: `/home/matt/Development/helio/.concertino/runs/HEL-1755/evidence/openspec/changes/assistant-model-picker/evidence/skeptic-settings-light-desktop.png`
  - Transcript label: I could not reproduce it live without a model call, since `/messages` strips `model`. I judged the executor/evaluator screenshot `eval1-transcript-label-light-desktop.png`, which shows "Opus 5.5" / "Sonnet 5.5" in muted xs text closing each answer bubble. That is subtle and on-token (`MessageTurn.css` `.message-turn__model`).
  - Console: the one error during my session was a 405 from my own `GET /api/users/me/preferences` probe (that route is PATCH-only). The app produced no errors.
  - State restored: the theme is back to dark, no preference or conversation was mutated, and the servers were stopped with `stop-servers.sh` (`STOPPED ports=7187,10094`).

### Verdict: CONFIRM

### Non-blocking notes
- **Flyway coordination (driver).** V140 is safe against origin/main (max V137). HEL-1740 holds V141. If HEL-1740 merges first, V140 becomes an out-of-order migration (no `outOfOrder`) and must be renumbered to max+1 before merge.
- **Evidence mislabel.** `evidence/eval1-transcript-label-light-desktop.png` is actually a dark-theme capture. Light parity of the transcript label rests on the token-only CSS (`--app-text-muted`, `--text-xs`), not on that image.
- **Settings layout.** The Assistant section uses a stacked `FormField`, while the Appearance section directly above uses an eyebrow-label column (labels at left, controls at 216px). This is acceptable as the canonical FormField pattern. Aligning it to the Appearance column would read more cohesively.
- **Existing conversations follow the default.** A conversation with `model: null` (made before the user set a default, with no explicit pick) follows a later Settings default change. This is consistent with design D3 ("keeps its pick" holds for any stored pick).
- **Narrowed-out server default label.** In the composer it shows its raw id rather than its catalog label (evaluator note, cosmetic).
- **Orphaned blobs.** The live-check transcript blobs under the local uploads root were left orphaned (rows deleted by exact id). They are harmless, and removal needs owner approval.
