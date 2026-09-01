## Skeptic Report — final gate, wire-contract dimension (round 2, skeptic-final-4-wire-contract-round2.md)

Note on filename: `next-report-number.sh` returned `number=1`
(`skeptic-final-1.md`) because this run's reports use a dimension-suffixed
naming scheme (`skeptic-final-4-wire-contract.md`) the script's prefix scan
does not recognize; `skeptic-final-1-mcp-tools.md` already exists, so the
suggested name would itself have been a near-collision. I wrote to the
orchestrator-specified `skeptic-final-4-wire-contract-round2.md`, which did
not exist (verified by `ls` before writing) — collision-safe by inspection,
not by guessing a numeric fallback.

### What I verified (with evidence)

1. **Round-1 REFUTE is fixed, and fixed properly (not a stub).**
   `schemas/dashboards/dashboard.schema.json:30-35` now carries
   `tag: {type: string, minLength: 1, maxLength: 200, description: ...}`.
   Cross-checked against ground truth on all four tiers:
   - `DashboardProtocol.scala:27-38` — `DashboardResponse.tag: Option[String] = None`,
     `jsonFormat7`. Field list is exactly `{id,name,meta,appearance,layout,ownerId,tag}`,
     matching the schema's `properties` set exactly under `additionalProperties: false`.
   - `RequestValidation.scala:110-115` — `MaxTagLength = 200`, so the schema's
     `maxLength: 200` matches the enforced server-side bound, which in turn mirrors
     `V95__dashboard_tag.sql:9`'s `CHECK (length(tag) <= 200)`.
   - `create-dashboard-request.schema.json:16-21` — request side carries the same
     `tag` bounds, and `CreateDashboardRequest` is `jsonFormat3`.
   - Persistence round-trip is complete, not write-only: `DashboardRepository`
     adds `def tag = column[Option[String]]("tag")`, includes it in `*`, and maps it
     both directions (`row.tag -> Dashboard.tag`, `d.tag -> DashboardRow.tag`). The
     Slick `Tag` shadowing hazard was handled correctly (`DashboardTable(slickTag: Tag)`).

2. **Drift gate is green on the fixed tree.** `node scripts/check-schema-drift.mjs`:
   `schemas in sync with JsonProtocols (73 checked across 48 protocol files)` +
   `panel-type enums in sync (7 surfaces)`. (Note this gate still cannot have caught
   finding 1 — `Dashboard` remains in the SKIP set; the fix was made by hand. That
   blind spot is HEL-928's scope, not this ticket's.)

3. **SKIP-set sweep (the round-2 assignment).** SKIP set is
   `{Dashboard, Panel, PanelQuery, PaginatedQueryResult, ResourceMeta, DashboardLayout,
   DashboardLayoutItem, DashboardAppearance, PanelAppearance, PanelAppearancePatch}`
   (`check-schema-drift.mjs:90-103`). Cross-referenced against the full
   `git diff --name-only main...HEAD` list:
   - `Dashboard` — the one touched SKIP title; now fixed and hand-verified above.
   - `Panel`, `PanelAppearance`, `PanelAppearancePatch`, `DashboardLayout*`,
     `DashboardAppearance` — **no protocol file for any of these is in the diff**
     (`api/protocols/panels/**` untouched; `DashboardProtocol`'s only changes are
     `DashboardResponse.tag` and `CreateDashboardRequest.tag`, verified line-by-line —
     the layout/appearance case classes are byte-identical to `main`).
   - `PanelQuery` — deleted outright in HEL-904, not touched here.
   - `ResourceMeta`, `PaginatedQueryResult` — untouched.
   No second SKIP-set-masked drift exists on this diff.

4. **Ungated *nested* schema surfaces (the same blind-spot class, one level down).**
   The drift check only diffs a schema's TOP-LEVEL `properties` against the case class,
   so `$defs` are invisible to it. Hand-checked every nested shape this ticket touched:
   - `pipeline-proposal.schema.json` top-level `{pipelineName, source, steps, outputs}`
     vs `PipelineProposal` (`PipelineProposalProtocol.scala:114-119`) — exact match,
     including `outputs` being optional in both (`= Vector.empty` / absent from `required`).
     `steps`/`outputs` `$ref` the transactional step/output request schemas rather than
     redeclaring them, so no duplicate shape to drift.
   - `patch-set.schema.json` `$defs.EditTarget.kind` enum now
     `[panel, dashboard, dataSource, pipeline, pipelineStep, output]`, exactly matching
     `PatchSetProtocol.scala`'s `recognizedKinds` set. `Edit.outputPatch` is decode-side
     only (the wire field is `patch`), so its addition is correctly NOT a schema property.
   - `workspace-teardown-response.schema.json` — `dashboardsDeleted` added to both
     `properties` and `required`; `TeardownResponse` is `jsonFormat8` with an `Int`
     (always serialized, never omitted), so `required` is correct.
   - `pipeline-analyze-proposal-response.schema.json` — `outputDataTypeName` removed
     from both `properties` and `required`, matching `jsonFormat3`.

