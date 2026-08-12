## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence)

**Round-1 fix present and correctly targeted:**

- `design.md` D6 (lines 70-88) now explicitly states: "Because this field is always emitted (never
  omitted) once `metricId` resolves, `schemas/panel.schema.json`'s `$defs.MetricConfig`/
  `$defs.ChartConfig`/`$defs.TableConfig` (each `"additionalProperties": false`) MUST declare
  `metricDeprecated: boolean`" — citing CLAUDE.md's "keep schema updates in the same change" rule and
  D1's own `pipeline-analyze-response.schema.json` precedent, exactly as round 1 required.
- `tasks.md` 2.3 (lines 28-32) adds the concrete task, explicitly labeled "(Round-1 design-gate REFUTE
  fix)".
- Non-blocking suggestion also addressed: `design.md` D6 (lines 84-88) and `tasks.md` 1.3 (line 12) both
  now cover a new `schemas/metric-usage-response.schema.json` for `GET /api/metrics/:id/usage`.
- Read the current `schemas/panel.schema.json` in full (357 lines) — confirmed `metricDeprecated` is
  genuinely undeclared today in `$defs.MetricConfig`/`ChartConfig`/`TableConfig`, and each of those
  `$defs` is `"additionalProperties": false`, so round 1's underlying concern (silent contract drift)
  was real and is now covered by a task.

