## Context

`collection` became a first-class panel kind in HEL-247 (PR #233). The backend supports it everywhere:
`PanelType` (`backend/.../domain/model.scala:59-91`) parses/serializes `collection`, and
`DashboardProposalService.DataPanelKinds` (line 271) treats it as a data panel (requires `dataTypeId`).
The frontend `PanelKind` union and both `create-panel-request.schema.json` and `panel.schema.json`
already carry it. But three contract surfaces that separately enumerate panel types were never widened,
so an agent following the published contract cannot batch-update or propose collection panels:

- `schemas/update-panels-batch-request.schema.json` items `type` enum — 7 types, missing `collection`.
- `schemas/dashboard-proposal.schema.json` panels `type` enum — 7 types, missing `collection`.
- `helio-mcp/src/tools/proposal.ts` `PANEL_TYPES` (missing `collection`) and `DATA_PANEL_TYPES`
  (missing `collection`, though backend `DataPanelKinds` includes it).
- `frontend/src/features/dashboards/ui/ProposalReview.tsx:29` `DATA_PANEL_TYPES` (missing `collection`;
  used at lines 60/146 to decide whether a proposed panel shows a "needs bound DataType" warning and
  info row). Because this change widens `dashboard-proposal.schema.json` to legally accept a collection
  panel, leaving this gate unfixed means an unbound collection panel in a proposal renders in the
  Proposal Review UI with **no** binding warning — a newly-exposed correctness gap. `helio-mcp/src/tools/write.ts`
  (lines 253/283) also enumerates panel types but already includes `collection` and *intentionally*
  omits `divider` (documented MCP-vs-app divergence) — a deliberate scoped subset, out of guard scope.

`scripts/check-schema-drift.mjs` (`npm run check:schemas`) today validates case-class *field* parity
between schemas and Scala protocols — it does not compare enum *values*, so this drift class is
invisible to CI and recurred silently across HEL-247/HEL-305/HEL-315.

## Goals / Non-Goals

**Goals:**
- Widen every panel-type enum surface to match the backend `PanelType` canonical set.
- Add a durable parity guard so a new panel type must be added to every enum surface or CI fails.
- Cover collection panel creation with a contract-level test/check (AC #3).
- Produce the audit note enumerating every panel-type enumeration site (AC #2).

**Non-Goals:**
- No new collection features (itemOptions seeding, layout polish) — enum parity only.
- No backend/frontend behavior change — both already support `collection` fully.
- No new dependencies (no ajv); extend the existing zero-dep drift checker.

## Decisions

**Canonical source of truth = backend `PanelType`.** The parity check parses the panel-type set from
`PanelType.fromString` cases in `model.scala` (the one place that already lists all 8 with an explicit
error message). Chosen over hardcoding a list in the checker (would itself drift) or over reading a
schema (schemas are the thing being validated). Regex-extract the quoted string literals from the
`fromString` match arms, excluding the `other` fallback.

**Guard both JSON-schema enums and the TS enums in one check.** The four schema `type` enum
locations (create-panel-request, panel, update-panels-batch-request, dashboard-proposal) must equal the
full canonical set. `helio-mcp/src/tools/proposal.ts` `PANEL_TYPES` must equal the full set;
`DATA_PANEL_TYPES` must equal the backend `DataPanelKinds` set (parsed from
`DashboardProposalService.scala:271`). Extending the existing checker keeps one CI gate rather than
adding a second script. Alternative (separate script) rejected — more surface, same parse logic.

**Include the frontend `ProposalReview.tsx` `DATA_PANEL_TYPES` in the same guard (CR2 decision).** It is
the same drift class as helio-mcp's `DATA_PANEL_TYPES` — a bare `new Set([...])` of data-panel kinds —
and the parser already extracts a set literal from a TS file, so covering it costs one more regex target
and closes the exact gap that recurred here. Assert it equals the canonical data-panel set. Rejected
alternative: a targeted `ProposalReview` component test asserting an unbound collection panel surfaces a
warning — narrower, doesn't prevent the *next* panel type from silently skipping the gate, which is the
whole point of the guard. `helio-mcp/src/tools/write.ts` enums stay out of scope (deliberate `divider`
omission would make an exact-match assertion wrong).

**Enum locations addressed by JSON pointer, not blind file grep.** The checker targets the specific
`type` enum node in each schema (some schemas have multiple `enum` arrays for unrelated fields), so it
compares the panel-`type` enum only and reports the file + pointer on mismatch.

**Contract test.** Backend already has route tests for panel creation; add a case creating a panel with
`type: "collection"` via `POST /api/panels` asserting a 2xx and `type: "collection"` echoed, if not
already covered. This satisfies AC #3 at the route/contract level (the schema parity check is the
static half; the route test is the runtime half).

## Risks / Trade-offs

- [Regex-parsing Scala for the canonical set is brittle if `fromString` is reformatted] → The parser
  targets the stable `case "x" =>` arm shape; a format change that breaks it fails the check loudly
  (empty/short set → assertion error), not silently. Keep the extraction narrow and asserted (expect
  ≥ 8 types; fail if the parsed set is suspiciously small).
- [Widening `dashboard-proposal` / `update-panels-batch` enums is a contract change] → Purely additive
  (adds an accepted value); no previously-valid payload becomes invalid. Non-breaking.
- [helio-mcp TS parse couples the drift checker to proposal.ts naming] → Anchor on the exact
  `PANEL_TYPES` / `DATA_PANEL_TYPES` const names already present; a rename would fail the check, which
  is the intended tripwire.

## Planner Notes

- Self-approved: extending `check-schema-drift.mjs` rather than adding a new script (keeps one gate);
  making the backend `PanelType` parser the canonical source; guarding helio-mcp enums in the same
  check. All within ticket scope (AC #2 asks to guard every enumeration site) and no new deps.
- `dataTypeId` requiredness for collection in `dashboard-proposal.schema.json`: backend enforces
  data-panel binding at apply time (`DataPanelKinds`), so the schema only needs the enum value, matching
  how `metric`/`chart`/`table` are already handled there. No new required-field conditional added.
