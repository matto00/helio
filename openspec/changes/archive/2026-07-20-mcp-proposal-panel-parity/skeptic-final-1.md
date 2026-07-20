## Skeptic Report — final gate (round 1)

### What I verified (with evidence)

- **Ground truth diff**: `git diff main...HEAD` (18 files, 829/-17) on commit
  `b3d66d4c`, branch `task/mcp-proposal-v15-panel-parity/hel-316`.
- **Mechanical gates re-run fresh, all green**:
  - `node scripts/check-schema-drift.mjs` → `schemas in sync ...` / `panel-type
    enums in sync ... (7 surfaces checked)`.
  - `cd helio-mcp && npm run build` → clean `tsc` compile.
  - `cd backend && sbt "testOnly com.helio.api.DashboardApplyProposalSpec
    com.helio.api.protocols.DashboardProposalProtocolSpec"` → 37/37 passed.
- **`mergeConfig` logic for the "bound trio + collection" (D2/D3)** —
  `DashboardProposalService.scala:184-199` re-applies `panel.dataTypeId` (the
  flat field) *after* the merge whenever it is `Some`. Confirmed correct and
  covered by a real regression test
  (`DashboardApplyProposalSpec.scala:506-525`, "keep the flat dataTypeId
  authoritative when config attempts to override it").
- **Backward compatibility** — `DashboardApplyProposalSpec.scala:530-551`
  proves a flat-field-only proposal produces byte-for-byte the same config as
  before. Confirmed by reading `mergeConfig`: `(Some(d), None) => Some(d)`,
  a pure no-op when `config` is absent.
- **`check-schema-drift.mjs` carve-out** (point 2 of the brief) —
  `agentFacingPanelTypes = canonicalPanelTypes.filter(t => t !== "divider")`
  is scoped narrowly to exactly the two agent-facing surfaces (the proposal
  schema enum and MCP `PANEL_TYPES`), matches the documented D4 decision
  (drop `divider` from agent-facing surfaces only, keep `PanelType.fromString`
  wire-tolerant), and does not touch the other 5 drift-checked surfaces. This
  is a legitimate, well-scoped accommodation, not a weakening of the guard.
- **DoD / lockstep** — `schemas/dashboard-proposal.schema.json`,
  `helio-mcp/src/types.ts`, and `helio-mcp/src/tools/proposal.ts` all gained
  matching `config` fields/docs and the `collection`-in/`divider`-out enum in
  the same commit; `check-schema-drift.mjs` confirms lockstep across 7
  surfaces.

### V41 safety — **live-reproduced bypass, contradicts the ticket's own documented invariant**

The design (`design.md` D2, the backend doc comment on
`DashboardProposalService`, the JSON-schema `config` field description, and
the MCP tool descriptions in `helio-mcp/src/tools/proposal.ts`) all assert
unconditionally that **"a data panel's `dataTypeId` always stays
authoritative... `config` can never bypass the pipeline-only binding rule
(V41)."** This claim is only true for the four `DataPanelKinds`
(metric/chart/table/collection) — panel types that *require* a flat
`dataTypeId` (`validatePanel`, `DashboardProposalService.scala:76-78`) and
therefore always hit the `mergeConfig` re-apply step
(`dataTypeId match { case Some(id) => ... }`, `DashboardProposalService.scala
:195-198`).

It is **false** for `text`/`markdown` panels. HEL-244 (already on `main`,
independent of this ticket) gave `TextPanelConfig` its own `dataTypeId`
binding field, and this very ticket's own scope statement (`design.md:14`,
ticket.md:13/20) is explicit that "text/markdown DataType binding" is one of
the v1.5 surfaces this change is supposed to make expressible through the
proposal's `config` passthrough. But:

1. `validatePanel` only requires (and only validates) `dataTypeId` for
   `DataPanelKinds` — text/markdown are not in that set
   (`DashboardProposalService.scala:304`), so a text panel's `dataTypeId` is
   never structurally checked.
