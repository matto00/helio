## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed commit: 3b763f310a4bcc133f591898e7fb50f06b535adf (HEL-802 Move com.helio.ai and
com.helio.email under infrastructure/), diffed against base 36aa62c69b6665ff9afd728e4c21489421f7ee87
(origin/main, resolved live via `resolve-review-base.sh`).

### Phase 1: Spec Review — FAIL

Issues:

1. **Residual old-path reference inside the ticket's own scope** —
   `backend/src/test/scala/com/helio/services/assistant/CredentialSurfaceEnumerationSpec.scala:63`
   still constructs `new File(root, "backend/src/main/scala/com/helio/ai")` — the now-deleted
   directory. The executor updated this file's doc comment (line 14) and `should`-block label
   (line 61) from `com.helio.ai` to `com.helio.infrastructure.ai`, but missed the actual path
   literal the test body uses to walk the filesystem. Because
   `listFilesRecursively` short-circuits to `Vector.empty` when the target directory doesn't
   exist (line 38: `if (!dir.exists()) Vector.empty`), this assertion (`shouldBe empty`, line 63)
   now passes **vacuously** — the test silently stopped scanning the `ai` package for the token
   "credential" entirely, rather than continuing to actively verify it (it still separately checks
   `com/helio/services/assistant`, which is unaffected). `sbt test` shows this spec green with no
   indication anything changed.
   - This is squarely in-scope: AC3 requires "Every file in `backend/src/main/scala/**` and
     `backend/src/test/scala/**` that imports or references `com.helio.ai.*` / `com.helio.email.*`
     ... is updated," and design.md's D2 explicitly calls out sweeping for "any remaining
     `com.helio.ai`/`com.helio.email` string literal ... the compiler wouldn't catch (e.g. a
     comment, or a string-typed logger name)" — a string-typed directory-path literal is the same
     class of miss. tasks.md 5.3's grep (`com\.helio\.ai\b`, dot-form only) does not catch this
     because the literal uses slashes (`com/helio/ai`), not dots — confirmed independently: a
     repo-wide slash-form grep (`com/helio/ai\b`) turns up exactly this one in-scope hit.
   - This is a genuine, if narrow, behavior change caused by an incomplete move: a
     security-relevant regression-detection test lost its enforcement power over one of the two
     directories it's supposed to watch, silently. It is not a change to production logic, but it
     is a real defect the ticket's own D2 principle was written to catch.
   - Fix: change line 63's path argument to `"backend/src/main/scala/com/helio/infrastructure/ai"`.

