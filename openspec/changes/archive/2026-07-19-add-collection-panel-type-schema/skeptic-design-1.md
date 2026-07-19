## Skeptic Report — design gate (round 1)

### What I verified (with evidence)

- **Ticket ACs read** (`openspec/changes/add-collection-panel-type-schema/ticket.md`): 3 ACs —
  (1) create-panel-request accepts `collection`, (2) audit note of every panel-type-enumerating
  schema/spec location, (3) contract test/check covering collection panel creation.

- **Audit table claims checked against ground truth, file by file:**
  - `schemas/create-panel-request.schema.json:13` — enum already includes `collection`. Matches
    proposal.md's claim ("has `collection` (fixed by HEL-315)"). Confirmed.
  - `schemas/panel.schema.json:14` — enum already includes `collection`. Confirmed.
  - `schemas/update-panels-batch-request.schema.json` — enum is
    `["metric","chart","text","table","markdown","image","divider"]`, **no** `collection`. Matches
    "missing" claim. Confirmed.
  - `schemas/dashboard-proposal.schema.json` `$defs.ProposalPanel.type` — enum is
    `["metric","chart","table","text","markdown","image","divider"]`, **no** `collection`. Matches
    "missing" claim. Confirmed.
  - `backend/src/main/scala/com/helio/domain/model.scala:58-80` — `PanelType.fromString` has exactly
    8 cases including `"collection"`. Matches "canonical set" claim (8 types).
  - `backend/src/main/scala/com/helio/services/DashboardProposalService.scala:271` —
    `DataPanelKinds = Set("metric","chart","table","collection")`. Matches claim.
  - `frontend/src/features/panels/types/panel.ts:52-60` — `PanelKind` union includes `collection`.
    Matches claim.
  - `helio-mcp/src/tools/proposal.ts:22-23` — `DATA_PANEL_TYPES = Set(["metric","chart","table"])`
    (no collection) and `PANEL_TYPES = [...7 types, no collection]`. Matches "missing" claims.
  - Confirmed no other `.schema.json` file in `schemas/` has a `type` enum enumerating panel kinds
    (only the 4 named above match a `"metric"..."chart"..."table"` grep across the whole dir).
  - `scripts/check-schema-drift.mjs` read in full — today only compares JSON-Schema `properties` keys
    against Scala case-class field names; it has no enum-value comparison logic at all. Confirms the
    design's premise that this drift class is currently invisible to CI.
  - No existing backend route test creates a `type: "collection"` panel via `POST /api/panels`
    (`grep -n "collection" backend/src/test/scala/com/helio/api/ApiRoutesSpec.scala` — only unrelated
    "empty collection" phrases). Confirms AC #3 is genuinely unmet today and the planned new test is
    warranted.

- **Gap found — the audit is NOT complete.** I independently grepped the whole repo for
  panel-type-enumeration literals beyond the files the design already names
  (`grep -rn '"metric".*"chart".*"table"' --include=*.ts --include=*.tsx frontend/src helio-mcp/src`)
  and found a fourth `DATA_PANEL_TYPES`-style gate that the audit table, design.md, tasks.md, and
  spec.md never mention:
  - `frontend/src/features/dashboards/ui/ProposalReview.tsx:29` —
    `const DATA_PANEL_TYPES = new Set(["metric", "chart", "table"]);`, used at:
    - line 60 — `bindingIssue()`: `if (!DATA_PANEL_TYPES.has(panel.type)) return null;` — decides
      whether a panel needs a "No DataType bound" / "Bound DataType not found" warning.
    - line 146 — decides whether to render the bound-DataType name/info row in the review list.

  This is the exact same "which panel types require a bound DataType" gate that the design already
  identifies and fixes in `helio-mcp/src/tools/proposal.ts:22` (also a bare `DATA_PANEL_TYPES` set
  missing `collection`) — but this one lives in the **human-facing** Proposal Review UI, the other
  consumer of `dashboard-proposal.schema.json` besides helio-mcp. I confirmed there is no shared
  util/export elsewhere in `frontend/src` that supersedes this local constant
  (`grep -rn "isDataPanel|DataPanelKind|DATA_PANEL_TYPES" frontend/src` → only this one file).

  Concretely: once `dashboard-proposal.schema.json` is widened (per this very change) to legally
  accept a `type: "collection"` panel, an agent-authored proposal with an unbound collection panel
  will pass schema validation, reach `ProposalReview.tsx`, and **silently render as if it needs no
  binding** — no "No DataType bound" warning, no bound-DataType info row — because
  `DATA_PANEL_TYPES` here still excludes `collection`. That is a real, newly-exposed correctness gap
  directly caused by the scope of this change, not a pre-existing unrelated issue.

  I also checked `helio-mcp/src/tools/write.ts` (the `create_panel`/`bind_panel` MCP tools), which
  has two more panel-type enums (lines 253, 283). Both already include `collection` correctly, and
  both *intentionally* omit `divider` (documented in the tool description as a deliberate MCP-vs-app
  divergence) — so these are not "must match the canonical set" locations and their absence from the
  audit table is defensible, but it should still be called out explicitly in the audit note as
  "intentionally scoped subset, out of parity-guard scope" rather than left unmentioned, so a future
  reader doesn't mistake the silence for an oversight (as the ProposalReview.tsx one turned out to
  be).

