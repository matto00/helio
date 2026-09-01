## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### UI gate
**N/A for this row** — HEL-906 is backend/contract only (routes, services, `schemas/`, `openspec/`).
The governing spec line 213 states "Concertino UI gate: N/A for P1.1–P1.4". No frontend files are in
the planned Impact. Stated explicitly rather than skipped silently.

### What I verified (with evidence)

- **Premise correction (`type:"output"`/`config.outputId`, not `kind`)** — CONFIRMED correct throughout.
  `schemas/panels/panel.schema.json:45,99-104` on the worktree already defines `OutputConfig` with
  `outputId` under a top-level `type` oneOf. design.md Context states this explicitly; no task or
  spec delta proposes a `kind` field or a top-level `outputId`. Note the governing spec line 140/144
  still uses the older `kind`/`outputId` wording — the artifacts correctly follow as-built ground
  truth over the doc's draft wording (non-blocking note 1).
- **HEL-905 task 6.4 coverage** — CONFIRMED. design.md D4 scopes it to trunk-final + each tail-final
  projection; tasks 3.3 (implement, with a tail-drops-a-column assertion) and 3.4 (consume it in
  `capabilities?stepId=`) implement it; `specs/pipeline-analyze-api/spec.md` adds a matching
  requirement with two scenarios. Genuinely covered.
