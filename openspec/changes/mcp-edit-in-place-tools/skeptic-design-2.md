## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence)

**Round-1 Change Request 1 (D3 vs tasks.md 4.1/4.2 contradiction) — re-verified as resolved:**

- Read the actual precedent files in full: `helio-mcp/src/tools/metricSchemas.ts` (63 lines) and
  `helio-mcp/src/tools/write.test.ts` (95 lines, unmodified — `git diff main...HEAD --stat` shows
  zero changes anywhere in the worktree; this is a pre-execution design gate). Confirmed
  `metricSchemas.ts` holds the zod schemas (`metricAggregationSchema`, `metricFormatSchema`) plus
  the one exported builder `buildUpdateMetricBody`, and `write.test.ts` imports it from
  `./metricSchemas.js` directly (line 18) specifically to avoid `write.ts`'s "pathologically
  expensive to type-check" full Zod surface (file header, lines 9-15).
- Read `write.ts:723-773` (`update_metric` registration): confirms the live call-site pattern —
  the tool handler destructures its Zod-parsed args and calls `buildUpdateMetricBody({...})` inline
  at the `guarded(() => api.updateMetric(metricId, buildUpdateMetricBody({...})))` call site. This
  is exactly the pattern tasks.md's new section 3 (3.2, 3.4) now describes for `update_data_type`/
  `update_pipeline_step`.
- Read revised `design.md` D3 (lines 55-67): retracts the old "no body-builder" ruling, calls for a
  new sibling module `helio-mcp/src/tools/updateSchemas.ts` mirroring `metricSchemas.ts`, holding
  `dataFieldSchema`/`computedFieldSchema` + two exported builders (`buildUpdateDataTypeBody`,
  `buildUpdatePipelineStepBody`).
- Read restructured `tasks.md`: new section "## 1. MCP: updateSchemas.ts module" (1.1-1.3) creates
  the module first; section "## 2. MCP: HelioApi methods" (2.1-2.4) consumes the builders; section
  "## 3. MCP: write.ts tool registration" (3.1-3.5) wires the tools, explicitly stating "calls
  `buildUpdateDataTypeBody` before `api.updateDataType`" (3.2) and the equivalent for pipeline step
  (3.4); new section "## 5. Tests" (5.1-5.2) adds `updateSchemas.test.ts`, explicitly "importing
  from `./updateSchemas.js` directly per design.md D3" — the same import-the-narrow-module pattern
  `write.test.ts` already uses, now achievable because the narrow module now exists.
- Searched the whole change dir for any leftover reference to the old inline-construction approach
  or old task numbering (`grep -n "inline\|body-builder\|4\.1\|4\.2\|4\.3"` across all `.md` files):
  the only hits are (a) design.md's own D3 prose *describing* the old rejected approach as part of
  its revision narrative, (b) Planner Notes' historical account of the round-1 finding, and (c) the
  *current* tasks.md 4.1/4.2, which are now Docs tasks (README table + `dist/` rebuild) — unrelated
  to the old numbering, no collision. No dangling reference to the retracted approach anywhere
  live/binding.
- Conclusion: the contradiction is fully resolved. `updateSchemas.ts`'s planned existence makes
  tasks.md 5.1/5.2 literally achievable exactly as `write.test.ts`'s own precedent already
  demonstrates works for an identical shape of problem.

**Question 2 — is `updateSchemas.ts`'s planned shape sufficient/unambiguous:**

- Verified the backend shape directly: `backend/src/main/scala/com/helio/api/protocols/DataTypeProtocol.scala:22-23` — `DataFieldPayload(name: String, displayName: String, dataType: String, nullable: Boolean)`, `ComputedFieldPayload(name: String, displayName: String, expression: String, dataType: String)`. Tasks.md 1.1's field lists ("name/displayName/dataType/nullable" and "name/displayName/expression/dataType respectively") match exactly, same order.
- Confirmed via `grep` across `helio-mcp/src/` that no DataType-creation tool or field schema exists anywhere yet (DataTypes are pipeline-output/source-companion only, never directly created via MCP) — `dataFieldSchema`/`computedFieldSchema` are genuinely new, not a duplicated/competing schema. Consistent with round-1's already-verified Claim 5.
- Confirmed `helio-mcp/src/types.ts` already has `DataSourceResponse`, `DataTypeResponse`, `PipelineSummaryResponse`, `PipelineStepResponse` (the four response types tasks.md 2.1-2.4 return) — no new response-type task needed, correctly omitted.
- One small, non-blocking gap (see Non-blocking notes below): no task line explicitly instructs adding `UpdateDataTypeRequest`/`UpdatePipelineStepRequest` interfaces to `types.ts`, even though task 1.2 names `UpdateDataTypeRequest` as the builder's return-type shape and D3 says to mirror `metricSchemas.ts` "exactly" (which imports its analogous `UpdateMetricRequest` from `types.ts`). Not materially ambiguous — see notes — but flagged.

