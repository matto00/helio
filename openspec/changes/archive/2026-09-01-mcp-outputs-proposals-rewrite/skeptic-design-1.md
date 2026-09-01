## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

**Spec fidelity (decisions 10/11)**
- Read `docs/superpowers/specs/2026-08-30-pipelines-outputs-remodel-design.md:170-187`
  ("Agent / MCP surface & proposals"). The plan's Changed/New/Removed tool lists in
  `proposal.md`, `ticket.md:95-108` and `tasks.md` §3 are a **character-for-character match**
  with the spec's three lists. No tool added, dropped, or renamed differently.
- Decision 11 ("no aliases") is honoured: `tasks.md` 3.9 deletes outright, and 5.3 (exact
  tool-name-set test) is the correct backstop. Confirmed against the real registered tool
  set — `grep -A1 'registerTool($' helio-mcp/src/tools/*.ts` lists 62 tools; every one of the
  12 names on the removal list exists today, so the list is neither stale nor over-broad.

**Per-node grounding (task 1.4 / design decision 5) — achievable**
- `backend/src/main/scala/com/helio/domain/engine/PipelineAnalyzeService.scala:184`
  `analyzeNodes(steps, sourceSchema): Map[String, AnalyzedStep]` exists and walks
  `parentStepId`, returning each node's own projected `outputSchema`. Decision 5 is grounded
  in real, already-merged P1.2/P1.3 code, not aspiration. See caveat CR#3 below.

**Backend routes the MCP surface depends on — all exist**
- `POST /api/pipelines/:id/preview?outputId=` — `PipelineRunStatusRoutes.scala:53-55`
  (`parameters("outputId".optional)`), with a scaladoc at :19-21 explicitly naming P1.4's
  `preview_outputs` as its consumer. Decision 3 confirmed.
- `GET /api/pipelines/:id/capabilities` — `PipelineRoutes.scala:59`.
- `GET/POST /api/pipelines/:id/outputs`, `GET/PATCH/DELETE /api/outputs/:id`,
  `/rows`, `/panels`, `/assertion-status`, `GET /api/outputs` — `OutputRoutes.scala:31-111`.