- **alert-rule-crud-api exclusion** — CONFIRMED correct. Read `openspec/specs/alert-rule-crud-api/spec.md`
  on `main` (HEAD 666db9f8): the create/target requirements already say `targetOutputId` and
  "targeting an Output the caller can access". No delta is needed. (Non-blocking note 2: three
  scenario *titles* there still read "target DataType" while their bodies say Output — cosmetic,
  already on main, out of this ticket's scope.)
- **panel-query-model REMOVED delta** — CONFIRMED well grounded. `PanelRoutes.scala:72-74` carries the
  comment "`GET /api/panels/:id/query` removed outright (HEL-904 task 4.1)"; the capability spec still
  exists on main with exactly three requirements, and the delta removes exactly those three names with
  Reason + Migration on each. Delta requirement headers match main verbatim.
- **check-schema-drift split** — design/tasks keep `DashboardProposalService.scala` and
  `helio-mcp/src/tools/proposal.ts` untouched (design Goals; task 5.4 asserts byte-for-byte). But see
  Change Request 1: task 1.3 as written points the executor at exactly those P1.4-owned files.
- Read the governing spec sections "API & contracts" (lines 136-144), decisions 10/11/15, and the
  P1.3 delivery row (line 221) as the authority over the ticket.

### Verdict: REFUTE

Core structure (D1–D6, the Output route spec, the create-pipeline transaction shape, the analyze
projection) is sound. The refutation is coverage: several items the governing spec and ticket assign
explicitly to P1.3 have no task, no spec delta, and no design decision, and one task is pointed at
files this ticket is forbidden to touch.

### Change Requests

1. **Task 1.3 (`inferredSchema` on data-source schemas) is undefined and points at P1.4-owned files.**
   There is no `schemas/data-sources/` or `schemas/sources/` directory (`ls schemas/*/` → agent-memory,
   alerts, assistant, audit, auth, authoring, dashboards, hooks, outputs, panels, patch-sets, pipelines,
   shared, workspace). `grep -rln "DataSourceResponse\|CreateSourceResponse" schemas/` returns **only**
   `schemas/patch-sets/patch-set-preview-response.schema.json`,
   `schemas/patch-sets/patch-set-apply-response.schema.json`, and
   `schemas/pipelines/pipeline-proposal.schema.json` — all three are proposal/patch-set schemas that
   ticket + governing spec line 144 reserve for P1.4. Resolve this in design.md: state where the
   data-source wire contract lives (a new `schemas/sources/*` file? none at all?) and rewrite task 1.3
   accordingly, with an explicit "do not touch patch-set/proposal schemas" constraint. Also note that
   `inferredSchema` already exists in the backend (`DataSource.scala:36,55,...`;
   `DataSourceProtocol.scala:186` on `CreateSourceResponse`) — the design must say what is actually
   missing (presumably `DataSourceResponse`/the list+get responses, not `CreateSourceResponse`) rather
   than "add `inferredSchema`" generically, and add a backend task to populate it.

2. **Decision 15 (server-owned panel layout) is entirely uncovered.** Governing spec decision 15
   (line 44) and API section line 140 assign to `POST /api/panels`: compute the kind's default size,
   write the `dashboards.layout` item **in the same transaction** as the panel insert, and return the
   placed layout, with no frontend copy of the constants. The ticket Scope repeats this verbatim. There
   is no design decision, no task, and no spec delta (e.g. to `dashboard-panel-layouts` /
   `frontend-panel-creation`'s backend contract) for it. P1.6 explicitly consumes it. Add a design
   decision (where the constants live, transaction boundary, response shape), a task, and a spec delta.

3. **`POST /api/pipelines/:id/validate-expression?stepId=` is uncovered.** Governing spec line 138 and
   ticket Scope assign the replacement of the type-scoped validate-expression route to P1.3. No task,
   no spec delta. Add both (or, if it is genuinely already gone, cite the file:line proving it and say
   so in design.md — do not leave it silently absent).

4. **Absorbed tickets HEL-877 and HEL-876 have no tasks or spec requirements.** The P1.3 row (line 221)
   lists absorbed tickets HEL-722, HEL-895, HEL-638, HEL-644, HEL-892, **HEL-877**, **HEL-876**, and the
   ticket's "Validation that moves here" section makes both acceptance criteria: (a) `PATCH` of a partial
   `chart.legend` merges rather than rejects, and the same partial-merge for `tooltip`, `seriesColors`,
   `axisLabels`; (b) Output `config.format` carries number formatting (decimals, prefix/suffix/unit,
   compact) for `metric` Outputs and `collection` Outputs with `baseType: metric`. HEL-722 → task 2.6,
   895/638 → 3.5, 644/892 → 3.6; 877 and 876 → nothing. Add tasks and requirements (the natural home is
   `specs/output-routes-api/spec.md`, on the `PATCH /api/outputs/:id` and Output-config shape).

5. **`PATCH /api/outputs/:id` has no requirement at all.** `specs/output-routes-api/spec.md` names the
   route in the CRUD requirement statement but has no scenario defining its semantics (which fields are
   patchable, partial-merge behavior per CR 4, Option-absent-vs-null normalization which the ticket calls
   out as a `RequestValidation` requirement). Add it — an implementer could read the current text two ways.

6. **`POST /api/pipeline-shapes/:id/expand` (task 3.8) has no spec delta.** The change adds a
   `parentStepId` target and an `outputs[]` return block to an existing contract-facing route, but no
   MODIFIED delta is proposed against the shape capability (`pipeline-shape-registry` /
   `pipeline-shape-instantiation-ui` / `mcp-pipeline-shape-tools` — pick the contract-facing one). The
   ticket requires "every contract-facing capability spec ... updated or removed in this change".

7. **design.md contradicts the ticket and the governing spec on the export/import version bump.**
   design.md Non-Goals defers "export/import version-bump reshape" to P1.7; the ticket Contracts section
   says "The export/import snapshot bumps its version (currently `CurrentVersion = 2`)" and governing spec
   line 144 lists that bump inside the **P1.3** schema paragraph. Governing spec wins over the ticket, and
   here they agree against the design. Either bring it in scope (task + `dashboard-export-import` delta) or
   record an explicit, justified divergence from line 144 in design.md — do not leave a silent contradiction.

### Non-blocking notes
1. design.md would be stronger if it stated outright that the `kind`/`outputId` wording in governing spec
   lines 140/144 was superseded by P1.1's as-built `type`/`config.outputId`, so a later reader does not
   "fix" the artifacts back toward the doc.
2. `openspec/specs/alert-rule-crud-api/spec.md` on main has three scenario titles still saying "DataType"
   with Output-correct bodies. Out of scope here; worth a P1.7 sweep note.
3. Task 4.5's "leave a PR comment rather than fixing silently" is good discipline — keep it.
