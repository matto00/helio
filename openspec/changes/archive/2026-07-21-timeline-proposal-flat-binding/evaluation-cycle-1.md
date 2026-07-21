## Evaluation Report — Cycle 1

### Phase 1: Spec Review — PASS
Issues: none.

- AC1 (flat binding + non-default sort applies without generic `config` passthrough): verified live —
  `POST /api/dashboards/apply-proposal` with `{"type":"timeline","dataTypeId":..., "fieldMapping":{"time":"name","event":"amount"}, "sort":"desc"}` and **no `config` block** returned `201` with
  `config.timelineOptions.sort == "desc"` and the binding intact; panel rendered in the dashboard UI
  sorted descending (Gamma/Beta/Alpha). Also covered by the new `DashboardApplyProposalSpec` tests
  (flat-only defaulting to `asc`, flat `sort:"desc"`, invalid `sort` rejected pre-create, explicit
  `config` override).
- AC2 (helio-mcp docs/enums accurate): `proposal.ts` `panelSchema.sort` enum added, `timeline` bullet
  in `propose_dashboard` description rewritten to present `sort` as a flat field noting
  `config.timelineOptions` still overrides; `types.ts` `ProposalPanel.sort` documented. Matches design D4.
- AC3 (backward-compatible; gates green): re-ran fresh — `sbt test` 1470/1470 passed;
  `npm run check:schemas` green (schema/case-class + panel-enum parity); `helio-mcp` `npm run build`
  (`tsc`) exit 0; root `npm run lint` (0 warnings) and `npm run format:check` clean. No behavior
  change for proposals without `sort` (mergeConfig/derivation path unchanged for other fields).
