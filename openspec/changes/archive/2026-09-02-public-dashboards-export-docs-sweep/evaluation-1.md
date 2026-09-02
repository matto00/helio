# Evaluation Report — Cycle 1 (evaluation-1.md)

Ticket: HEL-910 (P1.7, last row of HEL-903). Reviewed `git diff main...HEAD` (107 files),
all planning artifacts, and re-derived every gate/claim independently.

## Phase 1: Spec Review — PASS

Verified against the ticket ACs, `design.md` (4 rounds), `tasks.md`, and the spec deltas.

- Public read path AC — **verified live**, not from the route spec. See Phase 3.
- Export/import AC — **verified live** (round-trip + named-error rejection). See Phase 3.
- Docs AC — `README.md` "How data flows", `CLAUDE.md` endpoint list, `docs/agent-native.md`
  updated; `check:openspec` green (re-run by me).
- Rebuild-scripts AC — helio-news commits `e6f2b39`/`a9b693b` recorded with an explicit,
  honest reason for not running live (prod `HELIO_API_BASE_URL` default); delivery-analytics
  script explicitly recorded as not found. Both stated, neither silently skipped.
- E2E AC — **verified by running the spec myself** (see Phase 3). The 28-vs-≤12 finding is
  honestly and accurately documented; I independently confirmed both load-bearing claims in the
  header comment: `OutputEditorSheet.tsx:125` and `:137` do hardcode/re-seed `kind` to
  `"chart"`, and `TableKindFields` (`OutputKindFields.tsx:125-141`) has no required selects.
  HEL-942 follow-up + HEL-941 (viewer UI) both recorded.
- `openspec validate --type change ... --strict` → valid. All `tasks.md` items checked off and
  matching what is actually implemented.
- Spec-delta triage (task 3.6) spot-checked as requested. Every live `openspec/specs/**` file
  carrying a swept identifier has a delta except `pipeline-run-execution`, whose single hit
  (`spec.md:167`) is explicitly historical prose ("removed by HEL-904/HEL-891") and fits
  allowlist clause (iii). REMOVED-vs-MODIFIED calls verified against the live tree:
  - `chart-type-display-config`, `table-panel-*`, `timeline-panel-type`, `collection-panel-type`
    REMOVED — correct: `backend/.../domain/panels/` now contains only Divider/Image/Markdown/
    Output/Text; the chart/table/timeline/collection panel kinds are genuinely gone.
  - `mcp-metric-tools` REMOVED — correct: `helio-mcp/src/context.ts` has no `metrics` field
    (only two historical comments), and the metric tools appear only in `server.test.ts`'s
    `REMOVED_TOOLS` absence-assertion list.
  - `markdown-panel` REMOVED (the *bound* Source-mode requirement only, not the capability) —
    correct: no `DataTypePicker` renders anywhere in `frontend/src`.
- No scope creep found; the HEL-940 fold-in is within the sweep the ticket already required.

## Phase 2: Code Review — FAIL

### Gates (all re-run by me, fresh, in `WORKTREE_PATH`)

| Gate | Result |
|---|---|
| `npm run lint` | PASS (0) |
| `npm run format:check` | PASS (0) |
| `npm run typecheck` | PASS (0) |
| `npm test` | PASS — 252 suites, 2591 tests |
| `npm --prefix frontend run build` | PASS |
| `cd backend && sbt test` | PASS — 3555 tests, 237 suites, 0 failed |
| `check:schemas` / `check:openspec` / `check:spec-structure` / `check:scala-quality` / `check:e2e-types` / `check:helio-mcp-types` / `check:repo-integrity` | all PASS |
| `openspec validate --strict` | valid |

### Code quality — good

`PublicDashboardRoutes.resolveRows` correctly resolves the panel through
`findAllByDashboardId` (so the dashboard-level ACL is a valid authority for the panel read) and
degrades gracefully rather than 500-ing. `DashboardService.validateImportPanels` validates
before any repo write, reuses the same `PanelConfigCodec` / `Panel.validateConfig` /
`resolveCreateAppearance` path panel-create uses, and fails on the first bad entry.
`PublicPathRlsSmokeSpec` is a genuine red-before-trusted guard: it proves the owner-positive
assertion itself flips when `outputs_select`/`node_snapshots_select` are dropped on a disposable
instance — not a vacuously-empty assertion. The `dataTypeId → outputId` rename is a clean,
complete mechanical rename on every surface I checked.

### Sweep re-run (task 7.2) — NOT clean

I re-ran all 12 patterns across all 8 named directories myself. All hits fall under Decision 6's
allowlist **except two live-code classes**, both of which are dead code, and both accompanied by
comments that make confidently-false liveness claims:

