## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed at HEAD 609e62b6d917243355a179fa8a26318c04898c27 (change dir untracked, planning artifacts only).

### What I verified (with evidence)

- Spawn-cwd guard: `assert-cwd.sh` → `READY ambient=/home/matt/Development/helio branch=task/stale-panel-spec-wording/HEL-1592`.
- `openspec validate restate-stale-panel-spec-wording --type change --strict` → "Change ... is valid".
- REMOVED headers match the living specs byte-for-byte: compared against `grep -n "^### Requirement" openspec/specs/{panel-type-rendering,mcp-panel-composition-tools}/spec.md`. Only the badge requirement is MODIFIED, and it keeps its name and scenario.
- Canonical kinds: `schemas/panels/create-panel-request.schema.json` `type.enum` = `[text, markdown, image, divider, output, form]`. `PanelContent.tsx` dispatches output/text/markdown/image/divider/form, and an unhandled kind falls back to `MetricRenderer`. True.
- `TextRenderer.tsx` takes literal `content` only, with a two-line faded placeholder. `MarkdownPanel.tsx` shows the placeholder "No content yet...". `FormRenderer.tsx:12-15` shows "Form not configured". `DividerPanel.tsx` handles orientation. True.
- `OutputPanelContent.tsx:164-267` dispatches by kind: chart/table/metric/markdown/collection/timeline, else "Unsupported output kind". True.
- `MetricOutputPanel.tsx:111` sets `data = { value, label: cfg.label ?? "", unit: cfg.unit ?? "" }` and never sets `trend`. `MetricRenderer.tsx:149,176-179` keys "No data" on `!!data?.value` and omits an empty label. True, apart from the unit caveat in CR3.
- `PanelCard.tsx:320` makes the badge render `{panel.type}`. True.
- metricId: absent from `DashboardProposalProtocol.scala`, from the helio-mcp `src` non-test code, from `ProposalPanelSupport.scala`, and from the `ProposalPanel` properties in `dashboard-proposal.schema.json`. `DashboardProposalService.scala:201-203` contains the quoted "were deleted outright" comment. True.
- `create_panel` was removed (`write.ts:728`). `create_content_panel` offers `divider` (`placements.ts:76,94`). True.
- The ticket's premise is real, and all three items are confirmed in the tree.
- sort: `proposal.ts:93` has `z.enum(["asc","desc"])`, the schema has `sort.enum ["asc","desc"]` (an invalid value is rejected on both surfaces), and the backend has `sort: Option[String]` with no derivation in `services/proposals/*`. D3 already anticipates this, so it is handled.

### Verdict: REFUTE

The deltas are mostly sound. The plan has two coverage holes, though: it would satisfy the literal AC while leaving the same false divider/`create_panel`-parity claim live on agent-facing and backend surfaces. Two of the ADDED claims are also false against the tree. All four are cheap to fix now.

### Change Requests

1. **`proposal.ts:142-143`, the agent-facing `propose_dashboard` description, is not in the plan, and it makes the same false claim.** It reads: "there is no `divider`: dropped for agent/UI parity, mirroring create_content_panel/place_outputs". `create_content_panel` *does* create dividers (`placements.ts:76,94`), and design.md's own "Code facts" says so. This is the string agents actually read. After D4, `proposal.ts` would contradict itself: the header comment would say "create_content_panel still creates dividers" while the tool description says divider was dropped to mirror it. Required: add this description to D4 and task 2.4, restated against `AGENT_SURFACE_EXCLUSIONS`. Also extend task 2.6's zero-hit probe to `agent/UI parity\|mirroring create_content_panel`. Before editing, grep for any test that asserts this description text.

2. **Backend copies of the create_panel-parity rationale are outside the plan and outside the 2.6 probe's scope.** The probe covers only `scripts/lib helio-mcp/src schemas`, and it is single-line.
   - `backend/src/main/scala/com/helio/api/protocols/assistant/AssistantProposalToolSchemas.scala:60-62` says divider was dropped "for parity with\n// create_panel, per that schema file's own description". This change rewrites that schema description, so the citation becomes false *because of this change*. A single-line grep for the three D5 strings does not match it, because of the line break.
   - `backend/src/test/scala/com/helio/services/proposals/DashboardAuthoringPromptSpec.scala:113` is a test name: "...minus divider, which the proposal flow deliberately excludes for create_panel parity".
   - `DashboardProposalProtocol.scala:42-49` has two comments. One says the flat `sort` is "derived into ... `config.timelineOptions.sort` by `DashboardProposalService`", which is false now and is the code twin of the timeline requirement this change REMOVES. The other says "mirroring the MCP `create_panel` `config` passthrough".

   Required: put the AssistantProposalToolSchemas comment in scope as a lockstep surface under D5, since its claim cites the text being changed. For the other two, either fix them in lockstep or record an explicit disposition in design.md (in scope / follow-up, with the reason). Widen task 2.6 to `backend/src` with a pattern that catches the wrapped form, for example `grep -rn "create_panel" backend/src helio-mcp/src scripts/lib schemas | grep -v "REMOVED\|removed\|server.test.ts\|placements.ts"`, and record every remaining hit with its disposition.

3. **The ADDED "Metric-kind output panels render value, unit and label" requirement makes a false unconditional SHALL about the unit.** `MetricRenderer.tsx:170` renders the unit only when `data?.unit && !isDurationFormat(format)`, and line 62-63 says "the metric `unit` suffix is hidden for" a duration format (HEL-1308). Required: restate it as "...with `config.unit` immediately adjacent when non-empty and the Output's format is not a duration format". Alternatively, scope the scenario explicitly to non-duration formats.

4. **The ADDED "Image panel with URL renders the image" scenario overclaims.** `ImagePanel.tsx` `sanitizeImageUrl` renders `<img>` only for an http(s) URL or a same-origin root-relative path, and other values fall back to the placeholder. An absolute URL is emitted as `parsed.href`, which is not always the literal input. A load error also swaps to a placeholder (F-112). Required: restate the WHEN as a valid http(s) or root-relative upload URL, and either drop "src set to that URL" or qualify it. Optionally add the load-error and disallowed-scheme placeholder scenario, or record why it is out of scope.

### Non-blocking notes

- REMOVED Reason for "Each panel type renders a visually distinct body": "the metric trend scenario has no data source on the current metric render path" is true of the `data.trend` string. However, `MetricRenderer` still renders a history comparison/delta line (HEL-1275, using the `panel-content__metric-trend--*` classes) on that same path. Say "the legacy `data.trend` string has no source; the history comparison line is specified by its own capability" so the Reason cannot be read as "metrics show no trend".
- The D3 sort Reason should state the verified rejection behaviour: zod enum in `proposal.ts:93`, schema enum, and the backend accepting any string without applying it. The planned Reason ("decoded but never applied") is incomplete without it.
- Task headings "### Backend" / "### Tests" are template residue, and the work is docs/comments only. This is harmless.
- `ticket.md` contains no Acceptance Criterion requiring the helio-mcp `dist` rebuild. The PR-note plan is fine.
