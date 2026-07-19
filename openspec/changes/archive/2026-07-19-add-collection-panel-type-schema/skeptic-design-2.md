## Skeptic Report — design gate (round 2)

### What I verified (with evidence)

- **Ticket ACs read** (`ticket.md`): (1) `create-panel-request.schema.json` accepts
  `type: "collection"`, (2) audit note listing every panel-type-enumerating schema/spec location,
  (3) contract test/check covering collection panel creation.

- **Round-1 REFUTE resolution, checked independently (not trusted from the prior report):**
  - CR1/CR3 (add `ProposalReview.tsx` `DATA_PANEL_TYPES` to the audit + spec): confirmed present in
    `proposal.md`'s audit table (row: "`frontend .../ProposalReview.tsx:29` `DATA_PANEL_TYPES`...
    missing... add `collection`"), in `design.md`'s Context/Decisions, in `tasks.md` (task 2.3), and
    in `specs/collection-panel-type/spec.md` ("Scenario: Proposal Review UI flags an unbound
    collection panel"). Ground-truthed the actual file:
    `frontend/src/features/dashboards/ui/ProposalReview.tsx:29` —
    `const DATA_PANEL_TYPES = new Set(["metric", "chart", "table"]);`, used at line 60
    (`bindingIssue`) and line 146 (info row). Still missing `collection` on main, as claimed — the
    task to fix it is real and necessary.
  - CR2 (decide guard scope for the frontend constant): `design.md` Decisions section explicitly
    states the guard **will** assert on `ProposalReview.tsx`'s `DATA_PANEL_TYPES` (not a narrower
    component test alone), and `tasks.md` task 3.4 encodes this. Resolved.
  - CR4 (call out `write.ts` as checked/out-of-scope, not silent): `proposal.md`'s audit table now has
    an explicit row for `helio-mcp/src/tools/write.ts:253,283` marked "has `collection`; intentionally
    omit `divider`... confirm — out of parity-guard scope." Ground-truthed: both enums
    (`createPanel`/`bindPanel`) do include `collection` and omit `divider`. Resolved.