All other AC items verified and correct:
- `com/helio/ai/` (11 `.scala` files + README) and `com/helio/email/` (3 `.scala` files + README)
  moved via genuine `git mv` — confirmed all 22 `.scala` files are 97–99% similarity renames
  (`git diff -M`), not add+delete pairs; only the `package` line and a handful of doc-comment FQN
  mentions changed inside each moved file. `ai/README.md` is a 52%-similarity rename (barely above
  git's 50% default threshold); `email/README.md` fell just under it (45% at `-M10%`) and renders
  as delete+add in a default `git diff` — confirmed via `-M10%` that it's the same underlying
  content, just heavily edited (D3's convention rewrite), not a lost-history fresh file. Non-issue.
- Every reference-sweep file's diff (40 files) touches only import/FQN lines that mention
  `com.helio.ai`/`com.helio.email` — verified with a grep of every `+`/`-` line in that diff; zero
  unrelated hunks.
- `com/helio/spark/`, `com/helio/app/`, and `backend/build.sbt`'s `mainClass` settings are
  byte-for-byte untouched (`git diff` against base returns empty for all three).
- `infrastructure/ai/README.md` and `infrastructure/email/README.md` verified against live
  `ls` output of their directories — accurate, not copy-pasted (both add a "not a domain"
  convention line per D3, `ai/README.md` also adds `ClaudeAiStepClient`).
  `infrastructure/README.md` now enumerates all six subdirectories, matching live `ls`, and its
  "no file lives directly in infrastructure/" claim still holds.
- `openspec/specs/claude-api-client/spec.md`, `CLAUDE.md` (3 mentions), `docs/secrets-inventory.md`,
  `frontend/src/features/assistant/types.ts` (2 doc comments), and all three
  `schemas/assistant/*.schema.json` `description` fields updated correctly — confirmed each is a
  pure prose/description edit with no shape change (schema-drift check also confirms, see Phase 2).
  The optional `docs/superpowers/specs/2026-09-10-interactive-data-writeback-design.md` one-liner
  (task 4.7, non-blocking) was done too.
- Full repo-wide dot-form completeness grep (task 5.3, run independently) across `backend/src`,
  `frontend/src`, `schemas`, `openspec/specs`, `CLAUDE.md`, `docs/secrets-inventory.md`: zero hits,
  confirmed.
- All tasks.md items are marked done and match what was implemented, except the gap above (task 3.3
  "update every ... reference across `backend/src/test/scala/**`" was checked off but is not
  actually complete for this one file).
- workflow-state.md's non-retired CONSTRAINTS (C1 sonnet-only, C2 HEL-632 iron constraint, C3
  merge/follow-up conventions) — no violation found; the one defect above is a miss, not a
  deliberate logic/behavior change.

### Phase 2: Code Review — FAIL

Gates re-run fresh in `WORKTREE_PATH` (not trusted from the executor's report):
- `cd backend && sbt compile && sbt Test/compile` — clean, no errors.
- `cd backend && sbt test` — **4703 tests, 0 failed** (matches the "pure move, no behavior change"
  expectation — including `CredentialSurfaceEnumerationSpec` itself, which passes only because it's
  now checking less than it used to; see Phase 1).
- Pre-commit hook chain, run individually in full: `check:repo-integrity`, `lint`, `typecheck`,
  `check:e2e-types`, `check:helio-mcp-types`, `format:check`, `check:schemas`,
  `check:spec-structure`, `check:openspec` (+ selftest), `check:dependabot` (+ selftest),
  `check:scala-quality`, `check:test-temp-dir-hygiene` (+ selftest), `check:no-credential-leak`
  (+ selftest), `check:tokens` (+ selftest), `npm test` (jest, both roots), and
  `npm --prefix frontend run build` — **all green**. `check:schemas` explicitly confirms the three
  edited `schemas/assistant/*.schema.json` files are still in sync (description-only edits, no
  shape drift), per task 4.9's own instruction.
- Every changed line in every moved/referencing file is either a `package` declaration, an
  import/FQN in a doc comment, a README rewrite, or a doc/schema description string — no logic,
  signature, or type-name changes found anywhere in the diff. HEL-632's iron constraint is honored
  in the production code.
- DRY/readable/modular/type-safety/security/error-handling: N/A — no logic surface changed.
- **Tests meaningful**: FAIL for the one file above — `CredentialSurfaceEnumerationSpec.scala` no
  longer exercises what its own doc comment (correctly updated!) says it exercises. This is exactly
  the kind of defect this checklist item exists to catch: a test that passes without proving
  anything.
- No dead code, no over-engineering, no drive-by behavior changes elsewhere — confirmed.

Non-blocking observations (repo-wide sweep beyond task 5.3's named scope, not gate-blocking):
- `backend/.env.example:35` still says `com.helio.email` in a comment.
- `e2e/README.md:13` still cites the old path
  `backend/src/test/scala/com/helio/ai/ClaudeClientSpec.scala` in prose.
  Neither file is named in ticket.md's AC or tasks.md 5.3's explicit grep scope, so these are
  follow-up-worthy but not required for this gate.

### Phase 3: UI Review — PASS

Triggered (schemas/**, frontend/src/features/assistant/types.ts, openspec/specs/**). Dev servers
started via `scripts/concertino/start-servers.sh`; `assert-phase.sh servers` returned PASS.
- Happy path: app loads (Dashboards page), sidebar nav, "Open assistant" dialog opens correctly
  (correctly shows the tier-gated "Assistant access is limited" message for this dev account — this
  is existing, unrelated tier-gating behavior, not a regression) and closes cleanly.
- Network requests (`/api/auth/me`, `/api/dashboards`, `/api/data-sources`, `/api/pipelines`) all
  `200 OK`.
- Zero console errors/warnings across the whole flow.
- Breakpoints 1440 / 1100 / 768 render without layout breakage (screenshots inspected, not
  persisted — no claim in this report rests on them beyond "renders", and none of the checked
  breakpoints showed a defect worth citing as evidence).
- This ticket makes no UI-behavior change at all (only backend package paths + doc/schema prose),
  so Phase 3's role here is a smoke check that the move didn't break anything at runtime — it
  didn't.

### Overall: FAIL

### Change Requests

1. **`backend/src/test/scala/com/helio/services/assistant/CredentialSurfaceEnumerationSpec.scala:63`**
   — change `new File(root, "backend/src/main/scala/com/helio/ai")` to
   `new File(root, "backend/src/main/scala/com/helio/infrastructure/ai")`. This is the one
   remaining reference to the old package location inside `backend/src/test/scala/**` (in-scope per
   AC3/task 3.3), and leaving it means this credential-surface regression test silently stopped
   checking the `ai` package. Re-run `sbt test` afterward and confirm the spec still passes (it
   should — the moved package genuinely has zero files matching "credential", same as before) and
   is now actually re-scanning the new directory rather than finding it absent.

### Non-blocking Suggestions

- `backend/.env.example:35` and `e2e/README.md:13` still mention the old `com.helio.ai`/
  `com.helio.email` paths in prose/comments. Neither is named in ticket.md's AC or tasks.md 5.3's
  explicit grep scope; fold into this change if trivial, or leave as a documented gap — does not
  block this gate.
