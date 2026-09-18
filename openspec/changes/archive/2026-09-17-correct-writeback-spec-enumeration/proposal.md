## Why

`docs/superpowers/specs/2026-09-10-interactive-data-writeback-design.md` §2 tells every remaining HEL-1082 leaf
(HEL-1085–1090) that registering a panel kind in `Panel.Registry` is "the only enumeration to change", cites two
line anchors that no longer resolve (`Panel.scala:109`, `model.scala:141`), and omits the `panels_kind_check`
CHECK-constraint migration entirely. HEL-1083 delivered against that text and had to touch ~22 sites across four
layers plus a migration (V108); it spent four design-gate rounds partly on sites the spec said would not exist.
Correct the source document now, before the next leaf reads it.

## What Changes

- Rewrite §2's enumeration sentence **in place** (MISTAKES.md: corrections replace decision text, never accumulate
  beneath it) so it states the real drift surface: registration is one of several hand-enumerated sites across
  backend model/codec/persistence/service, JSON schemas, `helio-mcp`, and the frontend.
- Replace both line-number anchors with **symbol anchors** (`Panel.Registry`, `PanelType.Default`) plus the file's
  directory, which survive line insertions; drop every other bare `:NNN` that §2 introduces.
- State the migration requirement: `panels_kind_check` is a closed-set CHECK constraint, so a new kind cannot be
  INSERTed until a drop/re-add migration widens it (V108 precedent).
- Add a short "drift surface for a new panel kind" subsection: the layers a new kind touches, the silent-degradation
  sites named by symbol (`PanelRowMapper.rowToDomain`'s `case _ => OutputPanel`, `PanelRepository.configColumnsOf`/
  `configColumnValuesOf`, `PanelContent.tsx`'s two if-chains on two vocabularies, `PanelDetailModal.tsx`'s two
  if-chains), the gates that do fire (`PanelSpec` registry parity, `check-schema-drift.mjs`), and an explicit
  instruction to **re-derive the surface from the tree** with a concrete recipe, because any prose list rots.
- Correct §2's collateral false claim that `form` is "the second panel kind after `divider`" with no Output binding
  (`text`/`markdown`/`image` bind no Output either), found during premise validation.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

None — this change edits a design document only; no runtime behavior, contract, or spec requirement changes.
`.openspec.yaml` sets `skip_specs: true`.

## Non-goals

- No code, schema, migration, or `frontend/` change of any kind (the HEL-1085 lane owns `frontend/` concurrently).
- No edit to the HEL-1082 epic's Linear text or to any leaf ticket — those are Linear artifacts, not repo files.
- No attempt to make the prose list exhaustive forever: the durable content is the pointer + re-derive recipe;
  the enumerated snapshot is dated and explicitly labelled as such.
- No rewrite of sections other than §2 (and the one collateral sentence inside §2).

## Impact

- `docs/superpowers/specs/2026-09-10-interactive-data-writeback-design.md` §2 only.
- Readers: HEL-1085, HEL-1086, HEL-1087, HEL-1088, HEL-1089, HEL-1090 lanes and any future kind-adding ticket.
- Gates: Prettier formats `docs/` markdown (not in `.prettierignore`); the pre-commit chain runs in full even for a
  docs-only diff.
