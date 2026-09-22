## Evaluation Report — Cycle 1 (evaluation-1.md)

### Phase 1: Spec Review — PASS

Issues: none.

- Revised AC (per premise validation) fully addressed: all three schema files exist
  (`schemas/sources/data-source.schema.json`, `schemas/pipelines/node-capabilities-response.schema.json`,
  `schemas/pipelines/expand-pipeline-shape-response.schema.json`), correctly named/relocated per
  design.md Decisions 2 and 4 (ticket's own guessed filenames were corrected, with rationale).
- No AC silently reinterpreted — the renames (`output-capabilities-response` →
  `node-capabilities-response`, relocated from `schemas/outputs/` to `schemas/pipelines/`) are
  explicitly justified against the real case class/route and documented in both ticket.md's
  addendum item 4 and design.md Decision 2.
- All `tasks.md` items ([x]) match what was actually implemented — verified against the diff line
  by line (see Phase 2 for field-level cross-check against the real case classes).
- No scope creep: `git diff --stat` against the resolved base (`f8953a38`) touches only
  `schemas/sources/`, `schemas/pipelines/`, `scripts/check-schema-drift.mjs`, and this change's own
  `openspec/changes/remaining-output-pipeline-schemas/` directory. Confirmed zero diff against
  `openspec/changes/output-routes-api-contracts/` (HEL-906's archived P1.4-owned patch-set files) —
  explicit AC 2.2 satisfied.
- No regressions: zero Scala/TS source changed; independently confirmed via `git diff --name-only`
  (no `backend/**` or `frontend/**` paths).
- API contracts: N/A — these are documentation-only additions for already-shipped shapes; no
  contract changed. `skip_specs: true` is correctly self-approved — no existing capability spec
  (`data-source-persistence`, `pipeline-capabilities-api`, `pipeline-shape-registry`) cross-
  references `schemas/` file paths (confirmed via grep — zero hits), and `inferredSchema`,
  `stepId`/capabilities, and `steps`/`outputs?` are already documented in those specs' prose.
- Planning artifacts reflect final implemented behavior — `files-modified.md` matches the diff
  exactly.
- `workflow-state.md` `CONSTRAINTS: []` — no non-retired constraints to honor.

### Phase 2: Code Review — PASS

Issues: none.

**Gates run fresh (schemas/** and scripts/check-schema-drift.mjs are outside both `frontend/**` and
`backend/**` trigger patterns, so the standard lint/test/build gate set is not triggered; ran the
ticket's own stated verification gates instead, per the task brief):**

- `npm run check:schemas` → exit 0: "schemas in sync with JsonProtocols (100 checked across 50
  protocol files)" — all three new files validate clean, no drift errors.
- `npx openspec validate remaining-output-pipeline-schemas --type change` → "Change
  'remaining-output-pipeline-schemas' is valid".

**Field-level correctness (read the real Scala source directly, not the executor's report):**

- `DataSourceProtocol.scala:29-127` — `DataSourceResponse` sealed trait + 7 subtypes
  (Csv/Rest/Sql/Static/Text/Pdf/Image). Cross-checked every field against
  `schemas/sources/data-source.schema.json`: all 7 variants' `required`/`properties` match exactly
  (shared `id`/`name`/`createdAt`/`updatedAt`/`type`/`inferredSchema` required, `tag: Option[String]`
  correctly NOT required, per-subtype `config` shapes match their `*ConfigPayload` case classes
  field-for-field, `StaticSourceResponse` correctly has no `config` property). Wire discriminator
  values verified against `DataSourceKind` (`DataSource.scala:256-272`): `csv`/`rest_api`/`sql`/
  `dataset`/`text`/`pdf`/`image` — the schema's `StaticSourceResponse.type: {"const": "dataset"}`
  correctly reflects the HEL-1073 canonicalization (not the retired `"static"` literal). The
  `"DataSourceResponse"` SKIP-list entry (`check-schema-drift.mjs:114-115`) mirrors the existing
  `"Panel"` precedent's comment style exactly.
- `PanelCapabilityProtocol.scala:17-49` + `NodeCapabilitiesProtocol.scala:15-23` — cross-checked
  `schemas/pipelines/node-capabilities-response.schema.json` field-for-field: `stepId: Option[String]`
  correctly absent from `required`/no `null` in type; `columns`/`capabilities` correctly required;
  inlined `PanelCapabilityColumnResponse`/`PanelCapabilityResponse` defs match the real case classes
  including `reason`/`message` (both `Option[String]`, correctly optional) and `eligibleColumns`
  (type-aliased `Map[String, Vector[String]]`, correctly modeled as
  `additionalProperties: {type: array, items: string}`).
- `PipelineShapeProtocol.scala:66-93` — cross-checked
  `schemas/pipelines/expand-pipeline-shape-response.schema.json`: `steps` required, `outputs:
  Option[JsArray]` correctly modeled as **absent from `required`, type `"array"`, no `null` in the
  type union** — this was the ticket's own explicit correctness call-out (addendum 2) and is
  correctly implemented. Confirmed the underlying spray-json convention independently: grepped the
  whole backend for `NullOptions` (zero hits) — this protocol has no `NullOptions` mixin anywhere,
  so a Scala `None` always serializes as an absent key, never `null`, corroborating the schema's
  claim rather than just trusting it. `ShapeStepExpansionResponse`'s `parentStepId: Option[String]`
  is likewise correctly absent-optional.
- Directory placement/naming (`schemas/pipelines/node-capabilities-response.schema.json`,
  `schemas/pipelines/expand-pipeline-shape-response.schema.json`) matches the existing kebab-case
  convention and correct subdirectory for both files (verified against the full existing
  `schemas/pipelines/` and `schemas/outputs/` listings).
- DRY / no duplication: `PanelCapabilityColumnResponse`/`PanelCapabilityResponse` are correctly
  inlined into `node-capabilities-response.schema.json` rather than split into their own referenced
  files, per design.md Decision 3 — matches this repo's existing convention of only creating a
  schema file for what's actually gapped.
- No dead code, no TODO/FIXME in any of the three new files or the `check-schema-drift.mjs` diff.
- CONTRIBUTING.md's "Keep schema changes in the same PR as the code that uses them" — satisfied in
  spirit: the code already exists and is already tested on `main`; this change documents it
  retroactively, which is the ticket's explicit and reviewed premise (not a violation — there is no
  new code path introduced without a matching schema).
- Commit messages are HEL-933-prefixed, properly attributed, and the second commit
  (33adcc7e) honestly discloses a straggler-checkbox fixup rather than silently folding it in.

### Phase 3: UI Review — PASS (verified despite literal `schemas/**` trigger match; see note)

Issues: none.

Note on scope: `schemas/**` is one of Phase 3's literal triggers, so this phase was run rather than
marked N/A, even though the task brief asserted "no UI review is needed." That assertion was
independently verified, not trusted at face value: `grep -rln "schemas/" frontend/src` shows the
`schemas/` tree is referenced only in **TypeScript code comments** documenting the mirrored shape
(e.g. `frontend/src/features/pipelines/types/pipelineSchedule.ts:3`), never imported or bundled —
these three new schema files have no frontend build/runtime dependency at all, and `git diff
--name-only` confirms zero `frontend/**` or `backend/src/main/scala/routes/ApiRoutes.scala` files
changed. Ran a smoke check anyway given the literal trigger:

- Started dev servers via the canonical script (`start-servers.sh` / `assert-phase.sh servers` →
  both `PASS`/`READY`).
- Loaded `/` (Dashboards) and `/sources` (Data Sources — the page backed by
  `GET /api/data-sources`, the exact endpoint whose response shape this ticket newly documents):
  both rendered correctly, zero console errors or warnings.
- Network requests: `GET /api/data-sources` (×4), `GET /api/pipelines`, `GET /api/dashboards`,
  `GET /api/auth/me` — all `200 OK`, no 4xx/5xx.
- No behavior to exercise beyond this — there is no new UI surface, loading/empty/error state, or
  entry point introduced by this change; the empty-state Data Sources page rendering correctly is
  the full extent of what's observable here.

### Overall: PASS

### Change Requests
(none)

### Non-blocking Suggestions
(none)
