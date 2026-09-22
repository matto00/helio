## Why

HEL-633 domained every backend layer except four top-level packages left outside `infrastructure/` on
purpose. The owner has now ruled (2026-09-22 Linear comment on HEL-802): `ai/` and `email/` are both
outbound third-party HTTP integrations, the same kind of concern as `infrastructure/storage/`, and
should move alongside it. `spark/` and `app/` stay exactly where they are — not in scope, not to be
re-litigated.

## What Changes

- `git mv` `com/helio/ai/` (11 `.scala` files + README) → `com/helio/infrastructure/ai/`; `git mv`
  `com/helio/email/` (3 `.scala` files + README) → `com/helio/infrastructure/email/`. Same moves for
  each package's test tree (`src/test/scala/com/helio/ai/` → `.../infrastructure/ai/`, same for
  `email/`).
- Update `package` declarations in every moved file and every `import`/FQN reference across
  `backend/src/main/scala/**` and `backend/src/test/scala/**` (25 main files, 14 test files reference
  `com.helio.ai`; 2 main files, 2 test files reference `com.helio.email` — see design.md's Context
  section, re-verified against the live tree in skeptic-design-1.md round 1).
- Update two doc-comment mentions in `frontend/src/features/assistant/types.ts` and three
  `description` fields across `schemas/assistant/*.schema.json` that reference `com.helio.ai` by FQN
  (found by skeptic-design-1.md; not covered by `sbt compile`, since neither is Scala).
- Write/refresh `infrastructure/ai/README.md` and `infrastructure/email/README.md` against their real
  post-move contents; update `infrastructure/README.md`'s subdirectory enumeration.
- Update the FQN mentions in the live spec `openspec/specs/claude-api-client/spec.md`, `CLAUDE.md`, and
  `docs/secrets-inventory.md`.
- `com/helio/spark/`, `com/helio/app/`, and `backend/build.sbt`'s `mainClass` settings are untouched.

## Capabilities

- **New Capabilities**: none.
- **Modified Capabilities**: none. This change alters no requirement, endpoint, or wire shape — it is a
  pure package relocation. Same established precedent as HEL-633/HEL-634/HEL-811 (structural-refactor
  changes with no `specs/` directory, archived with `--skip-specs`). `openspec validate` will report
  "Change must have at least one delta" — expected, not a defect.

## Non-goals

- No behaviour, logic, signature, or type-name changes. A discovered bug becomes a spinoff ticket.
- No move of `spark/` or `app/` — out of scope per the owner ruling.
- No file splitting or other unrelated refactor of the moved files.

## Impact

Affects `backend/src/main/scala/com/helio/ai/**`, `backend/src/main/scala/com/helio/email/**`, and
every file across `backend/src/{main,test}/scala/**` that imports either package (see proposal +
premise-validation evidence). No API/wire-shape impact — internal package structure only.
