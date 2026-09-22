## Context

See proposal.md for motivation. Binding owner ruling (2026-09-22 Linear comment on HEL-802): Option 2 —
move `ai/` and `email/` under `infrastructure/`, leave `spark/`/`app/` alone. Not re-litigated here.

Live-tree survey (this run, superseding the ticket's 2026-08-22 counts — see the persisted
`premise-validation.md` evidence for the full reference list):

- `com/helio/ai/`: 11 `.scala` files + `README.md`. `ClaudeAiStepClient.scala` was added after the
  ticket was filed (HEL-1106/1107) — same move, one more file.
- `com/helio/email/`: 3 `.scala` files + `README.md` — matches the ticket exactly.
- Reference count (corrected 2026-09-22, skeptic-design-1.md round 1 REFUTE — the orchestrator's initial
  premise-validation counts were themselves stale; these are re-verified against the live tree):
  `com.helio.ai` is imported/FQN-referenced from **25 main files + 14 test files** outside the package
  itself (including `domain/ai/AiStepClient.scala`'s doc-comment `[[com.helio.ai.ClaudeError]]`
  cross-reference, and `email/`'s own two files, which move too). `com.helio.email` is referenced from
  **2 main files + 2 test files** outside the package. Verified with
  `grep -rl 'com\.helio\.ai\b' backend/src/{main,test} --include="*.scala" | grep -v '/com/helio/ai/'`
  and the `email` equivalent.
- **Two additional reference classes outside `backend/`, missed by the initial premise-validation sweep**
  (found by skeptic-design-1.md via a repo-wide grep across `*.md/*.scala/*.ts/*.tsx/*.sh/*.yml/*.yaml/*.json`):
  - `frontend/src/features/assistant/types.ts` lines 32 and 39 — doc comments
    `Mirrors com.helio.ai.ClaudeToolMessage` / `Mirrors com.helio.ai.ClaudeContentBlock`.
  - Three JSON Schema files under `schemas/assistant/` (the repo's own CLAUDE.md calls `schemas/` the
    contract source of truth): `create-assistant-conversation-request.schema.json:14`,
    `assistant-conversation.schema.json:5`, `append-assistant-conversation-turn-request.schema.json:11`
    — each has a `(com.helio.ai)` mention in a `description` field.
- No logger-category string assertions found in tests; `logback.xml` has no hardcoded category strings
  (uses `%logger{36}` pattern substitution) — HEL-803's `getLogger(getClass)` realignment means moved
  classes' categories follow the move automatically, no config change needed.
- Non-code references that state the old FQN and need text updates: `openspec/specs/claude-api-client/spec.md`
  (live spec, states `ClaudeConfig` is "defined in `com.helio.ai`"), `CLAUDE.md` (3 FQN mentions),
  `docs/secrets-inventory.md` (1 FQN mention). `docs/superpowers/specs/2026-09-10-interactive-data-writeback-design.md`
  has one prose mention too — a dated design-history doc, lowest priority of the four, update if convenient
  but not gate-blocking.
- Archived `openspec/changes/archive/**` documents are historical records and are correctly left untouched.

## Goals / Non-Goals

**Goals:**
- Move `com/helio/ai/` → `com/helio/infrastructure/ai/` and `com/helio/email/` → `com/helio/infrastructure/email/`,
  `git mv` + `package` line + every referencing `import`/FQN, main and test.
- Refresh both packages' READMEs (and their new parent-relative content) plus `infrastructure/README.md`'s
  subdirectory enumeration, matching the convention already used by `storage/README.md`/`crypto/README.md`.
- Update the handful of text references to the old FQN in the live spec, `CLAUDE.md`, and `docs/secrets-inventory.md`.

**Non-Goals:**
- No move of `spark/` or `app/` — explicitly out of scope per the owner ruling.
- No behavior/logic/signature/type-name change anywhere. A discovered bug becomes a spinoff ticket, not
  a fix folded into this change (HEL-632's iron constraint).
- No `specs/` delta — see proposal.md Capabilities; this is a pure package relocation with no requirement
  change. `skip_specs: true` is already set in `.openspec.yaml`.

## Decisions

**D1 — Directory move, not a fresh scaffold.** Use `git mv com/helio/ai com/helio/infrastructure/ai` and
`git mv com/helio/email com/helio/infrastructure/email` (main and test trees) rather than creating new
files and deleting old ones, so git history follows the files (same pattern HEL-633/HEL-634 used).

**D2 — Reference sweep is compiler-driven, not just the pre-move grep list, and is NOT limited to
`backend/`.** The grep counts above (25+14 for `ai`, 2+2 for `email`) are the starting point, not the
source of truth — after the moves and package-line edits, run `sbt compile` and `sbt Test/compile` and
fix every reported error, then re-grep for any remaining `com.helio.ai`/`com.helio.email` string literal
or import the compiler wouldn't catch (e.g. a comment, or a string-typed logger name, of which none were
found in the backend). Same two-sided verification principle HEL-633 used for its awk filter
(MISTAKES.md / HEL-633 design.md D6): compiling clean is necessary but not sufficient. Critically,
`sbt compile` only covers `backend/**` — it provides **no safety net at all** for the two non-Scala
reference classes in the Context section above (`frontend/src/features/assistant/types.ts`, three
`schemas/assistant/*.schema.json` files), which are plain-text doc-comment/description mentions with no
compiler to catch a miss. The final completeness gate (tasks.md 5.3) must therefore explicitly re-grep
`frontend/src/**` and `schemas/**` too, not just `backend/src/**` — confirm zero residual
`com.helio.ai`/`com.helio.email` hits everywhere except `openspec/changes/archive/**` and
`docs/superpowers/specs/**` (dated docs, non-blocking).

**D3 — README convention.** Follow `storage/README.md`/`crypto/README.md`'s shape: what the package is,
that it's "not a domain" (structural infrastructure), and an explicit "Does NOT hold" line if relevant.
Verify each README's file list against the actual post-move `ls` output — HEL-632 decision 3's binding
rule, not a copy-paste of the pre-move `ai/README.md`/`email/README.md` content.

**D4 — `infrastructure/README.md` update.** It currently enumerates exactly four subdirectories
(`persistence/`, `storage/`, `crypto/`, `concurrency/`) and states "No file lives directly in
`infrastructure/` — every file is under one of the four subdirectories above." Update to six
subdirectories and keep the "no file lives directly" claim accurate (still true after this move).

**D5 — Non-blocking text references.** `CLAUDE.md` and `docs/secrets-inventory.md` FQN mentions are
plain prose describing where a client lives — update them in the same commit since they're trivial
text edits with zero behavior risk, not because a gate requires it. `docs/superpowers/specs/2026-09-10-interactive-data-writeback-design.md`
is a dated design-history snapshot; update it if the edit is a one-line, zero-risk change, but do not
let it block delivery if time-constrained — flag as a non-blocking follow-up if skipped.

## Gate-Chain Implications Checklist

This change does not touch `.husky/**` or any script a Husky hook invokes — it is a pure Scala
package/import relocation plus README/doc text edits. N/A: no gate-chain script is added, removed, or
modified.

## Risks / Trade-offs

- [Risk] A missed reference compiles under Scala's package-object implicit resolution in one file but
  breaks in a sibling file that relies on the same wildcard import. → Mitigation: D2's compile-then-grep
  loop on both `main` and `test` scopes; do not stop at the first clean `sbt compile`.
- [Risk] A README drifts from actual post-move contents (HEL-632's own recurring finding — see
  `readme-convention-sweep`). → Mitigation: D3's explicit post-move `ls` verification.
- [Risk] Widening scope to "fix" something noticed in `ai/`/`email/` along the way. → Mitigation: HEL-632's
  iron constraint — spinoff ticket, never a same-change fix.

## Migration Plan

Single PR, single squash commit (per this workflow's own delivery convention). No runtime migration —
compile-time package move only, no data/schema/API impact, no rollback complexity beyond `git revert`.