- Single-call create: `schemas/pipelines/create-pipeline-request.schema.json` carries
  `steps[]` + `outputs[]`. Decision 2 confirmed **except** the inline-source arm (CR#2).

**`asNumeric` protection (design non-goal) — correctly scoped**
- `WorkspaceContextService.scala` is 923 lines; `asNumeric`'s call site and the
  round-3 finite-guard / `BigDecimal.setScale` rounding commentary sit at :645-700 with an
  explicit "human-mandated placement" marker. The design's non-goal ("moving code during the
  split is fine, altering this logic is not") names exactly this and is the right guard.

**Schema-drift coupling (design decision 4) — real**
- `scripts/check-schema-drift.mjs:22-32` hardcodes
  `services/proposals/DashboardProposalService.scala`, `helio-mcp/src/tools/proposal.ts`,
  `helio-mcp/src/tools/proposalValidation.ts`, and
  `frontend/src/features/dashboards/ui/ProposalReview.tsx` and reads them together. The
  pairing requirement in decision 4 / tasks 1.1-1.3 + 3.10 is correct, and the sequencing
  (schemas + backend services + MCP handlers inside one cycle) is workable.

**HEL-647 premise — re-verified, still valid (I nearly refuted this wrongly)**
- `npx jest helio-mcp/src/tools/write.test.ts` passes in 1.9s, and the full root suite passes
  (14/14 suites, 250 tests, 5.7s, no OOM) — which looked like the OOM premise was stale.
  Re-checked before concluding: `grep '^import' helio-mcp/src/tools/write.test.ts` shows it
  imports only `assertSchemas.js` / `metricSchemas.js`, and **no test anywhere imports
  `write.ts`** (`grep -rn 'from "./write' helio-mcp/src --include=*.test.ts` → empty). That is
  HEL-541's documented workaround, so the OOM-on-import constraint is genuinely unfixed and
  decision 1's motivation stands. Reproduction changed the verdict here.

**OpenSpec artifacts**
- `npx openspec validate mcp-outputs-proposals-rewrite --strict` → valid. No
  `TODO`/`TBD`/`???` anywhere in the change dir. Every ticket AC (`ticket.md:145-180`) traces
  to at least one task; no orphan tasks beyond the ticket's stated scope.

### Verdict: REFUTE

Three defects, all cheap to fix now and expensive later. The plan's tool table, grounding
approach, and cycle sequencing are sound — these are localized.

### Change Requests

1. **The plan's helio-mcp verification command does not exist, and its stated rationale is
   inverted.** `tasks.md` 5.9 and `design.md`'s "Risks" bullet both mandate
   `npm --prefix helio-mcp test`, on the premise "root `npm test` finds zero helio-mcp tests
   (HEL-880 precedent)". Both halves are false, reproduced twice:
   - `npm --prefix helio-mcp test` → `npm error Missing script: "test"` (exit 1).
     `helio-mcp/package.json` has scripts `build, start, dev, typecheck, verify, compose,
     verify-bound-panel` — no `test`.
   - The root suite is not blind to helio-mcp; it is **entirely** helio-mcp.
     `npx jest --listTests` returns 14 files, all under `helio-mcp/src/**`, and zero outside
     it (`jest.config.cjs` ignores `/frontend/`, `/e2e/`, `/helio-mcp/dist/` — but not
     `helio-mcp/src`).
   As written, an executor running 5.9 gets a hard error and will either silently drop the
   step or improvise a `test` script mid-cycle. Fix: correct the design's risk bullet to state
   that root `npx jest` **is** the helio-mcp suite, and rewrite 5.9 as either root `npx jest`
   or an explicit task to add a `test` script to `helio-mcp/package.json` (decide which, don't
   leave it to the executor). Task 5.6's "root Jest imports every decomposed module without
   OOM" survives unchanged and is the right check.

2. **`create_pipeline`'s inline-source arm has no backend support, contradicting design
   decision 2.** The spec (line 175) and `tasks.md` 3.2 require `sourceId` **or** an inline
   source spec. But `schemas/pipelines/create-pipeline-request.schema.json` has
   `"required": ["name", "sourceDataSourceId"]` and `additionalProperties: false` — P1.3's
   transactional route accepts no inline source. Decision 2's "thin schema/validation layer
   over the existing transactional route; no new backend endpoint needed" therefore holds only
   for the `sourceId` arm. The plan is silent on how the inline arm works and, critically, on
   its failure semantics: a client-side create-source-then-create-pipeline sequence is **not**
   transactional and leaves an orphaned data source when the pipeline create fails — the exact
   orphan-accumulation problem this epic exists to remove. Fix: state in `design.md` which it
   is — (a) MCP-side two-call with defined compensating cleanup on failure, or (b) extend the
   backend request shape (which contradicts the planner's own self-approved "no new backend
   routes" note and per that note is escalation-worthy) — and give task 3.2 the failure
   semantics as an explicit sub-item.

3. **Grounding for source-attached Outputs (`nodeStepId = null`) is unspecified.**
   `schemas/outputs/output.schema.json` declares `"nodeStepId": {"type": ["string","null"]}`
   and lists it as required — a null node (Output on the source itself) is a legal, shipped
   state. `PipelineAnalyzeService.analyzeNodes`' own scaladoc (:170-174) says the source's
   schema "is `sourceSchema`, **not present in the map** — callers needing the source's own
   projection use `sourceSchema` directly". Task 1.4 says only "per-node projected schema via
   `PipelineAnalyzeService` (not the trunk)", so a literal implementation does a map lookup
   that misses and either 404s or (worse) silently falls back to the trunk — reintroducing the
   exact bug AC 5.4 is meant to prevent, on a path 5.4 does not cover. Fix: task 1.4 must state
   that `nodeStepId = null` grounds against `sourceSchema`, and task 5.4 should add that arm.

### Non-blocking notes

- `design.md` Context calls `write.ts` "~2800+ lines per HEL-882/658"; it is **1241** lines
  (`wc -l`). Doesn't change decision 1, but correct it so the executor doesn't size the
  decomposition against a phantom.
- `specs/mcp-output-tools/spec.md` says `add_output` goes over "`POST/PATCH/DELETE
  /api/outputs`". Create is actually `POST /api/pipelines/:id/outputs`
  (`OutputRoutes.scala:31-41`); only PATCH/DELETE/GET are on `/api/outputs/:id`.
- `proposal.md`'s absorbs list omits **HEL-670** and **HEL-829**, though `tasks.md` 1.6 and
  1.8 both act on them and the spec's P1.4 row lists HEL-670. Align the lists.
- Section placement nits: task 1.8 (proposal-review UI loose ends, HEL-848 — verified in Linear
  as well-specified and dereferenceable) sits under "Backend", and task 4.2
  (`replace_dashboard_contents`/`auto_layout_dashboard`, both MCP tools registered in
  `write.ts`) sits under "Frontend". Cosmetic, but the cycle-planning reads off these headings.
- Unowned vestige: `WorkspaceSearchService.scala:34-128` still exposes a
  `WorkspaceResourceType.DataType` wire string backed by `outputRepo` (P1.1 retargeted the
  backing store but kept the name), and `ProposalPanelSupport.scala` still carries 26
  `dataTypeId` references. The spec's Retirements section assigns "the DataType/Metric branches
  of `WorkspaceSearchService`" to the row that removes the feature; no task here claims it.
  Worth an explicit in-scope/out-of-scope line rather than leaving it to discovery.
