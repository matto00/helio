## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed at HEAD 5bd0e7f94b0dd1acc8cb515d2697de80ceb0fb03 (change dir untracked; no code changes yet).
Owner rulings (weights 1/4/8, $2 cap stop at $1.50, V140) taken as given and not re-litigated.

### What I verified (with evidence)

- Spawn-cwd guard: `assert-cwd.sh` -> `READY ambient=/home/matt/Development/helio branch=feature/assistant-model-picker/HEL-1755`.
- `ClaudeConfig.DefaultModel = "claude-opus-4-8"` (ClaudeConfig.scala, line 37). Confirmed.
- `wireTemperature` (ClaudeClient.scala:333-334): `Some(requested.getOrElse(config.temperature)).filter(_ != 1.0)`, so
  only 1.0 is omitted, and an explicit caller temperature still goes on the wire. Design D2's claim is correct.
- No `thinking` config, `tool_choice`, `top_p`, `top_k` or `budget_tokens` is written anywhere: grep of
  `backend/src/main/scala` finds only thinking *content blocks* (ClaudeProtocol.scala:111,
  AssistantConversationRepository.scala:201). `claudeApiRequestFormat` writes model/max_tokens/messages/stream (+temperature).
- `ClaudeApiResponse` (ClaudeWireModels.scala:73) has no `model` field. Confirmed.
- `AssistantService.persistable` (AssistantService.scala:224-231) drops Thinking/RedactedThinking/Opaque. So D6's
  cross-turn argument holds, and within one `sendWithTools` loop the model is fixed by construction (one request object).
- `incrementIfUnderCap` adds exactly 1 with `WHERE message_count < limit`. `checkConverseCap(user, tier)` calls it,
  `guardAndCount` composes it, and `AiPipelineQuotaGate` also calls it. A `weight = 1` default keeps that third
  caller unchanged. D7's INSERT/UPDATE logic, including `weight > limit` returning false with no write, is sound.
- The converse route order (AssistantConversationRoutes.scala:228-270) is: guard, idempotency validation, `service.get`,
  replay short-circuit, `checkConverseCap`, `converseFlow`. Model validation can sit beside idempotency validation, which
  satisfies "400 before any model call, counter charge or persistence".
- The last migration on HEAD and on origin/main is V137, so V140 is free (V138/V139 reserved per C18).
- `InsightPriceTable.Default` has all three 5.5 ids at the prices in evidence/api-contract.md.
- `domain` already imports `infrastructure` in several files, so D1's layering is not new.
- helio-mcp/src has no converse tool (grep "converse" returns nothing). The non-goal is valid.
- `UserPreferencesRoutes` allow-lists fields and treats `motion: null` as clear (UserPreferencesRoutes.scala:28,62-65). D9 matches.
- The tier-gated spec delta keeps every existing scenario of "Beta-tier message sends are capped per day" and adds one.
- Every AC is covered by tasks: AC1 -> 2.3/2.4/2.7/4.x; AC2 -> 2.5/5.5; AC3 -> 2.2; AC4 -> 5.1; AC5 -> 5.4; AC6 -> 5.9;
  AC7 -> 5.8; AC8 -> 3.2.
- API-contract notes are claims from an external fetch. No live call is allowed here (C14). The parts I could check in
  the tree (client wire shape, temperature behavior, price table) match.

### Verdict: REFUTE

### Change Requests

1. **D10 / C19 / tasks 4.2, 4.4: the native `<select>` breaks DESIGN.md §6, and its justification does not hold.**
   DESIGN.md §6 names **Select (portal-based)** as the canonical primitive: "Use these; do not hand-roll
   equivalents. [mechanical] (raw-element detection)". `frontend/src/shared/ui/Select.tsx:42` describes itself as the
   "App-styled custom dropdown that replaces native <select>", and production `.tsx` has **zero** native `<select>`
   elements (grep; the only hit is a doc comment). C19 only forbids *editing* `ActionsMenu.tsx`/`panelFit.ts`.
   Importing the shared `Select` edits neither. `frontend/src/shared/ui/panelFit.ts` does not exist on HEAD, and
   `Select` uses `selectPanelFit.ts`/`usePortalPopover`. Revise D10, C19 and tasks 4.2/4.4 so that:
   - the composer picker and the Settings default both use the shared `Select`, without editing it;
   - the Settings row uses `FormField`;
   - the plan states that HEL-1750's files are consumed, not edited.

