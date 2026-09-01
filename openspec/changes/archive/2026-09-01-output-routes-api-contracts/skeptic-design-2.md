## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### UI gate
N/A — backend/contract-only row; governing spec line 213: "Concertino UI gate: N/A for P1.1–P1.4".

### What I verified (with evidence)

Each of round 1's 7 change requests, re-derived from ground truth (not from the orchestrator's claims):

1. **CR1 (task 1.3 / `inferredSchema`) — RESOLVED.** Read `DataSourceProtocol.scala` myself:
   `DataSourceResponse` is a sealed trait (line 14) with seven subtypes (35/46/57/67/78/89/100),
   and `grep -n inferredSchema` returns exactly one hit — line 186, inside `CreateSourceResponse`.
   So D7's claim ("the gap is the base `DataSourceResponse` list/get shape, `CreateSourceResponse`
   already has it") is factually correct. `ls schemas/` confirms no `sources/` dir; task 1.3 now
   creates `schemas/sources/data-source.schema.json`, D7 explicitly forbids touching
   `schemas/patch-sets/**` and `schemas/pipelines/pipeline-proposal.schema.json` (P1.4-owned), and
   the backend side is now a real task (3.10). Previously-flagged mis-targeting is gone.
2. **CR2 (decision 15, server-owned panel layout) — RESOLVED.** design.md D8 (constants location,
   same-transaction boundary, `layoutItem` response field, rejected client-side alternative), task 2.7
   (with an explicit rollback test), and `specs/dashboard-panel-layouts/spec.md` ADDED requirement
   with three scenarios (append, transactionality, request-body `layout` not honored). Matches
   governing spec decision 15 / line 140.
3. **CR3 (`validate-expression`) — RESOLVED, and the premise checks out.** My own grep confirms no
   backend `validate-expression` route exists (only `PipelineScheduleService`'s unrelated private
   `validateExpression`, and the dead frontend caller `dataTypeService.ts:51` → `/api/types/:typeId/
   validate-expression`). D9 states this correctly as "new, not a rename"; task 3.9 and a new
   `pipeline-validate-expression-api` capability spec (3 scenarios incl. unknown-stepId 404) cover it.
4. **CR4 (HEL-877 / HEL-876) — RESOLVED.** Tasks 2.3a and 2.3b exist; `specs/output-routes-api/spec.md`
   now carries a partial-merge `PATCH` requirement (legend/tooltip/seriesColors/axisLabels + the
   absent-vs-null normalization idiom) and a `config.format` requirement covering both `metric` kind
   and `collection` with `baseType: "metric"`, each with scenarios. D10 records the placement rationale.
5. **CR5 (`PATCH /api/outputs/:id` had no requirement) — RESOLVED.** Now a full requirement with three
   scenarios; patchable field set (`{ name, config }`) and merge-vs-replace semantics are unambiguous.
6. **CR6 (expand spec delta) — RESOLVED.** `specs/pipeline-shape-registry/spec.md` is a MODIFIED block
   whose requirement header matches main verbatim. I diffed the scenario body against
   `openspec/specs/pipeline-shape-registry/spec.md` on the worktree: all 5 original scenarios are
   preserved, with exactly two deliberate edits (the success scenario's "JSON array" → "`steps`
   containing", and the additive-scenario's test clause now saying `PipelineShapeRoutes` HTTP tests are
   updated for the envelope) — both are the genuine content of the BREAKING change, not silent drops.
   Two new scenarios cover the `outputs` block present/omitted. `npx openspec validate
   output-routes-api-contracts --strict` → "Change 'output-routes-api-contracts' is valid".
7. **CR7 (export/import version bump) — RESOLVED, and the deferral is consistent with P1.7.** D11 is
   now an explicit, reasoned divergence from governing-spec line 144 (bumping with no shape change
   would reject existing `version: 2` payloads for no functional reason and force a second bump).
   I independently checked P1.7's own row (governing spec line 225, HEL-910): it lists **"snapshot
   schema bump"** as P1.7 scope. So the governing spec assigns the bump to *both* 144 and the P1.7
   row; deferring to P1.7 lands it where the row already expects it. Divergence is recorded, justified,
   and not in conflict with the downstream ticket.

**Fresh-problem checks (nothing new found):**
- BREAKING expand envelope: proposal.md flags it as BREAKING, task 3.8 names the concrete blast radius
  (existing `PipelineShapeRoutes` HTTP tests reading the bare array), the spec preserves the "no
  persistence" invariant, and `outputs` is *omitted* (not empty-array) when absent — deliberate and stated.
- `check:schemas` is `scripts/check-schema-drift.mjs` (package.json:13), a hardcoded-file-list drift
  check over the proposal/MCP pair; purely additive new schema files under `schemas/outputs|sources|
  pipelines` cannot trip it, and task 5.4 asserts the P1.4-owned pair is byte-for-byte untouched.
- `openspec validate --strict` green; no `@deprecated`/alias/shim proposed anywhere.

### Verdict: CONFIRM

All 7 round-1 change requests are substantively resolved against ground truth, not merely asserted.
The plan is implementable as written.

### Non-blocking notes
- Tasks 1.1–1.3 say "verify `npm run check:schemas` (or repo equivalent)". The exact script is
  `npm run check:schemas` → `check-schema-drift.mjs`; the "(or repo equivalent)" hedge is unnecessary
  and slightly invites the executor to substitute a different command. Minor wording.
- Round 1's note 1 (state outright that the governing spec's `kind`/`outputId` wording at lines 140/144
  was superseded by P1.1's as-built `type`/`config.outputId`) is covered by design.md's Context
  paragraph but not called out as a deliberate supersession; a later reader could still try to "fix"
  it back toward the doc.
- Round 1's note 2 stands: `openspec/specs/alert-rule-crud-api/spec.md` on main has three scenario
  titles still reading "DataType" with Output-correct bodies — a P1.7 sweep item, out of scope here.
