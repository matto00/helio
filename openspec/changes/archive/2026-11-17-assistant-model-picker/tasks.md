## Standing Constraints

- [C15] Beta cost rule (owner Q1): weighted daily counter on HELIO_BETA_DAILY_MESSAGE_LIMIT, Haiku 1 / Sonnet 4 / Opus 8, weights in the shared catalog, env-overridable; owner tier uncounted.
- [C16] Live check (owner Q2): $2 cap, stop at projected $1.50; one short tool turn per model + Haiku->Opus->Haiku; pin the model on every request; assert the response model id before counting; no live call before this point is reached in tasks.
- [C17] For catalog models never send temperature/top_p/top_k, budget_tokens/thinking.enabled, or forced tool_choice; the prohibition lives in the shared catalog.
- [C18] Flyway V140 is this lane's (driver-confirmed); V138/V139 reserved for HEL-1740/1742.
- [C19] (retired at design gate round 1, superseded by C20) Do not edit ActionsMenu.tsx or panelFit.ts (HEL-1750); native select picker.
- [C20] Both model pickers use the shared `Select` (and Settings a `FormField`), consumed without editing; HEL-1750's popover/ActionsMenu files are never edited, placement changes go through the driver.

## 1. Backend: catalog and client

- [x] 1.1 Add `ClaudeModelCatalog`/`ClaudeModelSpec` in `infrastructure/ai` with `fromEnv` (`CLAUDE_SELECTABLE_MODELS`, `HELIO_BETA_MODEL_WEIGHTS`) per design D1
- [x] 1.2 Add `model: Option[ClaudeModelSpec]` to `ClaudeToolRequest` and `ClaudeRequest`; write the spec id on the wire (D2)
- [x] 1.3 Make `wireTemperature` return None for any catalog model; never emit thinking/budget_tokens/tool_choice (D2, C17)
- [x] 1.4 Decode the response `model` into `ClaudeApiResponse`; carry `responseModel` on outcomes; WARN on mismatch; post-parse per-hop INFO line (request-id, model, stop_reason, block types) (D2)

## 2. Backend: persistence, routes, counter

- [x] 2.1 Add `V140__assistant_conversation_model.sql` (nullable `model` column) and wire it through the repository/record (D4)
- [x] 2.2 `ClaudeToolMessage.model` + repository format read/write; stamp new assistant turns server-side; strip `model` from client-supplied turns (D5)
- [x] 2.3 `effectiveModel` rule (stored if selectable > user default if selectable > server default) and catalog-defined vs selectable; converse uses request model else effective; persist a request model (D3)
- [x] 2.4 Accept and validate `model` on converse and PATCH (400 outside the allow-list, PATCH null clears); stamp the user default on create; `model` + `effectiveModel` on summary/detail (D3/D4)
- [x] 2.5 Weighted `incrementIfUnderCap` and `checkConverseCap(user, tier, weight)`; `guardAndCount` keeps weight 1 (D7)
- [x] 2.6 `GET /api/assistant-models` behind the chat tier guard, incl. the caller's resolved `defaultModel` (D8)
- [x] 2.7 `assistantModel` preference in `UserPreferencesData`/`UserPreferencesRoutes` and auth responses (D9)
- [x] 2.8 Pass the resolved model to `AssistantService.converse` and use it for telemetry `modelId`

## 3. Contracts and docs

- [x] 3.1 Update `converse-request`, `assistant-conversation`, `assistant-conversation-summary`, `update-assistant-conversation-request`, `auth/user-preferences`, `auth/update-user-preferences-request` schemas; add `assistant-models-response.schema.json`; document the per-turn `model` on transcript items
- [x] 3.2 CLAUDE.md: `CLAUDE_MODEL` row (server default, overridable per conversation) and rows for the two new env vars

## 4. Frontend

- [x] 4.1 Service + slice: fetch the model list, conversation `model`, PATCH model, `model` on turns (types)
- [x] 4.2 Composer model picker with the shared `Select` (effectiveModel value, server-default option when not selectable, optimistic PATCH reverted on error) (D10, C20)
- [x] 4.5 No-conversation picker: value `defaultModel`, pick held in the slice and sent as `model` on the first converse; refetch models + active conversation after a Settings save (D10)
- [x] 4.3 Muted per-answer model label in the transcript
- [x] 4.4 Settings "Assistant" section: `FormField` + shared `Select`, "Server default" clears (owner/beta only)

## 5. Tests

- [x] 5.1 Red first: unknown model id -> 400 on converse and PATCH, no model call, counter unchanged (record the red run)
- [x] 5.2 Catalog: env narrowing/weights parsing; every selectable id priced in `InsightPriceTable.Default`
- [x] 5.3 Client: catalog model omits sampling even with an explicit temperature; model id on the wire; response model decoded; mutation recorded
- [x] 5.4 Model-switch tests on SYNTHETIC fixtures (documented shapes) for all ordered pairs incl. Haiku->Opus, Opus->Haiku, thinking + tool use; fake 400s on a foreign thinking block (D6)
- [x] 5.5 Weighted counter repo/service tests (incl. 3 units left: Opus denied, Haiku allowed; weight > limit) against Postgres
- [x] 5.6 effectiveModel rule incl. unselectable stored model and non-catalog server default, per-turn stamping, client-supplied model stripped, default on create, preferences validation
- [x] 5.7 Frontend unit tests: picker (incl. server-default option and the no-conversation pick reaching the first converse), transcript label, Settings section
- [x] 5.8 UI check on the running app: light/dark, desktop/phone composer + Settings (screenshots in evidence)
- [x] 5.9 Live check per D11 within C16 (every switch-conversation turn tool-using; per hop request-id, model, stop_reason, thinking present); write `evidence/live-check.md` with usage + cost; delete conversations by exact id
