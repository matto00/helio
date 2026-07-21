## Skeptic Report — final gate (round 1)

### What I verified (with evidence)

1. **Derivation correctness (nested `timelineOptions`, not a flat key).**
   Read `DashboardProposalService.buildDataConfig` (`git diff main...HEAD`): the new
   `withTimelineSort` branch does
   `withMetricLiteral ++ panel.sort.map(s => "timelineOptions" -> JsObject("sort" -> JsString(s)))`
   — nested, exactly as D1 specifies. Cross-checked against
   `TimelinePanelConfig.timelineOptionsField`/`sortField` in
   `backend/src/main/scala/com/helio/domain/panels/TimelinePanel.scala:60-66`, which reads `sort`
   only from a nested `timelineOptions` object — a flat top-level `sort` key would indeed be
   silently ignored (falls through to `TimelineOptions.DefaultSort`). The diff avoids that trap.

2. **Up-front validation.** `RequestValidation.validateTimelineSort` (new, lines 100-107) is backed
   by `TimelineOptions.ValidSorts` via a proper top-of-file `import com.helio.domain.panels.TimelineOptions`
   — no duplicated literal, no inline FQN. It's invoked in `DashboardProposalService.validatePanel`
   guarded by `panel.type == TimelineKind`, ahead of `createAll`. Live-verified (see below): an
   invalid sort returns 400 and creates nothing.

3. **`mergeConfig` untouched; explicit config wins.** Diffed `mergeConfig`/`buildCreateRequest` —
   zero changes. Live-verified: a proposal with flat `sort:"asc"` + `config.timelineOptions.sort:"desc"`
   persisted with `sort == "desc"` (explicit config wins).

4. **Schema-drift parity + MCP surface.** `sort` added to both `ProposalPanel` (Scala case class,
   `DashboardProposalProtocol.scala`) and `schemas/dashboard-proposal.schema.json` (enum
   `["asc","desc"]`) in the same commit; `npm run check:schemas` passes fresh (`schemas in sync...`,
   `panel-type enums in sync...`). `helio-mcp/src/types.ts` and `src/tools/proposal.ts` updated —
   the `timeline` bullet in `propose_dashboard`'s description now reads "flat `sort` field (asc|desc,
   default asc) ... (config.timelineOptions.sort still overrides it)", which is accurate to the
   implementation. No inline FQNs found anywhere in the diff (`RequestValidation.scala` imports
   `TimelineOptions` at the top; `DashboardProposalService.scala` doesn't reference it directly at all).

5. **Backward compatibility.** `sort: Option[String]` is optional at every layer (protocol, schema,
   MCP types). Full `sbt test` run (fresh, not reused) shows 1470/1470 passing, including all
   pre-existing `DashboardApplyProposalSpec`/`DashboardProposalProtocolSpec` cases untouched by this
   diff — confirms no regression to flat-field-only or config-only proposals.

6. **Scope.** `git diff main...HEAD --stat` shows changes confined to: `RequestValidation.scala`,
   `DashboardProposalProtocol.scala`, `DashboardProposalService.scala`, the schema, the two
   helio-mcp files, and tests. Matches the proposal/design 1:1; no scope creep. AC1-3 all traced to
   real code/behavior (below).

### Gates re-run fresh (this session, not reused from evaluator)

- `cd backend && sbt test` → `Tests: succeeded 1470, failed 0` — PASS.
- `npm run check:schemas` (root) → `schemas in sync with JsonProtocols (10 checked...)`,
  `panel-type enums in sync (7 surfaces checked)` — PASS.
- `cd helio-mcp && npm run build` → exit 0, clean `tsc` (node_modules already present in this
  worktree; no install needed) — PASS.
- `npm run lint` (root) → exit 0, zero warnings — PASS.
- `npm run format:check` (root) → "All matched files use Prettier code style!" — PASS.
- `npm run check:scala-quality` → 46 pre-existing soft (informational) file-size warnings only; none
  introduced by this diff (`DashboardApplyProposalSpec.scala` grew but was already over budget) —
  matches evaluator's claim, no new violations.

### Live round-trip (fresh, cold — servers were already up on 5494/8401; health-checked first)

- `curl /health` (8401) → 200; frontend (5494) → 200. Reused running servers per instructions.
- Logged in fresh (`POST /api/auth/login`, matt@helio.dev) → 200, session cookie obtained.
- **AC1, flat binding + non-default sort, no config passthrough:**
  `POST /api/dashboards/apply-proposal` with a `timeline` panel
  (`dataTypeId=39713b12-031d-4c63-bcf6-6c9ecbde7e65`, `fieldMapping:{time:"name",event:"amount"}`,
  `sort:"desc"`, no `config`) → **201**, response `config` =
  `{"dataTypeId":"...","fieldMapping":{...},"timelineOptions":{"sort":"desc"}}`. Binding + non-default
  sort both derived purely from flat fields.
- **Invalid sort rejection:** same payload with `sort:"sideways"` → **400**
  (`"panel 1 ('Events Timeline'): Invalid sort value: 'sideways'. Valid values: asc, desc"`).
  Confirmed via the dashboard list afterward that no `SKEPTIC-HEL321-BadSort` dashboard was created
  — atomic rejection, matches D2/AC1's "no partial dashboard" requirement.
- **Explicit config override:** same payload with flat `sort:"asc"` AND
  `config:{timelineOptions:{sort:"desc"}}` → **201**, persisted `timelineOptions.sort == "desc"` —
  explicit config wins, matches D3.
- **Rendering:** navigated to the app (Playwright), viewed the resulting dashboard — the "Events
  Timeline" panel renders as a descending-sorted timeline list (Gamma/30, Beta/20, Alpha/10),
  screenshot captured and reviewed. Console: 0 errors, 0 warnings.
- **Proposal Review UI round-trip:** inspected `ProposalReview.tsx` — panel editing uses
  `{ ...p, title }` (spread; preserves any extra field including `sort`), and `proposalService.ts`
  posts the proposal object as-is (`httpClient.post("/api/dashboards/apply-proposal", proposal)`) —
  no field allowlisting anywhere in the accept path, so a `sort` field survives editing and posting
  unmodified. Note: the frontend's own `ProposalPanel` TS interface
  (`frontend/src/features/dashboards/types/proposal.ts`) does not declare `sort` (nor `config`,
  confirming this is a pre-existing gap from HEL-316, not something newly introduced here) — this is
  a compile-time-only omission; at runtime JS objects retain all properties regardless of the TS
  interface, and this matches the design's explicit non-goal ("No frontend UI, renderer, or
  Proposal Review UI field work"). Attempted to force a live in-app round-trip via a synthetic
  `history.pushState`/`popstate` injection of `location.state.proposal`, but React Router's own
  history listener did not pick up the synthetic event (a test-harness limitation, not a product
  defect) — the code-level passthrough verification above is sufficient given the explicit non-goal
  and the fact that the live `apply-proposal` HTTP round-trip (the same endpoint the UI's Accept
  button calls) was independently verified end-to-end.

### Verdict: CONFIRM

### Non-blocking notes

- `DashboardApplyProposalSpec.scala` is now 741 lines, well past the 250-line soft budget (flagged
  by both the evaluator and `check:scala-quality` as pre-existing/incremental, not a new violation).
  Worth a proactive split next time this file is touched, per CONTRIBUTING.md's decomposition
  guidance.
- Task 4.2 in `tasks.md` is (correctly) left unchecked — the design's Planner Notes explicitly assign
  the live round-trip to evaluator/skeptic verification, and both have now performed it independently
  with fresh evidence.