2. `preValidateBindings` only inspects the **flat** `panel.dataTypeId`
   (`DashboardProposalService.scala:98`) — `None` for a text panel — so the
   pre-flight pipeline-only-binding check (which powers the "reject a
   source-companion DataType" 400 for metric/chart/table/collection) never
   even looks at a `config.dataTypeId` on a text/markdown panel.
3. `mergeConfig` only re-applies/strengthens the flat `dataTypeId` when it is
   `Some` (`DashboardProposalService.scala:195-198`); for a text panel it is
   `None`, so whatever `config.dataTypeId` the caller supplied passes through
   completely unguarded.
4. Even the final layer, `PanelService.create`'s `rejectCompanionBinding`
   (`PanelService.scala:126`), is fed by
   `PanelServiceHelpers.dataTypeIdFromCreateConfig`
   (`PanelServiceHelpers.scala:147-154`), which only extracts `dataTypeId`
   for `MetricCreate`/`ChartCreate`/`TableCreate`/`CollectionCreate` — not
   `TextCreate`/`MarkdownCreate`. (This particular helper is pre-existing,
   untouched by this diff — but this ticket is what newly makes it
   *reachable with attacker-supplied content* through the proposal endpoint,
   since before this diff `ProposalPanel` had no `config` field at all and a
   text panel's config could only ever contain `content`.)

**Live reproduction** against the worktree's running backend
(`localhost:8396`, session-authenticated as `matt@helio.dev`):

```
$ curl -s -b cookies.txt -X POST http://localhost:8396/api/dashboards/apply-proposal \
    -H 'Content-Type: application/json' -H 'X-Helio-Requested-With: 1' \
    -d '{"dashboardName":"Skeptic V41 Text Bypass Probe","panels":[
      {"title":"Rogue Text","type":"text",
       "config":{"dataTypeId":"97513324-0475-4e65-8f5e-3166f520fa7b"}}
    ]}'
HTTP/1.1 201 Created
{"...","panels":[{"config":{"content":"","dataTypeId":"97513324-0475-4e65-8f5e-3166f520fa7b","fieldMapping":{}},"title":"Rogue Text","type":"text",...}]}
```

`97513324-0475-4e65-8f5e-3166f520fa7b` (`skeptic-src`) is a **source-companion
DataType** (`sourceId` set, confirmed via `GET /api/types`) — the exact class
of binding the V41 migration
(`V41__pipeline_only_panel_binding.sql`) and `PanelService.rejectCompanionBinding`
exist to reject. The identical binding attempt on a `metric` panel via
`config.dataTypeId` (the scenario the ticket's own regression test covers) is
correctly rejected with 400; on a `text` panel it is silently accepted and
persisted. (Cleaned up: `DELETE /api/dashboards/687f8ec9-...` → 204.)

This is not a hypothetical or a tooling flake — it is a single deterministic
`curl` call against the code as shipped, and it is `apply_proposal`-reachable
by any MCP client (the tool's own `panelSchema.config` is
`z.record(z.unknown()).optional()` with no server-side check on `text`/
`markdown`'s `dataTypeId`, and `propose_dashboard`'s read-only validation
warnings also only inspect `DATA_PANEL_TYPES` = metric/chart/table/collection,
so an agent gets no warning either).

### Verdict: REFUTE

### Change Requests

1. **Close the V41 gap for `text`/`markdown` `config.dataTypeId` binding.**
   Extend the pipeline-only-binding guard to cover a `text`/`markdown`
   panel's `config.dataTypeId`, both in the proposal path and (since the root
   cause is shared) in `PanelService.create`'s `rejectCompanionBinding` via
   `PanelServiceHelpers.dataTypeIdFromCreateConfig`
   (`PanelServiceHelpers.scala:147-154`, currently `TextCreate`/
   `MarkdownCreate` fall through to `case _ => None`). At minimum, for the
   scope of this ticket: in `DashboardProposalService.preValidateBindings`
   /`validatePanel`, also inspect `panel.config.get("dataTypeId")` for
   text/markdown panels (and any other non-`DataPanelKinds` type whose config
   surface accepts a `dataTypeId`) and apply the same "must be a
   pipeline-output DataType owned by the caller" rule that flat-field data
   panels get.
2. **Add a regression test** mirroring
   `DashboardApplyProposalSpec.scala:506` ("keep the flat dataTypeId
   authoritative...") but for a `text` (and `markdown`) panel binding a
   source-companion DataType via `config.dataTypeId` — it must 400 and create
   nothing, exactly like the existing metric-panel companion-binding test at
   line 252.
3. **Fix (or narrow) the now-false claims** in `design.md` D2/D3, the
   `DashboardProposalService`/`DashboardProposalProtocol` doc comments, the
   JSON-schema `config` field description, and the MCP tool descriptions in
   `helio-mcp/src/tools/proposal.ts` — all currently assert unconditionally
   that "config can never bypass the pipeline-only binding rule (V41)" or
   that "a data panel's dataTypeId always stays authoritative," which is only
   true for `DataPanelKinds`. Once (1) is fixed these can go back to being
   unconditionally true; until then they are inaccurate and would mislead the
   next reader/agent.
4. (Related, pre-existing, **not itself blocking this ticket** since it
   predates this diff — flag for a spinoff ticket) The general
   `PanelService.create` → `rejectCompanionBinding` path already had this
   same hole for any *direct* `POST /api/panels` (or `create_panel` MCP tool)
   call with `type=text`/`markdown` and a companion `dataTypeId` in `config`,
   independent of the proposal flow, since HEL-244. Worth its own ticket once
   (1) lands, to fix it at the shared root (`PanelServiceHelpers.dataTypeIdFromCreateConfig`)
   rather than only at the proposal layer.

### Non-blocking notes

- The `check-schema-drift.mjs` `agentFacingPanelTypes` carve-out (point 2 of
  the brief) is legitimate and narrowly scoped — no concerns there.
- No UI changes in this diff (backend + MCP server only) — design-standard /
  visual review is not applicable to this gate.
