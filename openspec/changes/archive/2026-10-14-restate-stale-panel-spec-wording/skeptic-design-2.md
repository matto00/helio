## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed at HEAD 609e62b6d917243355a179fa8a26318c04898c27. The change dir is untracked and holds planning artifacts only.

### What I verified (with evidence)

- **Spawn-cwd guard:** `assert-cwd.sh` returned `READY ambient=/home/matt/Development/helio branch=task/stale-panel-spec-wording/HEL-1592`.
- **Strict validation:** `npx --no-install openspec validate restate-stale-panel-spec-wording --type change --strict` returned "Change ... is valid".
- **Delta headers:** I grepped every delta `### Requirement:` header with `grep -cxF` against the living spec.
  - All 7 REMOVED headers and the 1 MODIFIED header match exactly once.
  - The 2 ADDED headers match 0 times, so they are new.
- **Round-1 CR1 (propose_dashboard description), addressed:** D4 and task 2.4 now include the description at `proposal.ts:142-143`. The replacement text is "excluded from the proposal flow as purely presentational chrome; create it with create_content_panel". It is true: `placements.ts` (lines ~76-94) has `z.enum(["text","markdown","image","divider"])`.
- **Round-1 CR2 (backend copies), addressed:** D4a and task 2.4a now include the three backend comment sites, and the test name:
  - `AssistantProposalToolSchemas.scala:60-62` (wrapped across lines)
  - `DashboardProposalProtocol.scala:42-49` (`sort` comment and `create_panel` passthrough comment)
  - `DashboardAuthoringPromptSpec.scala:113` (test name)

  Task 2.6 now probes bare `create_panel\b` across `scripts/lib helio-mcp/src schemas backend/src frontend/src` and classifies every hit. I ran that probe. The remaining hits are the 7 planned edit sites plus accurate removal history (`helioApi.ts:895,948`, `placements.ts:3,43`, `placementsHandlers.ts:7,37`, `write.ts:728`, `server.test.ts`).
- **D4 `config` comment claim ("decoded by the same panel-create path (`PanelConfigCodec`) as POST /api/panels"):** true.
  - `DashboardProposalService.scala:158` calls `panelService.create(ProposalPanelSupport.buildCreateRequest(...))`.
  - `PanelServiceHelpers.scala:109-111` then calls `PanelConfigCodec.decodeCreateConfig`.
- **D5 consumers of the changed strings:** `grep -rl` for the reason and description phrases found only the three named files and `scripts/check-schema-drift{,.selftest}.mjs`. The selftest checks the divider reason only for being a string with `length > 20` (`selftest.mjs:55-59`). The planned reason is well over that, so the edit is safe.
- **Round-1 CR3 (duration unit), addressed:** `MetricRenderer.tsx:170` is `data?.unit && !isDurationFormat(format)`. The ADDED requirement now carries the duration exception and has its own scenario. `hasValue = !!data?.value` drives "No data", and an empty label is omitted (lines 149, 176-179). `MetricOutputPanel.tsx:111` sets `data = { value, label: cfg.label ?? "", unit: cfg.unit ?? "" }` and never sets `trend`. All true.
- **Round-1 note (trend Reason), addressed:** the Reason now names the legacy `data.trend` and separates HEL-1275's comparison line.
- **Round-1 note (sort Reason), addressed:**
  - `proposal.ts:93` is `z.enum(["asc","desc"])`.
  - The schema has `sort.enum ["asc","desc"]` at line 100.
  - `DashboardProposalProtocol.scala:153` decodes any string.
  - `services/proposals/*` never reads `sort`.

  The Reason is true.
- **ADDED "Each canonical panel kind" body requirement, checked against code:**
  - `PanelContent.tsx` dispatches output/text/markdown/image/divider/form, and an unhandled kind falls back to `MetricRenderer`.
  - `TextRenderer` takes literal `content` only, with two faded lines as the placeholder.
  - `MarkdownPanel` uses ReactMarkdown with remark-gfm, and its placeholder reads "No content yet...".
  - `DividerPanel` handles `orientation`.
  - `FormRenderer` shows "Form not configured" when there are 0 fields.
  - `ImagePanel` applies `objectFit = imageFit ?? "contain"`, and a load error shows "Image failed to load..." (F-112).

  All of these are true, apart from CR1 below.
- **MCP REMOVED Reasons:**
  - The create-panel-request enum is text/markdown/image/divider/output/form, with no collection.
  - `write.ts:728` records the HEL-907 removal.
  - `metricId` is absent from the protocol, the proposal.ts `panelSchema` and the proposal schema.
  - `DashboardProposalService.scala:201-203` contains the "deleted outright" quote.
  - `Main.scala:167` records the `/api/metrics` deletion.

  All true.
- **Scope:** all three ticket items and every AC have a task. Non-goals are recorded, and there are no placeholders or TBDs.

### Verdict: REFUTE

One ADDED scenario is false against the tree, and it was introduced by the round-1 fix. It is a one-scenario rewording, but a false SHALL in a living spec is exactly the defect class this ticket exists to remove. The executor's task 1.2 is unlikely to catch it, because none of the existing `ImagePanel.test.tsx` cases uses a bare relative path.

### Change Requests

1. **The ADDED scenario "Image panel without a renderable URL renders a placeholder" (`specs/panel-type-rendering/spec.md`) is false.** Its WHEN says a value that is "neither an `http(s)` URL nor a same-origin root-relative path" renders a placeholder. In reality, `ImagePanel.tsx` `sanitizeImageUrl` (lines 20-43) resolves every input as `new URL(url, window.location.origin)` and rejects only on a parse failure or a non-http(s) protocol. A bare relative value therefore renders an `<img>`.

   Reproduced with node's WHATWG URL against base `http://localhost:5173`:
   - `photo.png` resolves to `http://localhost:5173/photo.png` (protocol `http:`), so it is rendered as `parsed.href`.
   - `//evil.com/x` resolves to `http://evil.com/x`, so it is rendered. `ImagePanel.test.tsx:53` confirms this.
   - Only `data:` and `javascript:` (non-http protocols), unparseable values, and empty or absent values reach the placeholder.

   **Required:** restate both image scenarios in terms of the real predicate.
   - **Placeholder case:** "no `config.imageUrl` (or an empty one), or one that does not resolve against the page origin to an `http:`/`https:` URL (e.g. a `data:` or `javascript:` URL)".
   - **Render case:** "a `config.imageUrl` that resolves against the page origin to an `http(s)` URL; the `src` is the literal value for a same-origin single-slash root-relative path, otherwise the resolved absolute URL".

   Have task 1.2 record a probe for a bare relative value.

### Non-blocking notes

- `ProposalPanelSupport.scala:33-36` has a doc comment that still lists "a timeline panel's `sort`" as a validated value. That is the code twin of the REMOVED timeline requirement, and the validation it describes is gone (lines 49-52). Either add it to D4a's lockstep comment edits or record it under "Out of scope, observed".
- The sort Reason says the `dashboard-proposal.schema.json` enum "rejects" an invalid value. That schema is a contract document, not a runtime validator on the apply path. The in-app assistant tool schema (`AssistantProposalToolSchemas.scala:95`) is the other enforcing surface. Consider "is outside the enum in ... and rejected by the helio-mcp zod enum".
- The "Metric with no value" scenario holds inside the metric body. An Output with zero rows is preempted earlier by `PanelContent`'s generic "No data available" / "Not run yet" states. That is acceptable as written, because the requirement is about the body.
- The task headings "### Backend" / "### Tests" are template residue, carried over from round 1. Harmless.
