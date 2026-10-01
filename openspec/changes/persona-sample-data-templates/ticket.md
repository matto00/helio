# HEL-1210: Persona sample-data templates (streamer / founder / ops / finance), expanding the DemoData seed concept

## Description

Leaf 5 of HEL-916. Owner ruling: persona templates are sample-data templates with bundled sample data, per-user instantiation (pipeline is run, panels render real data), persona chips on the first-run surface emitting `firstrun_template_chosen`, state DemoData's fate. Available to all tiers, no Claude call. Fold in HEL-1218 (populate RolledUpTemplateSlugs). Reuse HEL-1209's builder/apply path.

## Acceptance criteria

- On a fresh free-tier account, each persona chip produces a rendered dashboard with real data in <= 5 interactions, verified live for all four in both themes and at phone width.
- Instantiated resources fully owned by the user: editable/deletable, no system-user residue, no cross-user sharing. Tested.
- Sample data files validated in CI (schema and row count).
- RolledUpTemplateSlugs populated; telemetry proven live (row in product_events, rollup under slug); wire-contract fixture/seam test covers the template event.
- DemoData fate stated explicitly.
- Out of scope: gallery, user-authored/shared/import templates (HEL-421).

## Standing constraints (driver)

Mobile layout verified at phone width; explicit column order/chart types in specs (HEL-1222 not fixed globally); no migration without telling the driver (V114 next free).