5. **TS/MCP mirrors of every changed backend response.** This is the exact class that
   produced the stale `typesDeleted` finding, so I re-swept it:
   - `helio-mcp/src/types.ts:636-652` `TeardownResponse` — 8 fields, field-for-field
     identical to the Scala `TeardownResponse`; the stale `typesDeleted` is gone.
   - `ProposalOutputSummary` (`types.ts:752-757`) and `PipelineProposalApplyResponse`
     (`types.ts:767-772`) — match the Scala definitions exactly, `source` correctly
     optional (spray omits `None`), `nodeStepId` correctly `?: string | null`.
   - `CombinedProposalApplyResponse` nests both verbatim; backend
     `CombinedProposalProtocol.scala` is not in the diff, so nothing to drift against.
   - `DashboardResponse.tag?: string | null` present (`types.ts:48-51`), and
     `write.ts:70` exposes `tag: z.string().min(1).max(200).optional()` on the
     create-dashboard tool — bounds match the schema and `MaxTagLength` exactly.

6. **Optional-field reading discipline re-checked (round-1 finding class).**
   `grep -rn '=== null\|!== null' helio-mcp/src` (non-test) returns only
   `httpClient.ts:220` (a header, genuinely nullable) and a doc comment saying
   "never `=== null`". No wire optional is read with `=== null`.

7. **`WorkspaceContextComputations` extraction is wire-neutral.** Claimed to be a
   mechanical move. Verified rather than trusted: concatenated the new pair of files,
   stripped comments/blank lines, normalized indentation, sorted, and diffed against
   `main`'s single file. The only differences are the trait/class scaffolding, relocated
   imports, and three members widened `private` -> `protected`
   (`contentFieldNames`, `overflowStructuredFieldNames`, `SampleColumnLimit`).
   Zero logic or constant changes — so no computed wire value can have shifted.

8. **HEL-928 comment.** `mcp__linear__get_issue` returns the issue body but not its
   comment thread, so I could not read the posted comment's text directly; `updatedAt`
   (2026-09-01T15:27) is consistent with a comment having been added today. The issue's
   own body already describes exactly this "hardcoded surface list / no structural
   discovery" gap class, so a second instance recorded against it is coherent. Non-gating
   either way, as the orchestrator noted — the code fix is the gating concern and it is
   verified above.

### Verdict: CONFIRM

The round-1 REFUTE is genuinely resolved at all four tiers (schema, protocol, validation,
persistence), not papered over. The targeted second-instance sweep for other SKIP-set and
nested-`$defs` blind spots found nothing on this diff. The wire-contract dimension ships.

### Non-blocking notes

1. `RequestValidation.validateTag` enforces only the upper bound, so a request with
   `tag: ""` is accepted and would round-trip as `tag: ""` in `DashboardResponse` —
   which violates the new `minLength: 1` in both `dashboard.schema.json` and
   `create-dashboard-request.schema.json`. Purely theoretical today (the schemas are
   contract docs, not runtime validators, and the MCP tool's zod schema already enforces
   `.min(1)`), and it is pre-existing behavior shared with every other `tag`-carrying
   resource — but a blank-tag normalization (`filter(_.nonEmpty)`) in `validateTag` would
   close it for all of them at once.
2. Two pre-existing test/e2e fixtures still send the long-removed `outputDataTypeName`
   on `POST /api/pipelines` (`e2e/hel666-single-assistant-entry.spec.ts:106`,
   `backend/.../PipelineAclSpec.scala:348,360`). Harmless — spray's `jsonFormatN` reader
   ignores unknown keys — and the field was removed from `CreatePipelineRequest` on
   `main`, not by this ticket, so it is not this ticket's regression. Worth a cleanup
   sweep whenever `create-pipeline-request.schema.json`'s `additionalProperties: false`
   is ever enforced at runtime.