**A. `outputDataTypeId` — dead chain in `frontend/src`, with a false comment.**
`frontend/src/features/pipelines/types/pipelineStep.ts:466` (`Pipeline.outputDataTypeId`) and
`:482` (`PipelineSummary.outputDataTypeId`), read only by
`frontend/src/features/pipelines/state/pipelinesSlice.ts:627-628`
(`selectPipelineNameByOutputTypeId`). `grep -rn selectPipelineNameByOutputTypeId frontend/src`
returns **zero non-test consumers** — the selector's only occurrences are its own definition and
two comments. No backend protocol emits `outputDataTypeId` (`grep -rn outputDataTypeId
backend/src/main` returns comments only). The whole chain is dead by construction.
The comment at `pipelineStep.ts:476-481` asserts the field is "still read by the legacy
DataType-bound panel-creation wizard's provenance map (`selectPipelineNameByOutputTypeId`,
HEL-937)" — that is **false against the live tree**; nothing reads that selector. This is
exactly the same class of dead field the executor already removed in this ticket
(`PipelineAnalyzeResponse.outputDataTypeName`/`outputDataTypeId`), so keeping this one is
internally inconsistent.

**B. `metricId` — a live-but-never-applied wire field across four layers, plus three stale
comments.** `DashboardProposalProtocol.scala:22` (field), `:70` (encode), `:94` (decode);
`AssistantProposalToolSchemas.scala:60` (advertised in the Claude tool schema);
`schemas/dashboards/dashboard-proposal.schema.json:41-44`; `helio-mcp/src/types.ts:512`.
I confirmed the value is decoded and then **discarded** — no `metricId` read exists in
`ProposalPanelSupport` or `DashboardProposalService` (only comments). This is precisely the
kind of shim Decision 11 forbids, and Decision 6 states everything outside its four clauses
"must be renamed, not allowlisted". Three comments actively mis-describe it as live:
- `DashboardProposalProtocol.scala:15-19` — "binds the panel to a defined metric
  (`metric`/`chart`/`table` panels only) ... outputId stays required for these panel kinds" —
  those panel kinds do not exist.
- `ApiRoutes.scala:247-248` — "HEL-549: metricRepo threaded in the same nullable-optional way ...
  only touched when a proposal panel actually carries a metricId" — there is no `metricRepo`;
  the argument at `:249` is `outputRepoOpt.orNull`.
- `ProposalPanelSupport.scala:50` — "THEN (HEL-549) that a panel carrying a `metricId` resolves".

Neither class is recorded anywhere in this change as an accepted allowlist exception, so the
sweep as delivered does not meet the ticket's headline AC.

## Phase 3: UI Review — PASS

Servers: `start-servers.sh` reported **"already healthy, reusing"** for a backend started at
09:56:44, i.e. **before this branch's first commit (10:11:28)**. That stale server returned
`401 Unauthorized` for the new rows route (identical to a nonexistent path), while the
pre-existing anon panel-list route returned a correct `404`. I killed it and restarted from the
commit under test; every result below is against the correct build. (Process note for the
orchestrator, not a code defect — but it means any executor evidence gathered before ~10:15
should be treated as unverified.)

**Public read path — verified end-to-end with curl (not just the route spec):**
- Anonymous, non-shared dashboard → `404 {"message":"Dashboard not found"}` (denied).
- After inserting a public viewer grant (`resource_permissions`, `grantee_id IS NULL`,
  `role='viewer'`), anonymous `GET /api/dashboards/7f5c7bf9…/panels/139b31ad…/rows?limit=2` →
  `200 {"items":[{"amount":10.0,"name":"Alpha"},{"amount":20.0,"name":"Beta"}],"total":3}`.
- Panel not on that dashboard → `404 "Panel not found"`; non-output panel → empty page, `200`
  (not a 500); `offset=-1` → `400`.
- Probe grant deleted afterward; re-confirmed the route returns `404` again. Shared dev DB clean.

**HEL-940 wire compatibility — verified live, not by per-side test suites:**
- `POST /api/dashboards/apply-proposal` with `{"outputId": "hel904-output-2664…"}` → `201`,
  persisted as `config.outputId`.
- The same request with the **old** `dataTypeId` key → `400 "panel 1 ('Probe'): a output panel
  requires a outputId"` — rejected loudly, no silent half-rename. Frontend `proposal.ts:25`,
  backend `ProposalPanel.outputId`, `dashboard-proposal.schema.json`, and `helio-mcp/src/types.ts`
  all agree on `outputId`.

**Export/import — verified live:** export → import round-trip reproduced the dashboard (panels,
layout, appearance, remapped layout panelIds). Import with a fabricated `outputId` →
`400 "panel '8f487622…': outputId 'does-not-exist-xyz' not found"` and **created nothing**
(confirmed by listing dashboards afterward). All probe dashboards deleted.