2. **Contract gaps: two `additionalProperties: false` schemas are missing from task 3.1 and the proposal's Impact.**
   D4 adds `model` to the summary response and to the PATCH request. Both
   `schemas/assistant/assistant-conversation-summary.schema.json` and
   `schemas/assistant/update-assistant-conversation-request.schema.json` are closed objects. As planned, a valid PATCH
   `{model}` and every summary response would violate the contract. Add both to 3.1 and Impact. Also name the
   preferences schemas explicitly: `schemas/auth/user-preferences.schema.json` and
   `update-user-preferences-request.schema.json`, whose description lists the allowed keys.

3. **What the picker shows is unspecified when the conversation's stored model is null or unusable.**
   D4 stores `null` for legacy conversations and for those created without a user default. D3 resolves `null` at
   send time to user default, then server default. D10 says the picker "shows the conversation's model label", but
   that is undefined for `null`, so a client could show the server default while the server sends on the user
   default. Two more cases are unspecified:
   - the server default is not a catalog id (the code default `claude-opus-4-8`, i.e. local dev); a select whose
     value matches no option renders misleadingly;
   - a stored `conversation.model` is no longer selectable after `CLAUDE_SELECTABLE_MODELS` narrowing; D3 covers
     this only for the user default.

   Specify one rule and test it in 5.6/5.7. For example: summary/detail responses carry the server-resolved
   effective model id, an unselectable stored model falls through like an unselectable default, and the picker's
   rendering of a non-catalog effective model is defined.

4. **D6 / D11 do not yet meet the AC's "recorded-fixture" wording.** AC5 says "Prove it with recorded-fixture tests
   per model pair". D6 describes a synthetic fake transport whose 400 rules encode the design's own reading of the
   docs. A test against that fake can only confirm the assumption it was built from. Revise D6 to state where the
   fixtures come from:
   - either response bodies captured during the D11 live run (redacted, with real thinking/signature shapes), which
     reorders 5.4 after 5.9 for those fixtures;
   - or explicitly synthetic fixtures, with the D11 switch conversation named as the real-API corroboration.

   In both cases, D11/5.9 must require that every turn of the Haiku -> Opus -> Haiku conversation is tool-using. It
   must also record per hop whether the response carried a thinking block, so both switch directions are measured
   against the real API with tool use and thinking. Today D11 only requires tool use on the single-model turns.

### Non-blocking notes

- D2 says "D9's request-id INFO line also logs the response model". `HttpClaudeTransport.logResponse` runs before the
  body is parsed (HttpClaudeTransport.scala:70-73, called before `parseJson`), so the model is not available there.
  The line must move after the parse, or a second correlated line is needed. This matters for D11's evidence.
- D5 reuses the repository `ClaudeToolMessage` format. If that format also decodes `POST /:id/messages` turns and
  `create.firstMessage`, a client can post an assistant turn with any `model` label. That is only the user's own
  transcript, but consider ignoring `model` on client-supplied turns so the per-turn record is always server-stamped.
- D1/D3: a server default that the catalog defines but `CLAUDE_SELECTABLE_MODELS` excludes is not specified. It
  should still get its catalog weight and sampling rules; say "catalog-defined" versus "selectable" explicitly.
- HEL-1740 (insight `model` config key) is a parallel lane. Make sure it consumes `ClaudeModelCatalog` rather than
  shipping its own allow-list, which is coordination for the driver.
- The Opus `max_tokens` 4096 with always-on thinking risk is noted correctly. The live check should record
  `stop_reason` per call.
