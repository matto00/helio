## Standing Constraints

- [C1] SONNET ON ALL AGENTS; no opus promotions (coordinator directive, this run)
- [C2] HEL-632 iron constraint: git mv + package declarations + imports + READMEs ONLY. No logic, signature, or type-name changes. Anything that looks like a real bug becomes a spinoff, not a fix.
- [C3] Never `gh pr merge --auto`. Follow-ups get origin_kind/origin_ticket + relatedTo + Follow-up label.

### Backend — baseline

- [x] 1.1 Snapshot the pre-move reference survey: `grep -rl "com\.helio\.ai\b" backend/src/{main,test} --include="*.scala" | grep -v '/com/helio/ai/'` and the `com.helio.email` equivalent; record the live counts as the baseline (design.md's Context section states 25 main + 14 test for `ai`, 2 main + 2 test for `email` — the live grep is authoritative; if it diverges from that number, proceed without blocking and note the drift, do not treat a mismatch as a blocker)
- [x] 1.2 Record `sbt compile` and `sbt test` green + test count on the untouched worktree before any move, as the baseline to diff against

### Backend — move

- [x] 2.1 `git mv backend/src/main/scala/com/helio/ai backend/src/main/scala/com/helio/infrastructure/ai`; verify `git status` shows renames, not add+delete
- [x] 2.2 `git mv backend/src/main/scala/com/helio/email backend/src/main/scala/com/helio/infrastructure/email`; verify renames
- [x] 2.3 `git mv backend/src/test/scala/com/helio/ai backend/src/test/scala/com/helio/infrastructure/ai`; verify renames
- [x] 2.4 `git mv backend/src/test/scala/com/helio/email backend/src/test/scala/com/helio/infrastructure/email`; verify renames
- [x] 2.5 Update `package com.helio.ai` → `package com.helio.infrastructure.ai` in every moved main/test file; same for `email`
- [x] 2.6 Confirm `com/helio/spark/`, `com/helio/app/`, and `backend/build.sbt`'s `mainClass` settings are byte-for-byte unchanged (`git diff` shows no hit on these paths)

### Backend — reference sweep

- [x] 3.1 Update every `import com.helio.ai...` / FQN reference across `backend/src/main/scala/**` (including `domain/ai/AiStepClient.scala`'s `[[com.helio.ai.ClaudeError]]` doc comment) to `com.helio.infrastructure.ai`
- [x] 3.2 Update every `import com.helio.email...` / FQN reference across `backend/src/main/scala/**` to `com.helio.infrastructure.email`
- [x] 3.3 Update every `com.helio.ai`/`com.helio.email` reference across `backend/src/test/scala/**` to the new paths
- [x] 3.4 `sbt compile` and `sbt Test/compile`; fix every reported error — repeat until both are clean (design.md D2)
- [x] 3.5 Re-grep for any residual `com\.helio\.ai\b` / `com\.helio\.email\b` hit in `backend/src/**` outside the moved packages' own new location; zero hits required
- [x] 3.6 `sbt test`; confirm the same pass/fail count as the 1.2 baseline (pure move — no behavior change)

### Backend — READMEs and docs

- [x] 4.1 Write `infrastructure/ai/README.md` following the `storage/README.md`/`crypto/README.md` convention (what it is, "not a domain", Does-NOT-hold if applicable), verified against the real post-move `ls infrastructure/ai/`
- [x] 4.2 Write `infrastructure/email/README.md` the same way, verified against `ls infrastructure/email/`
- [x] 4.3 Update `infrastructure/README.md` to enumerate `ai/` and `email/` alongside the existing four subdirectories, keeping the "no file lives directly in infrastructure/" claim accurate
- [x] 4.4 Update `openspec/specs/claude-api-client/spec.md`'s `com.helio.ai` FQN mention to `com.helio.infrastructure.ai`
- [x] 4.5 Update `CLAUDE.md`'s three FQN mentions (`com.helio.ai`, `com.helio.email`, `com.helio.email.EmailConfig`) to their new paths
- [x] 4.6 Update `docs/secrets-inventory.md`'s `com.helio.ai` FQN mention
- [x] 4.7 Update `docs/superpowers/specs/2026-09-10-interactive-data-writeback-design.md`'s `com.helio.ai` mention if a trivial one-line edit; otherwise note as a non-blocking follow-up
- [x] 4.8 Update `frontend/src/features/assistant/types.ts` lines 32 and 39 (`Mirrors com.helio.ai.ClaudeToolMessage` / `Mirrors com.helio.ai.ClaudeContentBlock` doc comments) to `com.helio.infrastructure.ai...`
- [x] 4.9 Update the `(com.helio.ai)` mentions in `schemas/assistant/create-assistant-conversation-request.schema.json:14`, `schemas/assistant/assistant-conversation.schema.json:5`, and `schemas/assistant/append-assistant-conversation-turn-request.schema.json:11` to `(com.helio.infrastructure.ai)`; re-run the schema-drift pre-commit check to confirm these are description-only edits with no shape change

### Tests

- [x] 5.1 Full `sbt test` run on the final worktree state — zero new failures vs. the 1.2 baseline
- [x] 5.2 Confirm pre-commit hooks pass: lint, typecheck, format, schema-drift, OpenSpec hygiene, Scala code-quality
- [x] 5.3 Confirm zero residual `com.helio.ai`/`com.helio.email` hits anywhere in `backend/src/**`, `frontend/src/**`, `schemas/**`, `CLAUDE.md`, `docs/secrets-inventory.md`, and the live `openspec/specs/**` (archived changes under `openspec/changes/archive/**` and the dated `docs/superpowers/specs/**` snapshot are expected to still reference the old paths and are out of scope) — run `grep -rn "com\.helio\.ai\b\|com\.helio\.email\b" backend/src frontend/src schemas openspec/specs CLAUDE.md docs/secrets-inventory.md` and confirm it returns nothing

### Cycle 2 — evaluator change request (evaluation-1.md)

- [x] 6.1 `backend/src/test/scala/com/helio/services/assistant/CredentialSurfaceEnumerationSpec.scala:63` — the slash-form path literal `"backend/src/main/scala/com/helio/ai"` was missed by tasks.md 3.3/5.3's dot-form (`com\.helio\.ai\b`) greps; the test's `listFilesRecursively` short-circuits to `Vector.empty` for a nonexistent directory, so the assertion passed vacuously post-move instead of actually re-scanning the moved `ai/` package. Fixed to `"backend/src/main/scala/com/helio/infrastructure/ai"`. Repo-wide slash-form grep (`com/helio/ai\b` / `com/helio/email\b`, excluding `infrastructure/`, `domain/ai/`, and this change's own planning docs) confirmed no other in-scope hit; two non-blocking prose mentions outside gate scope (`backend/.env.example:35`, `e2e/README.md:13`) were trivial one-liners and fixed too.
