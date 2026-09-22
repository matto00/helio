# Files Modified — HEL-802

Pure mechanical package move: `com/helio/ai/` → `com/helio/infrastructure/ai/`,
`com/helio/email/` → `com/helio/infrastructure/email/`. `git mv` + `package`
declarations + imports/FQN references + READMEs + the doc/schema text
references named in tasks.md 4.4-4.9. No logic, signature, or type-name
changes anywhere.

## Moved packages (git mv, package line updated)

- `backend/src/main/scala/com/helio/infrastructure/ai/ClaudeAiStepClient.scala` — moved from `com/helio/ai/`; package updated
- `backend/src/main/scala/com/helio/infrastructure/ai/ClaudeClient.scala` — moved from `com/helio/ai/`; package updated
- `backend/src/main/scala/com/helio/infrastructure/ai/ClaudeConfig.scala` — moved from `com/helio/ai/`; package updated
- `backend/src/main/scala/com/helio/infrastructure/ai/ClaudeModels.scala` — moved from `com/helio/ai/`; package updated
- `backend/src/main/scala/com/helio/infrastructure/ai/ClaudeProtocol.scala` — moved from `com/helio/ai/`; package updated
- `backend/src/main/scala/com/helio/infrastructure/ai/ClaudeSseAssembler.scala` — moved from `com/helio/ai/`; package updated
- `backend/src/main/scala/com/helio/infrastructure/ai/ClaudeSseFrameParser.scala` — moved from `com/helio/ai/`; package updated
- `backend/src/main/scala/com/helio/infrastructure/ai/ClaudeTokenEstimator.scala` — moved from `com/helio/ai/`; package updated
- `backend/src/main/scala/com/helio/infrastructure/ai/ClaudeTransport.scala` — moved from `com/helio/ai/`; package updated
- `backend/src/main/scala/com/helio/infrastructure/ai/ClaudeWireModels.scala` — moved from `com/helio/ai/`; package updated
- `backend/src/main/scala/com/helio/infrastructure/ai/HttpClaudeTransport.scala` — moved from `com/helio/ai/`; package updated
- `backend/src/main/scala/com/helio/infrastructure/ai/README.md` — moved from `com/helio/ai/`; refreshed against real post-move contents (added `ClaudeAiStepClient`, added "not a domain" convention line)
- `backend/src/main/scala/com/helio/infrastructure/email/EmailConfig.scala` — moved from `com/helio/email/`; package updated
- `backend/src/main/scala/com/helio/infrastructure/email/EmailSender.scala` — moved from `com/helio/email/`; package updated
- `backend/src/main/scala/com/helio/infrastructure/email/HttpResendEmailSender.scala` — moved from `com/helio/email/`; package updated
- `backend/src/main/scala/com/helio/infrastructure/email/README.md` — moved from `com/helio/email/`; refreshed against real post-move contents (added "not a domain" convention line)
- `backend/src/main/scala/com/helio/email/README.md` — old-path deletion side of the above move; git's similarity heuristic scored this rename below its detection threshold (content substantially rewritten per the D3 README convention) so it shows as delete+add rather than a detected rename, not as a lost-history fresh file
- `backend/src/test/scala/com/helio/infrastructure/ai/ClaudeAiStepClientSpec.scala` — moved from `com/helio/ai/` (test tree); package updated
- `backend/src/test/scala/com/helio/infrastructure/ai/ClaudeClientSpec.scala` — moved from `com/helio/ai/` (test tree); package updated
- `backend/src/test/scala/com/helio/infrastructure/ai/ClaudeConfigSpec.scala` — moved from `com/helio/ai/` (test tree); package updated
- `backend/src/test/scala/com/helio/infrastructure/ai/ClaudeProtocolSpec.scala` — moved from `com/helio/ai/` (test tree); package updated
- `backend/src/test/scala/com/helio/infrastructure/ai/ClaudeStreamAssemblySpec.scala` — moved from `com/helio/ai/` (test tree); package updated
- `backend/src/test/scala/com/helio/infrastructure/ai/HttpClaudeTransportSpec.scala` — moved from `com/helio/ai/` (test tree); package updated
- `backend/src/test/scala/com/helio/infrastructure/email/HttpResendEmailSenderSpec.scala` — moved from `com/helio/email/` (test tree); package updated

## Reference sweep (import/FQN updated, no other changes)

