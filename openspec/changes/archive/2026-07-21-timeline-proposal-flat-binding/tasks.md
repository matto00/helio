## 1. Backend — proposal contract + derivation

- [x] 1.1 Add `sort: Option[String]` to `ProposalPanel` (`DashboardProposalProtocol.scala`) with
      read/write handling matching the other optional string fields.
- [x] 1.2 Add `RequestValidation.validateTimelineSort(sort: Option[String])` backed by
      `TimelineOptions.ValidSorts` (reference the set, no duplicated literal).
- [x] 1.3 In `DashboardProposalService.validatePanel`, validate `sort` for `type == "timeline"` via
      `validateTimelineSort`, so a bad value fails `validateStructure` before any creation.
- [x] 1.4 In `DashboardProposalService.buildDataConfig`, when `type == "timeline"` and `sort` is
      defined, nest it as `timelineOptions -> { sort }` in the derived config (leave `mergeConfig`
      untouched so explicit `config` still wins).

## 2. Contract + MCP surface

- [x] 2.1 Add the optional `sort` property (`enum: ["asc","desc"]`, description) to
      `schemas/dashboard-proposal.schema.json` `ProposalPanel`; update the `config` description so it
      no longer implies `config` is required for timeline sort.
- [x] 2.2 Add `sort` to the `ProposalPanel` interface in `helio-mcp/src/types.ts`.
- [x] 2.3 Add `sort: z.enum(["asc","desc"]).optional()` to `panelSchema` in
      `helio-mcp/src/tools/proposal.ts` and update the `timeline` bullet in the `propose_dashboard`
      description to present `sort` as a flat field (note `config.timelineOptions` overrides).

## 3. Tests

- [x] 3.1 `DashboardApplyProposalSpec`: timeline panel with `dataTypeId` + `{time,event}`
      `fieldMapping` and no config → bound timeline panel, `sort` resolves to `"asc"`.
- [x] 3.2 `DashboardApplyProposalSpec`: timeline panel with flat `sort: "desc"` →
      `config.timelineOptions.sort == "desc"`.
- [x] 3.3 `DashboardApplyProposalSpec`: timeline panel with invalid `sort` → 400, no dashboard
      created.
- [x] 3.4 `DashboardApplyProposalSpec`: flat `sort` + `config.timelineOptions.sort` → explicit
      config wins.
- [x] 3.5 `DashboardProposalProtocolSpec`: `sort` round-trips through read/write (present and
      absent).

## 4. Verify gates + end-to-end

- [x] 4.1 Run gates: `sbt test`, `npm run check:schemas`, helio-mcp build (`npm run build` in
      `helio-mcp/`), root `npm run lint`/`format:check`.
- [ ] 4.2 Live round-trip: start backend+frontend, apply a proposal (via API/MCP path) that produces
      a bound, rendering Timeline panel with a non-default `sort`; confirm the in-app Proposal Review
      UI round-trips it.
- [x] 4.3 Write `files-modified.md` handoff and commit (`HEL-321 ...`).
