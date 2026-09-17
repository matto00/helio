# HEL-1083: `form` PanelKind: registration, config schema, and PanelType

## Description

Register `form` in `Panel.Registry`. `PanelKind.All` is registry-derived, so registration
is the only enumeration to change — but `PanelType.fromString` **does** enumerate manually
and needs the new case.

Config carries the bound `dataSourceId`, the field list, and the submit behaviour.

Parent epic: **HEL-1082 — Form panel (with input/counter as its canonical single-field form)**.
A panel that *writes*: field-type builder, render-on-panel, submit appends a row to a bound
`dataset` source. Two epic constraints bind this ticket:

- A `form` panel **binds to a source, not an Output** — the second kind after `divider`
  that needs no Output binding.
- `PanelType.Default` (currently `Divider`) must be **untouched**.
- The input/counter panel is a *configuration* of this kind, not a sibling kind. Not built
  here, but not foreclosed.

Design spec: `docs/superpowers/specs/2026-09-10-interactive-data-writeback-design.md` (PR #627), §2.

## Acceptance criteria

- A `form` panel round-trips through `POST /api/panels`.
- A `form` panel round-trips through the dashboard export/import path
  (`GET /api/dashboards/:id/export` → `POST /api/dashboards/import`), preserving its
  `dataSourceId`, field list, and submit behaviour.

## Scope boundary (do not build here)

Field-type builder UI is HEL-1084. Field renderers are HEL-1085. File field is HEL-1086.
Submit path is HEL-1087. Counter chrome is HEL-1088/1089. The a11y audit is HEL-1090.
This ticket is registration, config schema, `PanelType`, and round-trip only. A finding one
of those tickets must know is reported, not implemented.

## Orchestrator corrections, verified against the tree at Setup

The ticket's own file citations are stale and its central claim is false. Full evidence and
probe hygiene (including positive controls for every zero-hit grep) is persisted at
`.concertino/runs/HEL-1083/evidence/premise-validation.md`. Summary of what binds this run:

- **"Registration is the only enumeration to change" is REFUTED.** ~22 enumeration sites
  across four layers must change. `PanelKind.All` being registry-derived is true, but governs
  only `parseKind` — it does not reach `PanelType`, `PanelConfigCodec`, persistence, the JSON
  schemas, or the frontend.
- `Panel.Registry` is at `backend/src/main/scala/com/helio/domain/model/Panel.scala:87`
  (NOT `Panel.scala:109`, and `domain/panels/Panel.scala` does not exist).
- `PanelType.fromString` is at `model.scala:151`, and **`PanelType.asString` (`:160`)
  enumerates manually too** — omitted by the ticket.
- **A Flyway migration is REQUIRED and unmentioned anywhere.** `panels_kind_check`
  (`V94__outputs_model.sql:365`) is `CHECK (kind IS NULL OR kind IN ('output','text',
  'markdown','image','divider'))` with `kind` later `SET NOT NULL`. A `form` panel cannot be
  INSERTed at all until a new migration widens it. The round-trip AC is unreachable without
  it. Next free version is **V108**.
- **`panels` has no `config` JSONB column** — config is one typed nullable column per field.
  The form config's persistence shape is therefore a real decision, not a mechanical addition.
- **`PanelRowMapper.rowToDomain` falls through to `OutputPanel` on an unrecognized kind**
  (`case _ =>`). A `form` row omitted there decodes silently as an `OutputPanel` instead of
  failing. Any registration test must be proven by mutation to fail without the registration.
- **`configColumnsOf`/`configColumnValuesOf`** (`PanelRepository.scala`) are the documented
  single source of truth for config columns. HEL-296/HEL-909 precedent: a column added to
  `PanelRow` but not folded into these tuples makes every write silently preserve the OLD
  value while returning the new one in the response body.
- Adding `form` to `PanelType.fromString` automatically propagates it into the agent-facing
  surfaces via `check-schema-drift.mjs`'s `agentFacingPanelTypes` (canonical minus `divider`),
  which will fail `npm run check:schemas` unless `form` is either added to the proposal
  surfaces or carved out alongside `divider`. The proposal wire carries no `dataSourceId`.

## Environment facts verified at Setup

- Installed `lucide-react` is **1.40.0**; the lockfile pins **1.43.0**. This is the HEL-830
  stale-`node_modules` trap (MISTAKES.md). A frontend gate failure naming a lucide export is
  an environment artifact, not a code defect — measure before "fixing" it. This change should
  not touch lucide imports at all.
- Every worktree shares one Postgres database, and RLS never runs in dev or CI (superuser
  bypass). A migration in this change is visible to every other lane's dev server.