- **Independent re-audit (fresh grep, not reusing round-1's file list) to check the audit is now
  actually complete:**
  `grep -rn '"metric".*"chart"' --include=*.ts --include=*.tsx --include=*.json --include=*.scala .`
  (excluding node_modules/target) surfaced exactly: `panel.schema.json`, `DashboardProposalService.scala`
  (`DataPanelKinds`), `write.ts` (×2, already covered/out-of-scope), `proposal.ts` (×2),
  `dashboard-proposal.schema.json`, `create-panel-request.schema.json`,
  `update-panels-batch-request.schema.json`, `mobilePanelHeights.test.ts`, and `ProposalReview.tsx`.
  - The one location not in the audit table, `frontend/src/features/panels/ui/mobilePanelHeights.test.ts:72`
    (`["metric","chart","markdown","text","image","divider"]` inside an "only table scrolls
    internally" assertion), is **not a contract-validation enum surface** — it's a UI test-helper
    array, and the same file already has a separate `describe("mobilePanelHeights — collection (HEL-247
    D5)")` block exhaustively covering `collection`'s height policy. Confirmed
    `mobilePanelHeights.ts`'s `switch` already has an explicit `case "collection"` arm. No gap here;
    correctly excluded from audit scope.
  - No other file matched. The audit is complete against an independent search, not just the prior
    round's location list.

- **Ground truth on every enum-widening claim (verified directly, not via the design doc's prose):**
  - `schemas/create-panel-request.schema.json:13` — enum includes `collection`. ✓ (matches "confirm")
  - `schemas/panel.schema.json:14` — enum includes `collection`. ✓ (matches "confirm")
  - `schemas/update-panels-batch-request.schema.json` `properties.panels.items.properties.type.enum`
    — 7 types, **missing** `collection`. ✓ matches "add" claim; single, unambiguous JSON-pointer
    location (no other `enum` collides at that path).
  - `schemas/dashboard-proposal.schema.json` `$defs.ProposalPanel.properties.type.enum` — 7 types,
    **missing** `collection`. ✓ matches "add" claim.
  - `backend/.../domain/model.scala:19-52` — `PanelType.fromString` has exactly 8
    `case "x" => Right(...)` arms including `collection`, plus an `other` fallback with an error
    message listing all 8. Confirms the design's parser target (regex on the `case "x" =>` arm shape,
    excluding `other`) is well-defined and low-risk.
  - `backend/.../services/DashboardProposalService.scala:271` —
    `DataPanelKinds: Set[String] = Set("metric", "chart", "table", "collection")`, single-line literal.
    Confirms the planned regex extraction target is simple and stable.
  - `helio-mcp/src/tools/proposal.ts:22-23` — `DATA_PANEL_TYPES` (3 types, no collection) and
    `PANEL_TYPES` (7 types, no collection). ✓ matches "missing" claims.
  - `frontend/src/features/panels/types/panel.ts:52-60` — `PanelKind` union already includes
    `collection`. ✓ (matches "confirm").
  - No OpenAPI spec files exist in the repo (`openspec/` is change management only;
    `find ... -iname "*.yaml"` grepped for "openapi" found nothing). Confirms "n/a" claim.
  - `schemas/update-panels-batch-response.schema.json` only `$ref`s `panel.schema.json` (already has
    `collection`) — no separate enum to widen; correctly not listed as a gap.

- **Parity-guard mechanism sanity-checked against the existing script**
  (`scripts/check-schema-drift.mjs`, read in full): today only does `parseCaseClasses` field-name
  comparison, zero enum-value logic — confirms the design's stated premise that this drift class is
  currently invisible to CI. The script already uses a comparable regex-extraction pattern
  (`case class\s+(\w+)\s*\(...\)`) for a similar purpose, so extending it with a `case "x" => Right`
  regex for `PanelType` and a `Set(...)` regex for `DataPanelKinds` is consistent with the existing
  code's approach, not a new brittle mechanism. `npm run check:schemas` → `node
  scripts/check-schema-drift.mjs` confirmed wired already; no new npm-script plumbing needed.

- **AC #3 gap genuinely unmet today, confirmed directly:**
  `grep -n "collection" backend/src/test/scala/com/helio/api/ApiRoutesSpec.scala` → only unrelated
  "empty ... collection" phrases; no test creates a `type: "collection"` panel via `POST /api/panels`.
  Confirmed the route handler applies no additional required-field validation for `collection` at
  creation time (`grep -rn "collection" ApiRoutes.scala protocols/*.scala` → no creation-time gating),
  so the planned test (2xx + `type: "collection"` echoed, no `dataTypeId` needed at create time) is
  achievable exactly as scoped.

- **Internal consistency**: `proposal.md`, `design.md`, `tasks.md`, and
  `specs/collection-panel-type/spec.md` agree with each other (same locations, same canonical-set
  framing, same guard scope) and with ground truth. No `TODO`/`TBD`/placeholders. Non-goals (no
  itemOptions/layout polish, no ajv, no backend/frontend behavior change) are consistent with the rest
  of the plan and with the fact that backend/frontend already fully support `collection`.

- **Acceptance criteria traced to tasks:**
  - AC #1 → task 1.3 (confirm, already true).
  - AC #2 → the audit table itself (in `proposal.md`/`design.md`) plus `spec.md`'s requirement text,
    now verified complete by my independent re-grep.
  - AC #3 → tasks 3.5 (`check:schemas` passing) + 4.1 (new backend route test).

### Verdict: CONFIRM

### Non-blocking notes

- `mobilePanelHeights.test.ts:72`'s partial kind list (missing `table`/`collection` from that specific
  sub-assertion) is unrelated to this ticket's contract-enum scope and already has separate
  `collection` coverage elsewhere in the file — no action needed, noted only so it isn't mistaken for
  an audit gap in a future pass.
- The regex-based Scala extraction (design.md "Decisions" / "Risks") is appropriately guarded
  (≥8-types assertion) against silent breakage if `fromString`'s formatting changes.
