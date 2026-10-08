## Why

`Panel.scala` tells every reader that adding a panel kind "only requires updating `Panel.Registry`". That is false: the
registry feeds `PanelKind.All`/`parseKind`/`companionFor` only, and HEL-1083 had to hand-edit ~22 sites plus a
`panels_kind_check` migration to add `form`. This comment is where the v0.8 spec's false premise (fixed by HEL-1150)
came from; left in place it will seed the next ticket or spec written from the code.

## What Changes

- Rewrite the `PanelKind.All` scaladoc: the registry is the source of truth for `parseKind` and `All` only; name the
  hand-enumerated layers, the migration, the spec's "Drift surface for a new panel kind" paragraph (§2 of
  `docs/superpowers/specs/2026-09-10-interactive-data-writeback-design.md`), a re-derive command, and which gates do
  and do not fire.
- Rewrite the `Panel.Registry` scaladoc, which repeats the overclaim ("every protocol / repo / service / snapshot
  dispatcher derives from this Map"; "adding one line here").
- Correct the same overclaim in the file-header scaladoc of `trait Panel` ("only kinds registered there round-trip
  through the protocol / repo / service"; "`PanelRepository.rowToDomain` dispatches ... via the registry").
- No code change; comment lines only.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

(none — comment-only; `.openspec.yaml` sets `skip_specs: true`)

## Non-goals

- Fixing any hand-enumerated site or adding a new gate (e.g. a test that a new kind reaches every site).
- The identical overclaim in `PipelineStep.scala`'s `PipelineStepKind.All` scaladoc — a different registry; listed as a
  follow-up.
- `PanelSpec`'s test name "be the single source of truth for all 6 panel kinds" — test code, out of AC3's file scope.
- Other possibly stale text in `Panel.scala`'s header (the "Wire shape (cycle 1, unchanged)" paragraph) — not the
  registry overclaim; not touched.
- Updating the spec's drift-surface list (it is explicitly a dated snapshot; the comment tells readers to re-derive).

## Impact

- `backend/src/main/scala/com/helio/domain/model/Panel.scala` (scaladoc comments only)
