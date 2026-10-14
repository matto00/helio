## Skeptic Report — design gate (round 3, skeptic-design-3.md)

Reviewed at HEAD 609e62b6d917243355a179fa8a26318c04898c27. The change dir is untracked and holds planning artifacts only.

### What I verified (with evidence)

- **Spawn-cwd guard:** `assert-cwd.sh` returned `READY ambient=/home/matt/Development/helio branch=task/stale-panel-spec-wording/HEL-1592`.
- **Strict validation:** `npx --no-install openspec validate restate-stale-panel-spec-wording --type change --strict` printed "Change 'restate-stale-panel-spec-wording' is valid" (exit 0).
- **Delta headers:** I grepped each delta `### Requirement:` line with `grep -cxF` against the living spec.
  - panel-type-rendering: the 2 REMOVED headers and the 1 MODIFIED header each match exactly once. The 2 ADDED headers match 0 times.
  - mcp-panel-composition-tools: all 5 REMOVED headers match once.
- **Round-2 CR1 (image scenarios), fixed.** I read `ImagePanel.tsx` `sanitizeImageUrl` (lines 20-43). It resolves the input with `new URL(url, window.location.origin)` and rejects only non-`http:`/`https:` protocols or a parse throw. It returns the literal value for `/`-but-not-`//` same-origin input and `parsed.href` otherwise.
  - The restated render scenario matches this: resolves to http(s), bare relative `photo.png` included, literal `src` for a single-`/` same-origin path, otherwise the resolved URL, `objectFit` defaulting to `contain`.
  - The placeholder scenario matches too: empty, absent, unparseable or non-http(s).
  - The load-failure scenario matches F-112 ("Image failed to load...").
- **Round-2 notes, addressed.**
  - D4a and task 2.4a now cover the `ProposalPanelSupport.scala:33-36` sort comment. Line 35 still says "a timeline panel's `sort`", and line 50 confirms that validation is gone.
  - The sort Reason now separates the runtime zod rejection (`proposal.ts:93` `z.enum(["asc","desc"])`) from the contract schema enum (`dashboard-proposal.schema.json:98-101`).
  - Backend decode-any-string is true: `DashboardProposalProtocol.scala:153` uses `.convertTo[String]`.
- **AC2 coverage after removals.** I listed every requirement in `openspec/specs/panel-type-rendering/spec.md`. Once the two REMOVED requirements are gone, what remains is:
  - Unknown types
  - Badge (MODIFIED)
  - Markdown badge
  - Two selector requirements

  None of these keys on `typeId` or describes bound text. Every `typeId`, bound-text and `fieldMapping` occurrence sits in lines 4-77 and 117-139, which are exactly the REMOVED blocks.
- **ADDED body requirement, checked against `PanelContent.tsx:207-253`.**
  - The dispatcher covers output, text (`TextRenderer content={panel.config.content}`), markdown, image, divider (`DividerRenderer`, then `orientation`) and form.
  - An unhandled kind falls back to `MetricRenderer`.
  - `TextRenderer` has literal content only and two faded placeholder lines.
- **ADDED metric requirement, checked against the renderers.**
  - `MetricOutputPanel.tsx:111` sets `data = { value, label: cfg.label ?? "", unit: cfg.unit ?? "" }` and never sets `trend`.
  - `MetricRenderer.tsx:149,170,176-179`: `hasValue = !!data?.value`, the unit renders only when `!isDurationFormat(format)`, an empty label is omitted when a value is present, and "No data" shows only when there is no value.
  - The "5m 30s" example is in `MetricRenderer.duration.test.tsx:11-12`.
- **MCP REMOVED Reasons.**
  - `create_panel` removal is recorded at `helio-mcp/src/tools/write.ts:728` (HEL-907).
  - `create_content_panel` offers divider (`placements.ts:94`).
  - `metricId` does not appear in `proposal.ts`, the proposal protocol or the proposal schema.
  - The "deleted outright" quote is at `DashboardProposalService.scala:202`.
  - The `/api/metrics` deletion is at `Main.scala:167`.
  - `schema-drift-panel-kind-coverage` is a real capability spec (`openspec/specs/schema-drift-panel-kind-coverage/spec.md`), enforced by `check-schema-drift.mjs:468-488` through `scripts/lib/panelKindEnumCoverage.mjs`.
  - No other `metricId`/`collection`/`timeline` requirement in the living mcp spec falls under the ticket's named items. `propose_dashboard exposes the current agent-facing panel type set` already specifies the current set.
- **D4/D4a sites exist as described.** `AssistantProposalToolSchemas.scala:60-62` has the wrapped "parity with // create_panel" text. `DashboardProposalProtocol.scala:42-44` has the stale "derived into config.timelineOptions.sort".
- **Scope and placeholders.** Every AC maps to a task:
  - Re-derivation: 1.1-1.4
  - Deltas and validate: 1.5 and 3.4
  - Wording: 2.3-2.6
  - evidence.md: C1 and every task in group 1
  - No-behaviour-change gates: 2.2, 3.1, 3.2 and 3.2a

  There are no TODO/TBD markers or deferred decisions.

### Verdict: CONFIRM

### Non-blocking notes

- The sort Reason could also mention that the in-app assistant tool schema advertises `enumSchema("asc","desc")` (`AssistantProposalToolSchemas.scala:95`). It is accurate as written.
- The task headings "### Backend" / "### Tests" are template residue, carried over from rounds 1-2. Harmless.
- The Purpose line of panel-type-rendering ("placeholder states when no data is bound and live states when data is present") is loose but not `typeId`-keyed. The executor may record it under "Out of scope, observed".
