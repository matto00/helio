## Skeptic Report — final gate (round 1, skeptic-final-1.md)

### What I verified (with evidence)

**Ground truth diff** — `git diff main...HEAD --stat` (from HEAD 9d8c67e5): touches only
`helio-mcp/src/{types.ts,helioApi.ts,tools/{read.ts,write.ts,write.test.ts,metricSchemas.ts}}`
plus `openspec/changes/metric-crud-mcp-tools/**` planning docs. No backend/schema files touched
— matches the ticket's "Out of scope" (backend routes are HEL-493, already merged).

**AC1 — five thin pass-through tools registered, callable.**
Read `helio-mcp/src/tools/read.ts` (full file) and `write.ts` (full file):
- `list_metrics` (read.ts:241-257) → `guarded(() => api.listMetrics(limit, offset))`
- `get_metric` (read.ts:259-270) → `guarded(() => api.getMetric(metricId))`
- `create_metric` (write.ts:676-712) → `guarded(() => api.createMetric({...}))`
- `update_metric` (write.ts:714-764) → `guarded(() => api.updateMetric(metricId, buildUpdateMetricBody({...})))`
- `delete_metric` (write.ts:837-850) → `guarded(() => api.deleteMetric(metricId))`

Each `HelioApi` method (`helioApi.ts:283-294`, `706-723`, `771-777`) is a single HTTP call with no
reshaping (`updateMetric`'s "reshaping" is limited to the already-built PATCH body it's handed —
the AC-mandated absent-vs-null encoding, not a violation of "verbatim"). `registerReadTools`/
`registerWriteTools` are already wired in `src/index.ts:28-29` (unmodified) — confirmed via
`grep -n "registerWriteTools\|registerReadTools" src/*.ts`.

**AC2 — Zod rejects invalid aggregation before hitting the server.**
`metricSchemas.ts:22-29`: `metricAggregationSchema = z.enum(["sum","avg","min","max","count","countDistinct"])`,
used by both `create_metric` (write.ts:695) and `update_metric` (write.ts:734). Cross-checked
against the backend allow-list: `backend/src/main/scala/com/helio/domain/model.scala:820`
(`MetricAggregation.values = Set("sum","avg","min","max","count","countDistinct")`) — exact match.
Ran the schema directly with `npx tsx` to confirm real rejection behavior (not just inspection):
`metricAggregationSchema.parse("bogus")` throws `invalid_enum_value`; `parse("sum")` succeeds.
Server errors: every tool wrapped in the existing `guarded()` helper (unchanged, read.ts:22-33 /
write.ts:27-37) which surfaces `HelioApiError` verbatim as `isError: true` content — no swallowing.

**AC3 — descriptions state the V41 rule + "reference a defined metric" guidance.**
`create_metric` description (write.ts:681-689): "`dataTypeId` MUST be a caller-owned
pipeline-output DataType — V41: sourceId absent... call list_metrics first to check whether the
measure you need is already defined". `list_metrics` description (read.ts:246-250): "Before
deriving an ad-hoc aggregation inline... call this to see whether a metric already names the
measure you need — reference it (get_metric) instead of re-deriving one." Verified server-side
V41 enforcement actually exists (not just claimed in prose): `MetricService.scala:158-160` rejects
`dt.sourceId.isDefined` with "Metrics can only bind to pipeline-output DataTypes".

**AC4 — build succeeds, tests pass, no `any` leakage.** Re-ran fresh, myself, in the worktree:
- `cd helio-mcp && npm run build` → `tsc`, exit clean, no output/errors.
- `cd helio-mcp && npm run typecheck` (`tsc --noEmit`) → clean.
- `grep -n ": any\|<any>\|as any"` across all 6 touched `helio-mcp/src` files → zero real hits
  (the three matches are the English word "any" inside prose tool-description strings, not type
  annotations).
- `npx jest --testPathPatterns="helio-mcp/src/tools/write.test.ts"` (root) → **9/9 pass**,
  covering the `buildUpdateMetricBody` absent-vs-null encoding (full-omit, single-field,
  per-field omission, explicit-`null` for both nullable fields, whole-object format replace,
  all-fields-at-once, and a `JSON.stringify` round-trip). These are real tests: I read
  `metricSchemas.ts`'s `buildUpdateMetricBody` (lines 45-63) and confirmed each assertion
  actually exercises the `!== undefined` branch logic, not a tautology.