**Question 3 — D5 / `PipelineStepConfigCodec` claim, independently re-verified (not trusted from round 1's citation):**

- Read `backend/src/main/scala/com/helio/services/PipelineService.scala` directly. `updateStep`
  (starts line 521): `req.\`type\`` mismatch → 400 (lines 541-547, confirms D2's basis too); when
  `config` is provided, line 559 reads `PipelineStepConfigCodec.decode(existing.kind,
  cfgJson.compactPrint)` — confirmed via `grep -n "PipelineStepConfigCodec.decode"` this is line
  559 exactly, matching design.md's citation.
- Read `addStep` (starts line 433): line 439 reads `PipelineStepConfigCodec.decode(req.\`type\`,
  req.config.compactPrint)` — the *same* `PipelineStepConfigCodec.decode` function, called with the
  step's own kind in both cases (the newly-chosen type at create time; the existing, immutable kind
  at update time). D5's claim ("the exact same validation `add_pipeline_step` already goes through")
  holds — same codec, same function, no new op/kind-check wiring introduced by this ticket.
- Independently checked the "pipeline-op wiring / apply-infer parity" convention's actual scope
  (not just trusting design.md's characterization): read
  `~/.claude/.../memory/feedback_pipeline_op_wiring.md` — the convention is explicitly about
  *adding a new pipeline op* ("apply/infer config shape parity" between `InProcessPipelineEngine.apply<Op>`
  and `PipelineAnalyzeService.infer<Op>`, `allowedOps`, Flyway CHECK constraint, `StepCard`
  dispatch). Cross-checked against ~10 archived tickets (`date-bucket-pipeline-op`,
  `pipeline-string-ops-step`, `pipeline-op-window-partition-order`, etc.) — every historical use of
  "apply/infer parity" in this repo is tied to a ticket introducing a *new* op/step-type. This
  ticket introduces none. D5's reasoning is independently well-grounded, not merely re-asserted.

**Question 4 — other design-gate checks for a plan this size:**

- `openspec validate mcp-edit-in-place-tools --strict` → `Change 'mcp-edit-in-place-tools' is
  valid` (re-ran fresh, clean).
- `grep -rn "TODO\|TBD"` across the change dir → no hits.
- `git status --short` / `git diff main...HEAD --stat` → only the untracked `openspec/changes/mcp-edit-in-place-tools/` dir; no code changes yet (correct for a pre-execution design gate).
- Cross-checked `specs/mcp-edit-in-place-tools/spec.md` against design.md/tasks.md: the four
  Requirements (rename-only for data-source/pipeline, wholesale-replace for DataType
  fields/computedFields, no `type` field for pipeline-step) match exactly; no drift.
- Confirmed `helioApi.ts`'s existing `updateMetric` docstring (lines 755-760, unmodified) states
  the same "patch is the ALREADY-BUILT wire body ... tool layer does the omit-vs-null encoding
  before calling this method" contract that tasks.md 2.2/2.4 now correctly describe for the two new
  methods ("with the already-built body from `buildUpdate*Body`").
- Sanity-checked there's no simpler existing precedent this plan should have reused instead of a
  builder module: `bindPanel`/`updatePanelAppearance` (`helioApi.ts:626-641`) use ad hoc
  `Record<string, unknown>` PATCH bodies with no builder — but those aren't multi-optional-field
  partial-PATCH cases with an "absent vs. explicit value" contract the way `update_metric` and the
  two new tools are, so `update_metric`'s pattern (not `bindPanel`'s) is the correct precedent to
  mirror, as D3 does.

### Verdict: CONFIRM

Both round-1 findings are genuinely resolved, not just asserted-resolved: the D3 revision makes
tasks.md 5.1/5.2 literally achievable via the same mechanism `write.test.ts` already proves works
for the identical class of problem, with no leftover reference to the retracted approach anywhere
in the plan; and D5's factual claim about `PipelineStepConfigCodec.decode` and the actual scope of
the "apply/infer parity" convention both check out against source I read myself, independent of the
prior round's citation. `openspec validate --strict` is clean and no new contradiction was
introduced by the restructuring.

### Non-blocking notes

- Tasks.md has no explicit line item for adding `UpdateDataTypeRequest`/`UpdatePipelineStepRequest`
  TypeScript interfaces to `helio-mcp/src/types.ts`, even though task 1.2 names
  `UpdateDataTypeRequest` as the builder's return-type shape and D3 says to mirror
  `metricSchemas.ts` "exactly" — that file's own precedent (`import type { MetricFormat,
  UpdateMetricRequest } from "../types.js"`) implies the analogous pair of interfaces needs to exist
  in `types.ts` too, the same way `UpdateMetricRequest` does. This is low-risk (a missing type would
  be a compile error caught immediately by task 5.3's `npm test`/lint pass, not a silent defect),
  and the codebase's single dominant convention (every Request/Response TS interface is named
  1:1 after its backend protocol case class) leaves little room for an implementer to invent
  something materially different — but an explicit task bullet would remove the last bit of
  inference required.
- The Planner Notes' historical account of round 1 (old task numbers 4.1/4.2, the old D3) is
  accurate as a record of what changed and doesn't collide with the current, renumbered tasks.md.