- **Parity-guard design**: sound in mechanism (parse canonical set from `PanelType.fromString`,
  parse `DataPanelKinds` from `DashboardProposalService.scala`, assert schema/helio-mcp enums match)
  but its scope — 4 schemas + `helio-mcp/src/tools/proposal.ts`'s two named consts — does not cover
  the `ProposalReview.tsx` constant above. Even after implementing exactly as planned, a future panel
  type addition would still silently skip this frontend gate with no CI failure, which undercuts the
  design's own stated goal ("a newly added panel type must be added to every enum surface or CI
  fails") and the ticket's explicit motivation (this drift class "recurred silently across
  HEL-247/HEL-305/HEL-315").

- **Non-goals / scope discipline**: proposal.md's non-goals (no new collection features, no ajv, no
  behavior change) are consistent with the rest of the plan and with ground truth (backend/frontend
  already fully support collection) — no objection there.

### Verdict: REFUTE

### Change Requests

1. Add `frontend/src/features/dashboards/ui/ProposalReview.tsx:29` (`DATA_PANEL_TYPES`, used at
   lines 60 and 146) to the audit table in `proposal.md` and `design.md`, mark it **missing**, and
   add a task to fix it (`Set(["metric","chart","table","collection"])`) so a reviewer isn't shown a
   collection panel as needing no binding once `dashboard-proposal.schema.json` legally allows it.
2. Decide and document whether the parity guard in `check-schema-drift.mjs` will also assert on this
   frontend constant (recommended — it's the same class of drift as `helio-mcp/src/tools/proposal.ts`'s
   `DATA_PANEL_TYPES`, which the guard does cover) or, if excluded from the static guard for
   frontend-cost reasons, name the substitute regression protection (e.g. a targeted component/unit
   test asserting `ProposalReview` surfaces a binding warning for an unbound `collection` panel) and
   record that decision in design.md's Decisions/Risks section.
3. Update `specs/collection-panel-type/spec.md`'s requirement text and scenarios to include this
   frontend surface (or explicitly scope it out with a stated reason), so AC #2's "audit note listing
   every schema/spec location... each updated or confirmed correct" is actually accurate — right now
   it omits a location that is demonstrably missing `collection` in a way that produces incorrect UI
   behavior for the exact payload shape this change legalizes.
4. (Minor, non-blocking if 1-3 land) Add a one-line note in the audit table that
   `helio-mcp/src/tools/write.ts:253,283` panel-type enums were checked, already include `collection`,
   intentionally omit `divider` by design, and are out of parity-guard scope — so the omission reads
   as a deliberate, checked decision rather than a gap.

### Non-blocking notes

- The regex-based Scala extraction approach for the canonical set (design.md "Decisions") is
  reasonably guarded (≥8-types assertion, narrow match on `case "x" =>` arms) — no objection.
- The route-level contract test plan for AC #3 is appropriately scoped (2xx + `type` echoed) given no
  existing test creates a `collection` panel.
