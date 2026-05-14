# HEL-236 — Codebase refactor — modularity, DRY, and structural restructure

**Change Set 2c of 6** (CS1 ✅ merged; CS2a ✅ merged; CS2b ✅ merged; **CS2c domain ADTs + wire shape evolution ← this**; CS3 frontend structure; CS4 frontend decomposition)

## CS2c scope (this change)

**Domain-modelling move.** Replace the wide-nullable `Panel`, `DataSource`, and `PipelineStep` case classes with sealed-trait ADTs containing strict per-type subtypes. Polymorphic methods dispatch via subtype rather than enum-switching. **The wire shape evolves alongside** — JSON becomes a discriminated union and the frontend updates in the same PR.

This is the **second of two architectural moves** in HEL-236:
- **CS2b (merged)** — service-layer extraction; wire shape byte-identical
- **CS2c (this PR)** — domain ADT remodel + wire shape evolves; frontend types update in lockstep

Bundled in CS2c because each item naturally touches the same code paths the ADT remodel forces us through:
- `InProcessPipelineEngine.scala` split (459 lines → dispatcher + per-op executors)
- `PipelineRunRoutes.scala` decomp (377 lines → thin route + service helpers, matching CS2b shape)
- `DataSourceRepository.rowToDomain` alignment with the ADT discriminator unpacking pattern the other repos already use
- Inner-vs-left-join policy codified (HEL-200 surfaced this; one rule, documented)
- Pipeline repos accept value-class IDs (`PipelineId`, `PipelineStepId`, `PipelineRunId`)
- Add `PipelineStepIdSegment` to `IdParsing.scala`; introduce `PipelineRunId` value class + segment

## Acceptance

- All three domain ADTs land (`Panel`, `DataSource`, `PipelineStep`) with strict per-type subtypes
- Polymorphic methods (`render`, `evaluate`, `validateConfig`, etc.) dispatch via subtype, not enum switching
- Wire shape is a discriminated union with a `type` discriminator; each subtype emits only its own fields
- Frontend `Panel` / `DataSource` / `PipelineStep` types become discriminated unions; all consumers (Redux slices, panel renderers, panel detail modal, panel creation modal, source editors, step editors) update in lockstep
- `InProcessPipelineEngine.scala` ≤ 250 lines after split (dispatcher only); per-op executors live in their own files
- `PipelineRunRoutes.scala` ≤ 150 lines; run lifecycle moves into `PipelineRunService`
- DB table shape unchanged — discriminator lives in existing `panels.type` / `data_sources.source_type` / `pipeline_steps.op` columns; ADT layer hides the row shape on read
- `sbt test` (full suite) + frontend `npm test` + lint + format + schema + pre-commit hook all green
- Pre-commit Playwright smoke pass on the eight-step flow (see design.md)

## Out of scope

- **Frontend structure (CS3) and decomposition (CS4)** — separate PRs. CS2c updates the frontend code that consumes the evolved wire shape; it does NOT move files into feature folders or split god components.
- **ACL pushdown to repo/SQL layer (HEL-265)** — explicit follow-up.
- **HEL-242 P0** — verify the polymorphic Panel fixes it post-hoc; do NOT directly target.
- **HEL-256 P0** — parallel side-PR off main, not in CS2c (may surface but isn't the focus).
- **New endpoints or new fields beyond what ADT discrimination requires.** Wire shape evolves _because of_ the ADT; no opportunistic additions.
- **Per-subtype DB tables** — keep one `panels` table with `type` discriminator (user-locked decision). No Flyway migration needed.

## Standards binding

`CONTRIBUTING.md` is binding — _Imports & Qualifiers_ rule (no inline FQNs; pre-commit hook blocks) + file-size budgets. Refactor discipline: behavior-preserving; trivial bugs fix inline, non-trivial bugs become spinoff candidates. The *AI Collaborators* section spells out the agent-specific rules.

**Coordinated cross-tier change.** Backend AND frontend update in the same PR. If a backend ADT change ships without a frontend counterpart, the PR is incomplete.