- `backend/src/main/scala/com/helio/api/ApiRoutes.scala` — `com.helio.ai`/`com.helio.email` imports updated
- `backend/src/main/scala/com/helio/api/protocols/assistant/AssistantConversationProtocol.scala` — FQN references updated
- `backend/src/main/scala/com/helio/api/protocols/assistant/AssistantProposalToolSchemas.scala` — FQN references updated
- `backend/src/main/scala/com/helio/api/protocols/assistant/AssistantProtocol.scala` — FQN references updated
- `backend/src/main/scala/com/helio/api/routes/assistant/AssistantConversationRoutes.scala` — import updated
- `backend/src/main/scala/com/helio/domain/ai/AiStepClient.scala` — `[[com.helio.ai.ClaudeError]]` doc-comment cross-reference updated (this package itself is NOT moving)
- `backend/src/main/scala/com/helio/infrastructure/persistence/assistant/AssistantConversationRepository.scala` — import updated
- `backend/src/main/scala/com/helio/infrastructure/persistence/proposals/AuthoringConversationRepository.scala` — import updated
- `backend/src/main/scala/com/helio/services/assistant/AssistantConversationService.scala` — import updated
- `backend/src/main/scala/com/helio/services/assistant/AssistantService.scala` — import updated
- `backend/src/main/scala/com/helio/services/assistant/AssistantTelemetry.scala` — import updated
- `backend/src/main/scala/com/helio/services/assistant/AssistantToolExecutor.scala` — import updated
- `backend/src/main/scala/com/helio/services/auth/BetaAccessService.scala` — import updated
- `backend/src/main/scala/com/helio/services/patchsets/RefinementConversationTurns.scala` — import updated
- `backend/src/main/scala/com/helio/services/patchsets/RefinementPrompt.scala` — import updated
- `backend/src/main/scala/com/helio/services/patchsets/RefinementService.scala` — import updated
- `backend/src/main/scala/com/helio/services/proposals/AuthoringConversationTurns.scala` — import updated
- `backend/src/main/scala/com/helio/services/proposals/AuthoringError.scala` — import updated
- `backend/src/main/scala/com/helio/services/proposals/AuthoringHistoryBudget.scala` — import updated
- `backend/src/main/scala/com/helio/services/proposals/AuthoringOutcomeHelpers.scala` — import updated
- `backend/src/main/scala/com/helio/services/proposals/AuthoringTelemetry.scala` — import updated
- `backend/src/main/scala/com/helio/services/proposals/DashboardAuthoringPrompt.scala` — import updated
- `backend/src/main/scala/com/helio/services/proposals/DashboardAuthoringService.scala` — import updated
- `backend/src/main/scala/com/helio/services/workspace/WorkspaceAssistantTools.scala` — import updated
- `backend/src/test/scala/com/helio/api/routes/assistant/AssistantConversationRoutesSpec.scala` — import updated
- `backend/src/test/scala/com/helio/api/routes/auth/BetaAccessRoutesSpec.scala` — import updated
- `backend/src/test/scala/com/helio/api/routes/patchsets/RefinementRoutesSpec.scala` — import updated
- `backend/src/test/scala/com/helio/api/routes/proposals/DashboardAuthoringRoutesSpec.scala` — import updated
- `backend/src/test/scala/com/helio/domain/steps/AnalyzeWithAiStepSpec.scala` — import updated
- `backend/src/test/scala/com/helio/domain/steps/GenerateTextStepSpec.scala` — import updated
- `backend/src/test/scala/com/helio/infrastructure/persistence/proposals/AuthoringConversationRepositorySpec.scala` — import updated
- `backend/src/test/scala/com/helio/services/assistant/AssistantConversationServiceSpec.scala` — import updated
- `backend/src/test/scala/com/helio/services/assistant/AssistantServiceSpec.scala` — import updated
- `backend/src/test/scala/com/helio/services/assistant/AssistantTelemetrySpec.scala` — import updated
- `backend/src/test/scala/com/helio/services/assistant/CredentialSurfaceEnumerationSpec.scala` — import updated
- `backend/src/test/scala/com/helio/services/auth/BetaAccessServiceSpec.scala` — import updated
- `backend/src/test/scala/com/helio/services/patchsets/RefinementServiceSpec.scala` — import updated
- `backend/src/test/scala/com/helio/services/pipelines/PipelineRunServiceAiStepClientWiringSpec.scala` — import updated
- `backend/src/test/scala/com/helio/services/proposals/AuthoringTelemetrySpec.scala` — import updated
- `backend/src/test/scala/com/helio/services/proposals/DashboardAuthoringServiceSpec.scala` — import updated

## READMEs / docs / spec / schema text references (task 4.3-4.9)

- `backend/src/main/scala/com/helio/infrastructure/README.md` — subdirectory enumeration extended to include `ai/` and `email/` (now six subdirectories)
- `openspec/specs/claude-api-client/spec.md` — `ClaudeConfig` FQN mention updated
- `CLAUDE.md` — 3 FQN mentions updated (`ANTHROPIC_API_KEY`, `RESEND_API_KEY`, `HELIO_EMAIL_FROM` rows); reformatted by Prettier after the edit
- `docs/secrets-inventory.md` — 1 FQN mention updated
- `docs/superpowers/specs/2026-09-10-interactive-data-writeback-design.md` — 1 FQN mention updated (trivial one-line edit, per design.md D5)
- `frontend/src/features/assistant/types.ts` — 2 doc-comment FQN mentions updated (lines 32/39, `ClaudeToolMessage`/`ClaudeContentBlock`)
- `schemas/assistant/create-assistant-conversation-request.schema.json` — 1 `description`-field FQN mention updated
- `schemas/assistant/assistant-conversation.schema.json` — 1 `description`-field FQN mention updated
- `schemas/assistant/append-assistant-conversation-turn-request.schema.json` — 1 `description`-field FQN mention updated

## Untouched (verified, per ticket's iron constraint)

- `backend/src/main/scala/com/helio/spark/**` — no changes
- `backend/src/main/scala/com/helio/app/**` — no changes
- `backend/build.sbt`'s `mainClass` settings — byte-for-byte unchanged (still `com.helio.app.Main`)

## Cycle 2 — evaluator change request fix (evaluation-1.md)

- `backend/src/test/scala/com/helio/services/assistant/CredentialSurfaceEnumerationSpec.scala` — fixed a missed slash-form path literal (`"backend/src/main/scala/com/helio/ai"` → `".../infrastructure/ai"`) at line 63. The dot-form greps in tasks.md 3.3/5.3 never caught it; the test was passing vacuously (target directory didn't exist, `listFilesRecursively` short-circuited to empty) rather than actually re-scanning the moved package. Confirmed fix is non-vacuous: `ls backend/src/main/scala/com/helio/infrastructure/ai/*.scala` → 11 files; old directory confirmed absent; spec re-run green.
- `e2e/README.md` — non-blocking prose mention (line 13) updated for completeness, trivial one-liner
- `backend/.env.example` — non-blocking comment mention (line 35) updated for completeness, trivial one-liner