- Task list: all backend/contract/test tasks (1.x–3.x) done and match the diff. Task 4.1 done (gates).
  Task 4.2 (live round-trip) was explicitly left unchecked by the executor per the design's Planner
  Notes ("Verification ... must include a live apply_proposal round-trip ... per the ticket's
  verification clause and AC1" — assigned to evaluator/skeptic); I completed it above, so this is not
  a deficiency, just division-of-labor as planned.
- No scope creep: diff is limited to the `sort` field end-to-end (protocol, validation, service
  derivation, schema, MCP surface, tests). `mergeConfig` and all other flat-field derivations
  (metric `label`/`unit`, collection, etc.) are untouched.
- No regressions: full `sbt test` suite (1470 tests, unchanged count of failures = 0) passed, including
  all pre-existing `DashboardApplyProposalSpec`/`DashboardProposalProtocolSpec` cases.
- Schema/contract: `sort` added to both `ProposalPanel` case class and
  `schemas/dashboard-proposal.schema.json` in the same commit — `check:schemas` confirms parity.
- Planning artifacts (proposal/design/tasks/spec delta) match the implemented behavior exactly —
  D1–D4 in design.md are each reflected 1:1 in the diff (flat field nests into `timelineOptions`,
  not a flat key; validation via `RequestValidation.validateTimelineSort` referencing
  `TimelineOptions.ValidSorts`; `mergeConfig` untouched; MCP surface updated).

### Phase 2: Code Review — PASS
Issues: none.

- **Imports/qualifiers (CONTRIBUTING.md mechanical rule)**: `RequestValidation.scala` adds a proper
  top-of-file `import com.helio.domain.panels.TimelineOptions` (line 3) — no inline FQN introduced.
  Ran `npm run check:scala-quality` fresh: reports only pre-existing informational file-size soft
  warnings (none touching the files this change modifies at a new-violation level); no inline-FQN
  failures. Confirms mechanical compliance.
- **File-size budgets**: `DashboardApplyProposalSpec.scala` was already over the ~250-line soft budget
  before this change and remains a soft (informational) warning only, consistent with existing
  practice on that file (not a new violation introduced by this diff, and it's a test file explicitly
  exempted from hard-fail treatment by the quality script).
- **DRY**: `validateTimelineSort` reuses `TimelineOptions.ValidSorts` (no duplicated literal — matches
  the design's explicit rejection of "duplicate the literal"). `buildDataConfig`'s new branch follows
  the exact pattern of the existing `metric`-only `label`/`unit` branch (`withMetricLiteral`), so no
  new abstraction was introduced where the existing fold pattern already fit.
- **Readable / modular**: `TimelineKind` constant added alongside the existing `MetricKind`,
  `DataPanelKinds` companion-object constants — consistent naming, no magic strings. Validation is
  gated by `panel.type == TimelineKind` exactly as `chartType`/`orientation` are gated by their types.
- **Type safety**: `sort: Option[String]` on the wire (matches how `chartType`/`orientation`/`label`/
  `unit` are all typed as `Option[String]` at the proposal-protocol layer, with strict enum
  validation happening in `RequestValidation`/`decodeCreate` rather than the wire type) — consistent
  with existing conventions, not a new escape hatch.
- **Error handling**: invalid `sort` fails `validatePanel` (`validateStructure`) before any
  dashboard/panel creation — verified this is a genuine pre-create rejection via the
  `DashboardApplyProposalSpec` "reject a timeline panel with an invalid flat sort and create nothing"
  test (400, `dashboardCount()` unchanged) and it passed.
- **Tests meaningful**: 4 new `DashboardApplyProposalSpec` tests + 5 new
  `DashboardProposalProtocolSpec` tests exercise every scenario in the spec delta (flat-only default,
  flat `sort:"desc"`, invalid-sort rejection with atomicity check, explicit-config-wins, and
  read/write round-trip parity). These would catch a real regression — e.g. reverting the
  `buildDataConfig` nesting to a flat key would fail the "derive config.timelineOptions.sort" test
  since `TimelinePanelConfig.decodeCreate` only reads the nested path.
- **No dead code**: no leftover TODO/FIXME; no unused imports introduced.
- **No over-engineering**: change is a single optional field threaded through the existing
  flat-field-derivation pattern — no new abstraction layer.
- **Behavior-preserving**: `mergeConfig` diff-verified untouched; confirmed a proposal with no `sort`
  produces byte-for-byte the same derived config as before (existing HEL-316 regression test still
  passes unchanged).
- **helio-mcp**: `proposal.ts`/`types.ts` changes are documentation/schema-only, consistent with the
  advisory nature called out in D4; `tsc` build is clean.

### Phase 3: UI Review — PASS
Issues: none.

Trigger: `schemas/dashboard-proposal.schema.json` changed → Phase 3 required (even though no
`frontend/**` files changed).

Dev server setup: `scripts/concertino/start-servers.sh` initially reported backend healthy but
**frontend failed** (`vite: command not found` — `frontend/node_modules` was absent in this worktree).
This is an environmental gap, not a code issue (no `frontend/**` files are touched by this change).
Ran `npm install` in `frontend/`, then `start-servers.sh` succeeded (`READY backend=...`,
`READY frontend=...`); `assert-phase.sh servers` returned `PASS servers`.

Live round-trip (fresh evidence, not reused from executor's report):
- Logged in via `POST /api/auth/login` (matt@helio.dev), obtained session cookie.
- Found a pipeline-output DataType in the dev workspace (`skeptic-output`,
  `39713b12-031d-4c63-bcf6-6c9ecbde7e65`, no `sourceId`).
- `POST /api/dashboards/apply-proposal` (with the required `X-Helio-Requested-With: 1` CSRF header) with
  a `timeline` panel: `dataTypeId` + `fieldMapping:{time:"name",event:"amount"}` + flat `sort:"desc"`,
  **no `config` block** → `201 Created`; response panel `config` =
  `{"dataTypeId":"39713b12-...","fieldMapping":{"event":"amount","time":"name"},"timelineOptions":{"sort":"desc"}}`.
  Confirms AC1 end-to-end: binding + non-default sort both derived from flat fields alone.
- Opened the dashboard in-app via Playwright (`http://localhost:5494`): the new dashboard
  "HEL-321 Eval Timeline" loaded automatically with one panel, "Events Timeline", rendering a
  timeline list sorted descending by the mapped `time` field: Gamma(30), Beta(20), Alpha(10) —
  correct behavior for `sort:"desc"` on string values.
- Console messages: 0 errors, 0 warnings across the session (login, dashboard load, resize).
- Resized to 1440 and 768: no layout breakage observed; panel and chrome render correctly at both.
- No PAT/MCP-tool round-trip was separately exercised (the HTTP path IS the path `apply_proposal`
  ultimately calls; the mcp build/typecheck confirms the tool surface compiles) — sufficient given
  AC1's explicit ask is the apply-proposal application behavior, which was verified directly.

Screenshots/snapshots were written by the Playwright MCP tool to the repo's gitignored
`.playwright-mcp/` directory (tool-enforced allowed-roots restriction prevented writing to the
session scratchpad); confirmed via `git check-ignore` that this directory is excluded from git
tracking, so no stray files entered the change.

### Overall: PASS

### Change Requests
None.

### Non-blocking Suggestions
- `DashboardApplyProposalSpec.scala` is now 741 lines (well past the ~250-line soft budget, though
  this predates this change and only grew incrementally by 93 lines here). Not a blocker, but a good
  candidate for a future split (e.g. by feature area: HEL-316 passthrough tests vs. HEL-321 timeline
  tests) per CONTRIBUTING.md's proactive-decomposition guidance, whenever this file gets touched next.
