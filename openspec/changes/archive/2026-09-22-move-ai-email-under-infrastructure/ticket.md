# HEL-802: Decide whether ai/, email/, spark/ belong under infrastructure/ after the domain repackage

## Description

Deferred question, raised and deliberately deferred during HEL-633 planning. Filed so the question is recorded rather than silently dropped.

### The question

HEL-633 subdivides the five flat layers (`services/`, `api/routes/`, `api/protocols/`, `infrastructure/`, `domain/`) into domain subpackages. Four top-level packages sit outside those layers and were left untouched:

| Package | Files (as filed) | What it is |
| -- | -- | -- |
| `com/helio/ai/` | 10 | Claude client, transport, SSE assembly, wire models, token estimator |
| `com/helio/email/` | 3 | Resend REST client, `EmailConfig`, `EmailSender` |
| `com/helio/spark/` | 2 | `SparkJobSubmitter`, `PipelineRunCache` |
| `com/helio/app/` | 5 | `Main`, `HttpServer`, `DemoData`, scheduler actor, health check |

Leaving them alone was the right call for HEL-633 — folding them in would have expanded an already ~244-file change for no structural gain, and they are each already small and internally cohesive.

### Why it still needs deciding

`ai/` and `email/` are both **outbound third-party HTTP integrations**. That is the same kind of concern as `infrastructure/storage/` (GCS/local blob storage), which HEL-633 *does* place under `infrastructure/`. Once every other package is domained, a top-level `ai/` sitting beside `api/` and `domain/` will look anomalous, and the inconsistency will be harder to see than it is right now.

## OWNER RULING (binding — 2026-09-22 Linear comment, not to be re-litigated)

**Option 2.** Move `com/helio/ai/` → `com/helio/infrastructure/ai/` and `com/helio/email/` → `com/helio/infrastructure/email/`, as siblings of `infrastructure/storage/` and `infrastructure/crypto/`, because both are outbound third-party HTTP integrations. `com/helio/spark/` and `com/helio/app/` **stay where they are** — do not move them, do not widen scope to include them.

Write/refresh the package READMEs for the moved packages (HEL-632 decision 3: each README is verified against its package's real contents), and update any parent-package README that enumerates what lives under `infrastructure/`.

## Constraints (HEL-632 iron constraint, unchanged)

**Moves, package declarations, imports, and READMEs only. No behaviour changes. No logic, signature, or type-name changes.** Anything that looks like a real bug becomes a spinoff ticket, not a fix. `backend/build.sbt` pins `assembly / mainClass := Some("com.helio.app.Main")` and `Compile / run / mainClass` likewise — both must remain untouched since `app/` is not moving.

## Acceptance Criteria

- `com/helio/ai/**` (all 11 `.scala` files present in the live tree — see premise-validation note below — plus its README) is moved to `com/helio/infrastructure/ai/**` via `git mv`, with `package com.helio.ai` → `package com.helio.infrastructure.ai` in every moved file.
- `com/helio/email/**` (3 `.scala` files plus its README) is moved to `com/helio/infrastructure/email/**` via `git mv`, with `package com.helio.email` → `package com.helio.infrastructure.email`.
- Every file in `backend/src/main/scala/**` and `backend/src/test/scala/**` that imports or references `com.helio.ai.*` / `com.helio.email.*` (including the moved packages' own test specs) is updated to `com.helio.infrastructure.ai.*` / `com.helio.infrastructure.email.*`.
- `com/helio/spark/` and `com/helio/app/` are untouched — no file moves, no package changes.
- `backend/build.sbt`'s `mainClass` settings (both `Compile / run` and `assembly`) remain `com.helio.app.Main`, unmodified.
- The package README for `infrastructure/ai/` and `infrastructure/email/` exist and are verified against the package's real (post-move) contents.
- `infrastructure/README.md` is updated to enumerate `ai/` and `email/` alongside `persistence/`, `storage/`, `crypto/`, `concurrency/`, and its "no file lives directly in infrastructure/" claim is preserved accurately.
- The live spec `openspec/specs/claude-api-client/spec.md`'s statement that `ClaudeConfig` is defined in `com.helio.ai` is updated to `com.helio.infrastructure.ai`.
- `CLAUDE.md`'s three FQN references (`com.helio.ai`, `com.helio.email`, `com.helio.email.EmailConfig`) and `docs/secrets-inventory.md`'s one FQN reference are updated to the new package paths.
- `frontend/src/features/assistant/types.ts`'s two doc-comment FQN mentions (`Mirrors com.helio.ai.ClaudeToolMessage` / `ClaudeContentBlock`) and the three `schemas/assistant/*.schema.json` `description`-field `(com.helio.ai)` mentions are updated to `com.helio.infrastructure.ai` (found during the design gate's round-1 skeptic review — see design.md's Context section).
- No test assertion depends on the old logger category string (none were found in premise validation — HEL-803's `getLogger(getClass)` realignment means moved classes' log categories update automatically with the move).
- `sbt compile` and `sbt test` both pass with zero behavioral change — a pure mechanical move.
- Pre-commit hooks (lint, typecheck, format, schema-drift, OpenSpec hygiene, Scala code-quality check) pass.

## Premise-validation notes (orchestrator, 2026-09-22)

- The ticket's file counts have drifted since filing (2026-08-22): `ai/` now has **11** `.scala` files, not 10 — `ClaudeAiStepClient.scala` was added afterward by HEL-1106/1107. `email/`'s count of 3 is still accurate. This is minor staleness only — it does not change what gets built, only how many files get `git mv`'d.
- `domain/ai/AiStepClient.scala` (a different, pre-existing package — `com.helio.domain.ai`, NOT `com.helio.ai`) has one doc-comment cross-reference to `[[com.helio.ai.ClaudeError]]` that also needs updating even though `domain/ai/` itself is not moving.
- `email/HttpResendEmailSender.scala` and `email/EmailSender.scala` cross-reference `com.helio.ai` types internally — these are intra-move references (both source and target package are moving) but still need their import statements updated.
- Full reference survey (main + test, 20+ files each) is in the persisted `premise-validation.md` evidence file for this ticket.
