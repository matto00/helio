## Why

A new user with no file of their own has nothing to drop on the first-run surface (HEL-1209). Persona sample-data templates (streamer, founder, ops, finance) let them see a full, real, materialized dashboard in one click. Owner ruling: these are sample-data templates expanding the early `DemoData` seed concept, available on every tier, with no Claude call. HEL-1218 (empty `RolledUpTemplateSlugs`) is folded in.

## What Changes

- Four code-level persona templates, each with a bundled, synthetic, provenance-noted CSV classpath resource, an explicit pipeline spec (typed via `cast`), explicit chart types/column order, and an explicit desktop+mobile-safe layout.
- New `POST /api/first-run/template` (authenticated, ownership-scoped, NOT tier-gated): creates a per-user sample CSV source ("Sample: <Persona> ..."), then applies the pipeline (which runs it) and dashboard through the SAME `FirstRunDashboardService` apply path as HEL-1209, extended to accept a template spec instead of the rule planner. One apply path.
- Persona chips on the empty-workspace first-run surface, keyboard-operable and labelled, progress/errors announced; emits `firstrun_template_chosen` via `track()` with `template` = slug.
- `RolledUpTemplateSlugs` populated with the four slugs (closes HEL-1218); client wire-contract fixture and seam test cover the template event variant.
- CI validation of every bundled dataset (header schema + row count + size cap).
- `DemoData` fate: retired (see design.md).

## Capabilities

### New Capabilities
- `persona-templates`: bundled persona sample datasets, template registry, per-user instantiation endpoint.

### Modified Capabilities
- `first-run-onboarding`: persona chips on the first-run surface.
- `product-telemetry`: template slugs rolled up under their own slug.

## Impact

Backend: `services/firstrun`, `api/routes/firstrun`, `app/DemoData.scala`/`Main.scala`, `ProductEventRegistry`, new classpath resources. Frontend: `features/onboarding`, telemetry wire fixture. No migration expected.