**E2E spec — run by me** (`DEV_PORT=6342 npx playwright test
e2e/hel910-pipeline-to-dashboard-flow.spec.ts`): **2 passed**, printing
`HEL-910 flow: 28 interactions` and `HEL-910 existing-Output placement: 2 interactions` —
exactly the documented figures. Scenario 2 meets its ≤2 AC exactly. Scenario 1's ≤30 assertion
is a real (if loose) regression guard against the freshly measured 28. CI wiring confirmed in
`.github/workflows/ci.yml`, with an honest correction of the Sleeper-MCP assumption.

**Browser smoke:** `/login`, `/` (dashboards), `/pipelines` all render; **zero console errors or
warnings**. No visual/CSS changes in this diff (frontend changes are field renames plus a dead
type removal), and the e2e specs drive the real create-source → pipeline → outputs → dashboard
UI, so no design-token/shared-component regression surface was introduced.

## Overall: FAIL

Everything substantive works and is independently proven. The failure is confined to the
ticket's own headline deliverable — the sweep is not clean — and to three comments that assert
things the live tree contradicts. Both change requests are small and self-contained.

## Change Requests

1. **Remove the dead `outputDataTypeId` chain in the frontend** (same reasoning already applied
   in this ticket to `PipelineAnalyzeResponse.outputDataTypeName`/`outputDataTypeId`):
   delete `Pipeline.outputDataTypeId` (`frontend/src/features/pipelines/types/pipelineStep.ts:466`),
   `PipelineSummary.outputDataTypeId` (`:482`) together with its false comment at `:476-481`,
   and `selectPipelineNameByOutputTypeId`
   (`frontend/src/features/pipelines/state/pipelinesSlice.ts:601, 622-630`) — the selector has
   zero non-test consumers, so nothing depends on it. Drop the now-invalid fixture fields in
   the test files that set it (`PanelList.test.tsx:120`, `PipelineListTable.test.tsx:13`,
   `CreatePipelineModal.test.tsx:64`, `PipelinesPage.test.tsx:29,40,205`,
   `PipelineProposalReviewPage.test.tsx:49`, `PipelineDetailPage.test.tsx:2509`,
   `combinedProposalsSlice.test.ts:38`, `CombinedProposalReviewPage.test.tsx:63`,
   `SidebarBody.test.tsx:45,177`, `App.test.tsx:642`, and the two
   `pipelinesSlice.test.ts` selector tests at `:1173-1192`). If HEL-937 genuinely needs the
   field back later it can reintroduce it; shipping a dead field whose comment claims it is
   live is the worst of both.

2. **Resolve `metricId` — either delete it or record it as an explicit allowlist clause.**
   Preferred: delete the decoded-but-discarded field end-to-end —
   `DashboardProposalProtocol.scala:22, 70, 94`, `AssistantProposalToolSchemas.scala:60`,
   `schemas/dashboards/dashboard-proposal.schema.json:41-44`, `helio-mcp/src/types.ts:512`
   (and the `ProposalPanel` doc-block bullet at `types.ts:475`) — since nothing reads it.
   If it is deliberately retained for wire stability, that is a defensible call, but it must be
   written down: add it to `design.md` Decision 6 as an explicit fifth allowlist clause
   ("legacy decoded-but-never-applied proposal wire fields retained for schema stability"),
   name every file it covers, and say so in the PR's pasted sweep output.
   **Either way**, fix the three comments that describe it as live:
   - `backend/.../protocols/proposals/DashboardProposalProtocol.scala:15-19` (cites
     `metric`/`chart`/`table` panel kinds and `MetricPanelConfig`/`ChartPanelConfig`/
     `TablePanelConfig`, none of which exist).
   - `backend/.../api/ApiRoutes.scala:247-248` ("metricRepo threaded in ... only touched when a
     proposal panel actually carries a metricId" — the argument is `outputRepoOpt.orNull`; there
     is no `metricRepo`).
   - `backend/.../services/proposals/ProposalPanelSupport.scala:50` ("a panel carrying a
     `metricId` resolves").

## Non-blocking Suggestions

- `PublicDashboardRoutes.scala:90` — `paged.copy(items = paged.items.map(identity[JsValue]))`
  is a no-op map; `paged` can be returned directly (the items are already `JsValue`).
- `e2e/hel910-pipeline-to-dashboard-flow.spec.ts:26` — stray `///` (triple slash) mid-comment,
  should be `//`.
- `DashboardService.validateImportPanels` constructs a throwaway panel with
  `DashboardId("")` and a random `PanelId` purely to reach `.validateConfig`. It works and is
  the cheapest route given Decision 5's constraints, but a one-line comment saying those two ids
  are validation-only placeholders would stop a future reader from thinking they leak.
- Unrelated stray probe data exists on the shared dev DB from an earlier evaluation
  (a dashboard named `HEL909-EVAL4-clobber`). Not this ticket's, but worth sweeping.