**Re-verified round-1's already-checked facts are still accurate (no code changed between rounds — `git
status --short` shows only the untracked `openspec/changes/metric-reuse-governance/` dir; no backend/
frontend files touched):**

- `MetricRoutes.scala:65-67` DELETE handler is still bare `ServiceResponse.runNoContent(...)` → `204`.
- `ServiceResponse.runNoContent`/`runWith` (`backend/src/main/scala/com/helio/api/ServiceResponse.scala:41-56`)
  — `runWith` exists precisely for "success path needs to attach its own directives" (e.g. a header),
  confirming D2's `respondWithHeader` plan is mechanically feasible with existing infra, not aspirational.
- `DataTypeRepository.scala:189-205` `existsBoundToAnyOwnedPanelAction` — confirmed the exact
  owner-scoped join shape (`type_id = ... AND owner_id = ...`) design.md D1 cites as the pattern to
  mirror for the new usage query.

### New defect found on fresh adversarial review of the round-2 diff

`tasks.md` 2.3's fix, in the course of satisfying round 1, introduces a new, concrete internal
contradiction: it instructs adding `metricDeprecated` to the **unconditional `required` array** of
`$defs.MetricConfig`/`ChartConfig`/`TableConfig` —

> "Update `schemas/panel.schema.json`'s `$defs.MetricConfig`/`$defs.ChartConfig`/`$defs.TableConfig` to
> declare `metricDeprecated: { "type": "boolean" }` and **add it to each `$def`'s `required` list** (it
> is always emitted once `metricId` resolves, never omitted)." (tasks.md lines 28-31)

This is wrong, and provably so from the code already in this worktree:

1. **`metricDeprecated` is conditionally emitted, not unconditionally.** `PanelService.scala`'s
   `resolveOne` (lines 110-127) and `resolveSingleBinding` (lines 138-164) — the exact functions D6 says
   host the new field — only reach `withMaterializedMetric` (where `metricDeprecated` would be set) when
   `metricIdOf(dtResolved) = Some(metricId)` **and** the metric resolves to an owned `MetricDefinition`;
   when `metricId` is `None` (the common case — most metric/chart/table panels use the pre-existing raw
   `dataTypeId`/`fieldMapping` binding and are never bound to a stored `MetricDefinition` at all) the
   function returns `dtResolved` unchanged, with no `metricDeprecated` field ever added. When `metricId`
   is set but doesn't resolve, `withMetricCleared` (lines 123/159) strips `metricId` from the response
   entirely — so by the time a client sees the response, "`metricId` present" and "`metricDeprecated`
   present" are the same condition. The round-2 `panel-datatype-binding/spec.md` delta itself says this
   explicitly: "**Whenever** `metricId` resolves to a `MetricDefinition`... the response SHALL
   additionally carry `config.metricDeprecated: Boolean`" (spec.md line 14-17) — a conditional, not an
   unconditional, guarantee.
2. **None of `MetricConfig`/`ChartConfig`/`TableConfig` currently has any `required` array at all**
   (verified by reading `schemas/panel.schema.json` `$defs` in full — `metricId` itself is optional,
   there is no top-level `required` key on any of the three `$defs`), because a metric/chart/table panel
   validly exists with **zero** config properties (unbound panel, or bound only via raw
   `dataTypeId`/`fieldMapping`, no `metricId` at all). Marking `metricDeprecated` unconditionally
   required would make `panel.schema.json` (and, via its `$ref`, `bound-panel-response.schema.json`)
   reject every legitimate metric/chart/table panel response that isn't bound to a stored metric — which
   is the majority case both today and after this change ships (metric binding remains optional per D5's
   own picker-exception language and the ticket's "existing bindings keep working" framing).
3. **This repo already has the correct pattern for this exact situation**, one directory over:
   `schemas/create-panel-request.schema.json` uses `allOf`/`if`/`then` to make `config`'s shape
   conditional on `type` (lines 29-70, e.g. `"if": {"properties": {"type": {"const": "metric"}},
   "required": ["type"]}, "then": {...}`). The same construct — `"if": {"required": ["metricId"]},
   "then": {"required": ["metricDeprecated"]}` inside each of the three `$defs` — would correctly encode
   "required only when `metricId` is present," matching the actual server behavior just traced above.
   Marking it required unconditionally is not equivalent and not a matter of style; it is a factually
   incorrect machine-readable contract.

Round 1's own report flagged that no test currently validates responses against `panel.schema.json`
(only `WorkspaceContextServiceSpec` is wired to `JsonSchemaValidation`) — I re-confirmed this is still
true (no `PanelRoutesSpec`/`PanelMetricBindingRoutesSpec` schema-validation harness exists in this
worktree). So, exactly as with round 1's defect, this would ship as **silent, unenforced drift**: either
the schema is wrong (asserts a guarantee the API doesn't provide) or — if an implementer notices the
gap mid-implementation and "fixes" it by having the backend always emit `metricDeprecated: false` for
unbound configs to satisfy the schema — that would directly contradict D6's own stated semantics
("`deprecated` status is informational... it always reflects the metric's current state whenever
`metricId` resolves" — design.md line 76-77) and would emit a misleading `false` on panels with no
metric binding at all, indistinguishable from "bound to a non-deprecated metric." Neither outcome is
acceptable, and tasks.md as written doesn't flag the ambiguity — a competent implementer following it
literally lands on the first (wrong-schema) outcome.

### Verdict: REFUTE

### Change Requests

1. **`tasks.md` 2.3 (lines 28-32)**: do not add `metricDeprecated` to the unconditional `required` array
   of `$defs.MetricConfig`/`$defs.ChartConfig`/`$defs.TableConfig`. Either (a) declare it only as an
   optional property (`"metricDeprecated": {"type": "boolean"}` in `properties`, no `required` change) —
   sufficient to satisfy `additionalProperties: false` and round 1's actual concern, or (b) — preferred,
   since it captures the real guarantee — add a conditional block per `$def` mirroring the `if`/`then`
   pattern already used in `schemas/create-panel-request.schema.json`: `"if": {"required":
   ["metricId"]}, "then": {"required": ["metricDeprecated"]}`, so the schema correctly states
   "`metricDeprecated` is required exactly when `metricId` is present" instead of "always required."
   Update `design.md` D6's closing sentence (lines 78-83) to match whichever option is chosen, since it
   currently just says "MUST declare `metricDeprecated: boolean`" without specifying required-ness — the
   ambiguity is what let tasks.md 2.3 default to the incorrect unconditional reading.

### Non-blocking notes

- Everything else re-verified this round holds: D1-D5, D7, D8's reasoning and cited line numbers are
  unchanged and still accurate against the current (unmodified) codebase; the `metric-usage-response.schema.json`
  addition (tasks.md 1.3) is a reasonable, low-risk addition consistent with D1's precedent.
- Once Change Request 1 is resolved, I'd expect this design to clear — the fix is narrow (one task
  line + one design sentence), not a redesign.
