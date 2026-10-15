## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed: worktree HEAD 1ebf23fd0dab625242d9e03e4c46f494939409ef plus the uncommitted planning artifacts under
`openspec/changes/restate-remaining-stale-panel-specs/` (ticket, proposal, design, tasks, 4 delta specs).

### What I verified (with evidence)

- Spawn-cwd guard: `assert-cwd.sh` -> `READY ambient=/home/matt/Development/helio branch=task/restate-remaining-stale-panel-specs/HEL-1598`.
- `openspec validate restate-remaining-stale-panel-specs --type change --strict` -> `Change ... is valid`, exit 0.
- Delta headers match the living specs byte for byte. Checked: the mcp "Panel composition tools accept image caption and chart
  annotation" and "Proposal config passthrough is backward compatible", the panel-polling "Panel data is re-fetched on the configured
  refresh interval" and "Polling stops when the panel binding is removed", the dashboard-export-import "Export dashboard endpoint", and
  the two panel-type-rendering selector requirements. The selector MODIFIED blocks keep their scenario names.
- Proposal flat fields (`ProposalPanelSupport.scala:249-333`): `buildCreateRequest` takes `buildDataConfig` whenever `outputId`
  is present. That path gives `{outputId}` for an output panel and `{outputId, fieldMapping}` for any other type. Otherwise
  `buildNonDataConfig` runs: content for text/markdown, `url` becomes `imageUrl` + `imageFit: "contain"`, orientation for divider.
  `mergeConfig` lets the passthrough win and then re-applies the flat `outputId`. `withSourceBinding` re-applies `dataSourceId`.
  `ProposalPanel` (`DashboardProposalProtocol.scala:27-44`) carries every flat field the ADDED requirement lists.
  `validatePanel` does not reject an `outputId` on a text/markdown/image panel (lines 36-51).
- Caption/annotation: `create_content_panel` caption doc is at `placements.ts:84`. `update_panel` caption doc is at
  `write.ts:793`. `OUTPUT_CONFIG_KEYS_DOC` includes `annotation` (`outputs.ts:78`). `ImagePanel.tsx:45-47` renders the caption.
  `ChartOutputPanel.tsx:150` passes `cfg.annotation`.
- The `update_panel` tool (`write.ts:766-807`) accepts `title`, `type` (a mismatch is rejected with 400), `config` and
  `appearance`. Its description and the backend `OutputPanel.Patch(outputId: Option[OutputId], ...)` (`OutputPanel.scala:181,230`)
  both allow rebinding an output panel's `config.outputId`.
- Polling: `usePanelPolling.ts` third parameter is still `typeId`. `PanelCardBody.tsx:155` passes `outputId`. The only non-test
  `refreshInterval` hit is the `panel.ts:288` type. There is no backend `refreshInterval`/`refresh_interval` in `backend/src/main`.
  `OutputPanel.Patch` uses `getOrElse(config.outputId)`, so the server cannot null an output panel's `outputId`.
- Export: `DashboardSnapshotPanelEntry` (`DashboardProtocol.scala:103-110,198-211`) has the fields snapshotId, id, title, type,
  appearance and `config = PanelConfigCodec.encodeConfig(panel)`. It has no `typeId`/`fieldMapping`.
- Selector: `OutputPicker.tsx:32-33` offers `markdown` and `image`.
- (c) echarts deferral: HEL-1572's worktree exists. Its HEAD is `1092fe007`, a plan-only commit. Its change
  `appearance-type-density-motion` has `specs/echarts-chart-panel/spec.md`, so the claim is true. That delta MODIFIES only "Hover
  emphasis is subtle and respects reduced motion". The stale `typeId` line is `echarts-chart-panel/spec.md:20`, under "Chart panel
  renders a live ECharts instance". The two changes would not collide mechanically, so the deferral rests only on the driver rule.
  The ticket records that rule as binding for this run, which is acceptable.
- (a) D2: the archived precedents (HEL-1592 evidence.md:853, skeptic-design-3:59) left the panel-type-rendering Purpose unedited and
  recorded it as out of scope. D2 is a new, explicitly scoped exception. It is gated on a recorded probe and limited to Purpose lines
  plus write-path-audit row 9 and payload detail 9 (`write-path-audit/spec.md:73,144,147`). The PR body discloses it, and if the
  probe shows a delta can address these lines, the delta is used instead. I find this sound against the ticket's "through an OpenSpec
  delta wherever the delta grammar can address it" wording.