- Root `npx jest --passWithNoTests` initially showed 2 extra FAIL suites — traced to
  `helio-mcp/dist/*.test.js` (compiled `.js` output picked up because `jest.config.cjs`'s
  `testPathIgnorePatterns` doesn't exclude `dist/`). Reproduced the cause: `dist/` is
  `.gitignore`d and was created by my own `npm run build` step above, not by the executor's diff.
  Removed it (`rm -rf helio-mcp/dist`) and reran `npx jest --passWithNoTests helio-mcp` →
  **2 suites / 103 tests, all pass**. This confirms it was a self-inflicted measurement artifact,
  not a real regression — matches the evaluator's own account of hitting and diagnosing the same
  artifact.
- `npx eslint helio-mcp/src/{types.ts,helioApi.ts,tools/{read.ts,write.ts,write.test.ts,metricSchemas.ts}} --max-warnings=0` → clean.
- `npx prettier --check` on the same file set → all pass.

**Wire-shape parity (types.ts vs. backend).** Read `MetricProtocol.scala` in full and diffed it
field-by-field against `types.ts`'s `MetricResponse`/`CreateMetricRequest`/`UpdateMetricRequest`/
`MetricFormat` (types.ts:449-511): field names, optionality, and the `Option[Option[X]]`
absent-vs-null idiom for `description`/`format` on `UpdateMetricRequest` all match
`UpdateMetricRequest`'s custom `read`/`write` JsonFormat (`MetricProtocol.scala:100-156`)
exactly. `MetricRoutes.scala` confirms the five REST verbs/paths the tools target
(`GET/POST /api/metrics`, `GET/PATCH/DELETE /api/metrics/:id`).

**Design/tasks/spec consistency.** `tasks.md` items 1.1-4.2 all map 1:1 to the diff. `design.md`
Decision 2 says the PATCH body-builder is "a small, local body-builder in `write.ts`" but it
actually lives in the new `metricSchemas.ts` (imported by `write.ts`) — a minor doc/code
divergence, already caught and correctly judged non-blocking by the evaluator (well-justified
in `metricSchemas.ts`'s own header comment: avoids pulling `write.ts`'s ~20-tool Zod surface into
the test's compile graph). `files-modified.md` similarly misattributes
`metricAggregationSchema`/`metricFormatSchema`/`buildUpdateMetricBody` to `write.ts` instead of
the new `metricSchemas.ts` — a handoff-doc accuracy issue, not a functional defect (the code
itself, and its test, are correct and independently verified above).

**No UI to review.** `git diff --name-only main...HEAD` has zero matches under `frontend/**` —
this ticket is `helio-mcp`-only, so the design-standard/browser-review section of my brief does
not apply, as the task instructions state.

### Verdict: CONFIRM

All four acceptance criteria trace to real, independently-verified evidence (not just re-reading
the evaluator's claims): tool registration, Zod rejection behavior, description content, and a
clean fresh build/typecheck/lint/format/test run. The one deviation from design.md (body-builder's
file location) and the files-modified.md staleness are cosmetic handoff-doc issues that don't
affect the shipped behavior, contract, or test coverage — consistent with the evaluator's own
non-blocking classification, arrived at independently here rather than taken on faith.

### Non-blocking notes

- Fix `openspec/changes/metric-crud-mcp-tools/files-modified.md` before archive: it claims
  `metricAggregationSchema`/`metricFormatSchema`/`buildUpdateMetricBody` live in `write.ts`; they
  live in the new `helio-mcp/src/tools/metricSchemas.ts` (imported by `write.ts`), which the doc
  doesn't mention at all.
- `design.md` Decision 2's literal wording ("a small, local body-builder in `write.ts`") is now
  slightly inaccurate given the `metricSchemas.ts` split — worth a one-line amendment for future
  readers, though the intent (single-consumer, no shared helper) is preserved.
