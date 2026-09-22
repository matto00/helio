# HEL-933: P1.3b — Remaining Output/pipeline route surface: inferredSchema, decision-15 layout, config.format, remaining schemas

## Description

Split off HEL-906 (P1.3 — API + contracts: Output routes, single-call create_pipeline, capabilities-at-node, assertion status; delete the panel query route) after 7 execution cycles. HEL-906 shipped the full Output CRUD surface, single-call transactional `create_pipeline`, per-node schema projection + capabilities-at-node, the structural AC-3 field-type fixes, `GET /api/outputs/:id/rows`, `POST /api/pipelines/:id/preview`, `validate-expression`, `parentStepId` on the steps route, the `pipeline-shapes/:id/expand` breaking envelope change, and lean pagination for `/api/outputs`. These four items ran out of cycle budget and are genuinely carried, not dropped — see HEL-906's `design.md` (D13) and `tasks.md` in the `output-routes-api-contracts` change directory (archived under HEL-906) for full context.

**PREMISE VALIDATION (2026-09-22, see `.concertino/runs/HEL-933/evidence/premise-validation.md` for full evidence):** this ticket was written 2026-09-01 and has not been touched since. Roughly three weeks of subsequent work (HEL-907–914 incl. multi-root pipelines HEL-913, HEL-969, the v0.8 dataset/write-back work, form panels HEL-1082–1090) has shipped several of these items already, in some cases under a different design than originally scoped. Per-item classification:

1. `inferredSchema` on `DataSourceResponse` — **ALREADY SHIPPED** (field exposed on `GET /api/data-sources` list, `POST /api/data-sources` create, and `PATCH /api/data-sources/:id` update responses). **Correction (post-delivery auditor finding):** the ticket's own AC text names `GET /api/data-sources/:id` as one of the carrying routes — that bare route does not exist (`DataSourceRoutes.scala` wires only `patch`/`delete` at `DataSourceIdSegment`; every GET under a source id is scoped to a subpath — `/preview`, `/rows`, `/schema` — none of which returns `DataSourceResponse`). The originally-filed AC's route list was itself inaccurate; only list/create/update genuinely carry this field. Only `schemas/sources/data-source.schema.json` is missing — **still needed**.
2. Decision-15 server-owned default layout on `POST /api/panels` — **ALREADY SHIPPED**, correctly scoped to Output-kind panels only (per the epic design doc, content/form panels use a separate "row at the bottom" placement, not decision-15). No work needed.
3. Output `config.format` round-trip (HEL-876) — **ALREADY SHIPPED** under a simpler design (a `MetricFormat` enum, shipped in HEL-909) that already satisfies this ticket's literal AC. No work needed.
4. `schemas/outputs/output-capabilities-response.schema.json` — **STILL NEEDED**, but the actual response type is `NodeCapabilitiesResponse` (`GET /api/pipelines/:id/capabilities`); will be added as `schemas/pipelines/node-capabilities-response.schema.json`.
5. Inline-source variant of `POST /api/pipelines` (Addendum 1) — **ALREADY SHIPPED**, subsumed by HEL-913's `roots[]` model exactly as this ticket's own addendum predicted. The `pipeline-create-api` spec already correctly documents the shipped shape. No work needed.
6. `schemas/pipelines/expand-pipeline-shape-response.schema.json` (Addendum 2) — **STILL NEEDED**. The `{steps, outputs?}` envelope is already correctly implemented (`outputs` is `Option`, absent-not-null); only the schema file is missing.

**Narrowed scope for this delivery:** add three missing JSON Schema files (`schemas/sources/data-source.schema.json`, `schemas/pipelines/node-capabilities-response.schema.json`, `schemas/pipelines/expand-pipeline-shape-response.schema.json`) documenting already-shipped response shapes, verify `check:schemas`/`openspec validate` stay green, and update any capability specs whose documented contract is currently silent on these fields.

## Original acceptance criteria (ticket as filed)

- [ ] `GET/POST /api/data-sources` and `GET /api/data-sources/:id` responses include `inferredSchema`; `schemas/sources/data-source.schema.json` exists and is checked by `check:schemas`.
- [ ] `POST /api/panels` computes and persists a decision-15 default layout item in the same transaction as the panel insert; request body has no `layout` field.
- [ ] `PATCH /api/outputs/:id` round-trips `config.format` for `metric` and `baseType: metric` `collection` Outputs.
- [ ] `output-capabilities-response.schema.json` exists and validates the route's actual response shape.
- [ ] `check-schema-drift.mjs` green with proposal/patch-set files (P1.4-owned) untouched.
- [ ] `openspec validate` clean; every affected capability spec updated.
- [ ] (Addendum 1) `POST /api/pipelines` accepts an inline source spec (in addition to `sourceDataSourceId`), builds the DataSource + pipeline transactionally.
- [ ] (Addendum 2) Add `schemas/pipelines/expand-pipeline-shape-response.schema.json` (or similarly named) covering `{ steps: [...], outputs?: [...] }`, with `outputs` correctly modeled as an optional/absent key (not nullable).

## Revised acceptance criteria (this delivery, per premise validation above)

- [ ] `schemas/sources/data-source.schema.json` exists, documents the `DataSourceResponse` union's `inferredSchema` field (and other shared/per-subtype fields), and is checked by `check:schemas` (or is deliberately SKIP-listed there, matching the `Panel` precedent, if it documents a polymorphic union).
- [ ] `schemas/pipelines/node-capabilities-response.schema.json` exists and validates `NodeCapabilitiesResponse`, the actual response shape of `GET /api/pipelines/:id/capabilities`.
- [ ] `schemas/pipelines/expand-pipeline-shape-response.schema.json` exists and validates `ExpandPipelineShapeResponse` (`{ steps: [...], outputs?: [...] }`), matching `POST /api/pipeline-shapes/:id/expand`'s actual response shape.
- [ ] `check-schema-drift.mjs` (`npm run check:schemas`) green.
- [ ] `openspec validate` clean; any capability spec whose documented contract is silent on these already-shipped fields is updated to reflect them.