- (b) D3: per-requirement ACCURATE/RESTATE/REMOVE rules, each backed by a command, are concrete enough to implement. Ground truth:
  `collection-panel-type` and `timeline-panel-type` have one requirement each, and both are wholly stale. The second names
  `create_panel`/`bind_panel` and a `timeline` panel type. The 2.7 zero-requirement probe will therefore almost certainly fire.
  `metric-panel-trend-indicator`'s Purpose is `TBD`, as the design says.

### Verdict: REFUTE

### Change Requests

1. **dashboard-export-import delta contradicts itself.** `specs/dashboard-export-import/spec.md` (the new requirement body) says
   an output panel's `config` "carries `outputId`". The same body then says "The snapshot SHALL NOT include server-assigned IDs ...
   except each panel entry's `id` field". `outputId` is a server-assigned id. A `form` panel's encoded config also carries
   `dataSourceId`, and an output panel's `controls` carry ids. The restated text must name the binding/reference ids inside a
   panel's `config` as retained, because import resolves `config.outputId` via `outputRepo.findByIdOwned`. A narrower alternative
   is to restrict the ban to the dashboard's and panels' own ids and the meta fields. The executor must verify the wording against
   `PanelConfigCodec.encodeConfig` for every panel kind.
2. **The new mcp ADDED requirement contradicts a sibling requirement in the same spec.** "Image panel caption and chart Output
   annotation are set through their own MCP tools" says `update_panel` accepts `config.caption`. That matches `write.ts:793`.
   The living "update_panel MCP tool" requirement still says `update_panel` accepts only placement fields (`title`, `w`, `h`,
   position) and that rebinding a panel's Output is rejected. Both statements are false today: the tool accepts
   title/type/config/appearance, and `config.outputId` rebinding is allowed (`write.ts:787`, `OutputPanel.Patch`). After archive,
   the spec would contradict itself because of text this change adds. The design must pick one resolution and add a task for it:
   (a) bring "update_panel MCP tool" into scope as REMOVED+ADDED, since its scenario name "Attempting to rebind a panel's Output is
   rejected" is false; or (b) remove the `update_panel` clause from the new requirement and record the stale sibling under "Out of
   scope, observed", naming the contradiction. Option (a) is preferred, because (b) leaves a known-false requirement next to the
   one being fixed.
3. **The flat-field ADDED requirement is wrong for one case.** "For non-data panels the flat fields seed the created panel's
   config: `content` ..., `url` ..., `orientation` ..." is false when a text/markdown/image/divider proposal panel also carries a
   flat `outputId`. `buildCreateRequest` then takes `buildDataConfig`, which produces `{outputId, fieldMapping}`, and the
   flat content/url/orientation is dropped (`ProposalPanelSupport.scala:250-253,315-322`). Validation does not reject that input.
   Qualify the sentence (e.g. "when no `outputId` is supplied"), or state the drop. Optionally record it under "Out of scope,
   observed" as a possible defect.

### Non-blocking notes

- `divider` is accepted by the backend proposal path (`PanelType.fromString`, `validateDividerOrientation`). The MCP and JSON-schema
  proposal enums exclude it. The "orientation seeds divider" clause is true at the endpoint; make sure the evidence cites the
  backend path, not the MCP tool.
- panel-polling: the server never nulls `outputId`. Task 1.4 must therefore settle whether the "Output binding is removed / outputId
  becomes null" requirement describes a reachable state. If it does not, state it as the hook's contract (pinned by its tests),
  following D3's unreachable-behaviour rule. The same applies to the comment "`null` for any panel hydrated from the backend"
  (`panel.ts:278`): the field is more likely `undefined`. Verify it before reusing the wording.
- D3: expect the zero-requirement probe to fire for `collection-panel-type` and `timeline-panel-type`. If the fallback "restate one
  requirement to point at the owning spec" is used, its text needs the same C1 evidence as every other sentence.
- The proposal's "Modified Capabilities" omits `write-path-audit`. It is a direct edit, so this is correct, but say so in the PR
  body alongside the panel-type-rendering Purpose edit.
- echarts: when the deferral follow-up is filed, note that HEL-1572's delta touches a different requirement. The follow-up need not
  wait for HEL-1572 to land.
