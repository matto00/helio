## Context

See proposal.md. Ground truth on main 1e0d610bb (verify; do not trust these line numbers):

- Editor: `OE = frontend/src/features/pipelines/ui/outputEditor`. `outputKinds.ts` `CREATABLE_KIND_OPTIONS` excludes
  insight; `kindOptionsFor` appends it only for an existing insight. `OutputKindConfigCard.tsx` (~l.152) shows the L1
  placeholder "Insight settings arrive in a later release." `buildOutputConfig.ts` falls to `default: return {}` for
  insight; `configPatch.ts` (`openingParams`, `buildBaselineConfig`, `buildConfigPatch`) diffs current vs opening and
  PATCH shallow-merges config, so clears are explicit `null`. State lives in `useOutputKindState.ts`. Pipeline Outputs:
  `selectOutputsForPipeline` (`state/outputsSlice.ts`), `Output.nodeStepId`; draft Outputs via `isDraftOutput`.
- Backend config contract (`domain/outputs/InsightConfig.scala`, L1 D3/D4): `preset` (auto|delta|trend|leaders|
  summary), `prompt` <= 2000, `reads {outputs <= 8, windows <= 4}`, `refresh` on_run|daily|manual, `maxSentences`,
  `maxChars`; absent `reads.outputs` = same-node default, `[]` = no siblings, `null` clears; reads may not name the
  insight itself, another insight, or a foreign id.
- Panel: `features/panels/ui/OutputPanelContent.tsx` insight branch renders `InsightNotRenderedState` (no
  `role="status"`). Mode comes from `historySource` (`variant: "public"` + `dashboardId`, `token`). `output` is an
  `Output` (authenticated, has `ownerId`) or `PublicOutputMeta` (`ownerId: null`). Footer and refresh live in panel
  chrome (`PanelCard.tsx`, `MobilePanelStack.tsx`, `PanelFullscreenOverlay.tsx`, detail modal): find the "UPDATED" and
  refresh sites by grep.
- Markdown: `panels/ui/MarkdownPanel.tsx` (lazy, react-markdown ^10 + remark-gfm, `urlTransform`), no rehype-raw.
- Provenance: `panels/provenance/ProvenanceTrigger.tsx` owns open state through `usePortalPopover({place:
  placeProvenance})` (HEL-1756), data via `useProvenance(key, fetcher, isOpen)` with `outputProvenanceKey(outputId)` /
  `publicProvenanceKey(dashboardId, panelId)`, popover `ProvenancePopover.tsx` (focus on placed, Tab trap, Escape,
  focus return, portal into the enclosing dialog or body). No external open API.
- Read API (L2): `GET /api/outputs/:id/insight` -> `{outputId, render|null, lastAttempt|null}` (render has citations
  with `outputId`; may carry model/tokens/costMicros); public `GET /api/dashboards/:d/panels/:p/insight` -> `{render:
  {markdown, citations[{id, field, number?, date?, capturedAt?, isPct}], renderedAt}|null}`. Statuses: ok, failed,
  skipped_quota, skipped_unchanged, skipped_budget. No "rendering" status exists. Citation markers are `[cN]`
  (`InsightValidator.Marker`).
- Tier: `state.auth.currentUser.tier` (`free|beta|owner`).
- L4 HEL-1743 (in flight): `POST /api/outputs/:id/insight/refresh` -> 202 `{outputId, started}` then poll GET; R3/R3b
  role-shaped reads (viewer: no model/tokens/cost/runId/inputDigest; quota and budget collapsed to one neutral status
  whose wire value is not yet fixed); per-Output `model` key. Treat all as claims until merged.

## Goals / Non-Goals

**Goals:** insight authoring card; insight panel with sanitized markdown, chips, states, footer and refresh semantics;
public `panelId` on citations; e2e proof of the ACs.

**Non-Goals:** render triggers, refresh endpoint, model selector, viewer-role shaping (all L4); ask UI (L7); MCP (L8);
the pipeline page's live Output column and preview pane keep the not-yet-rendered state (they have no Output id and
show draft state; showing a stored render there is a follow-up if wanted); `maxSentences`/`maxChars`/`reads.windows`
editing (backend defaults stand; the editor preserves stored values); any display of cost, model or tokens.

## Decisions

**D1 Picker.** Add `insight` (label "Insight") to `CREATABLE_KIND_OPTIONS`; `kindOptionsFor` no longer special-cases
it. Flip `outputKindDrift.test.ts`'s picker case to "offers every kind" and update its header comment, `outputKinds.ts`
comment, and `OutputEditorSheet.openingState.test.tsx` (`KIND_LABEL` gains insight; the L1 note assertion is replaced
by assertions on the new card). The backend half pins the picker too:
`backend/src/test/scala/com/helio/domain/model/OutputKindDriftSpec.scala` (~l.123-129) asserts the create picker
excludes insight; flip it to "offers every kind" and remove the exclusion from its table. Record both drift guard
mutations (drop insight from the picker -> jest red AND OutputKindDriftSpec red) in `mutations.md`. Task 2.1 runs
`OutputKindDriftSpec` explicitly.

**D2 Insight card (`OE/InsightKindFields.tsx`, rendered from `OutputKindConfigCard`).** Order: preset `Select`
(options with plain labels: Auto, Change since last run, Trend over time, Top and bottom, Summary; executor confirms
wording against `InsightPreset`/L3 docs), Outputs-it-reads checklist, refresh `SegmentedRadioGroup` (On every run /
Daily / Manual only), then a native `<details>` "Custom prompt" disclosure (`disclosure-summary tap-expand-44`, closed by
default, open on open when a prompt is stored) containing `Textarea` with `maxLength=2000` and a character count. A
comment marks the slot where L4's model selector goes (after preset). Checklist: raw checkbox inputs in the existing
checklist pattern (`SelectFieldsConfig.tsx`), one row per Output from `selectOutputsForPipeline` excluding this
Output, insight Outputs and draft Outputs, grouped as "Same step" first then "Other steps" (labels: Output name +
kind), with the long-list capping rule of DESIGN.md if more than 8 rows. "Same node" is defined once, in a pure helper
`sameInsightNode(a, b)`: equal `nodeStepId` when the insight has a `nodeStepId`; otherwise equal `rootId` and both
without a `nodeStepId` (a root-bound insight never pre-ticks Outputs of another root, and never matches on two
`undefined`s); a unit test covers a two-root pipeline and a step-bound insight. Upsell: only when the signed-in user is
the PIPELINE owner (`page.isOwner` / `Pipeline.ownerId === currentUser.id`, never `Output.ownerId`, which is the
Output's creator) AND `currentUser.tier === "free"` (renders are charged to the pipeline owner, D6 of the epic; this
matches the `historyPayloadsAvailable` "pipeline owner's tier, never the viewer's" precedent): an inline note
(field-hint style, not accent) "Insights render on the beta plan." with a link to the settings beta-access section.
A free-tier editor on a beta owner's pipeline sees no upsell. Every control has a label; 44px tap targets on phone.

**D3 Config build.** Add `readInsightConfig` to `outputConfigTypes.ts` returning stored `preset`, `refresh`, `prompt`,
`readsOutputs: string[] | null`. Params gain `insightPreset`, `insightRefresh`, `insightPrompt`, `insightReads`
(`string[] | null`, null = default). Create (`buildOutputConfig` `case "insight"`): write `preset` and `refresh` only if
they differ from the defaults (auto, on_run), `prompt` only if non-blank, `reads: {outputs}` only if the ticked set
differs (as a set) from the same-node default. Edit (`buildConfigPatch`): changed keys only; a cleared prompt -> `prompt:
null`. `reads` is replaced as one key, so stored `reads.windows` are always carried: a checklist changed away from the
default -> `reads: {outputs, windows?}` (windows only when stored); a checklist returned to the default -> `reads:
null` when no windows are stored, and `reads: {windows}` when they are. Unit tests cover all four (with/without stored
windows x explicit/default). Never write `model`, `maxSentences`,
`maxChars`. Save blocked (`saveBlocked`) with an inline message when >8 ticked. `nodeStepId` of a new insight is the
sheet's target step, so the default set is computable before save.

**D4 Insight data (`features/panels/insight/`).** `insightService.ts`: `fetchOutputInsight(outputId)` and
`fetchPublicPanelInsight(dashboardId, panelId, token)` (copy `provenanceService.ts`). Types mirror the schemas; the
render type deliberately does NOT declare `model`, token or cost fields, and the service maps the response through an
allow-list so they never reach state (a unit test feeds a populated response and asserts the mapped object has no such
keys). `useInsight(source)` fetches on mount, exposes `{data, loading, error, refetch}`, re-fetches on
`subscribeToPipelineTerminal` for the authenticated variant (pipeline id from the Output), and on the panel refresh
action (D7). Errors render the DESIGN.md error state (never swallowed).

**D5 Sanitized renderer (`InsightMarkdown.tsx`).** Wiring note: a custom mdast `citation` node needs a
`remark-rehype` handler (or `data.hName`/`hProperties`) mapping it to a dedicated element name (e.g.
`helio-citation`), that element name must be in `allowedElements`, and `components` maps it to `CitationChip`;
otherwise `unwrapDisallowed` silently strips every chip to text. A test asserts a known marker yields a button. Reuse react-markdown (lazy like `MarkdownPanel`, same chunk) with:
`skipHtml`, `allowedElements` = p, strong, em, ul, ol, li, code, br, blockquote (+ `unwrapDisallowed`), so links,
images, headings-as-HTML, tables and raw HTML never render as elements; `urlTransform` returning `""`. A remark
plugin (`remarkCitationChips`) walks `text` nodes and also `linkReference`/`definition` nodes (a `[c1]: url`
definition would otherwise turn `[c1]` into a link): definitions are removed, a `linkReference` or text match of
`\[(c\d+)\]` whose id is in the render's citations becomes a custom `citation` node rendered by `CitationChip`; any
other marker stays text. Unit tests (jsdom) cover the hostile-markdown spec scenario with element-tag assertions, plus
unknown marker and marker inside code (stays text).

**D6 Citation chip and reusable provenance opener.** Extract from `ProvenanceTrigger` a hook/component
`useProvenancePopoverAt` (or `ProvenancePopoverHost`) that, given an anchor element ref, a provenance key and fetcher,
owns `usePortalPopover({place: placeProvenance})`, `useProvenance`, and renders `ProvenancePopover` with HEL-1756's
placement, reposition, focus and Escape behavior unchanged. `ProvenanceTrigger` is refactored onto it with no behavior
change (its existing tests, `ProvenanceTrigger*.test.tsx`, `usePortalPopover.test.tsx` and
`e2e/hel1756-popover-viewport-fit.spec.ts` must stay green unmodified). `CitationChip` is a `<button type="button">`
styled as a small neutral chip (StatusChip neutral recipe or tokens; not accent; accent only for focus ring), showing
the citation ordinal, accessible name "Source: <field> <formatted value>, open provenance", `aria-haspopup="dialog"`,
`aria-expanded`, `tap-expand-44`, stopping click/keydown propagation like the trigger's wrapper. Popover props for a
chip: `panelTitle`/label = "Source: <field>" (the cited field), the same comparison/compared-with content the
provenance content already derives from the fetched provenance (no new data), telemetry `panelId` = the insight
panel's id (the chip lives in it), and the authenticated pipeline link exactly as `ProvenanceTrigger` builds it from
the fetched provenance; public has no pipeline link, as today. Keys: authenticated ->
`outputProvenanceKey(citation.outputId)` + `fetchOutputProvenance`; public -> `publicProvenanceKey(dashboardId,
citation.panelId ?? insightPanelId)` + the public fetcher with token. Alternative rejected: an imperative registry that
opens the target panel's own trigger — it fails for Outputs not placed (authenticated), panels scrolled away or not
mounted on phone, and it moves the user's eye across the board.

**D7 States, footer and refresh.** `InsightPanelBody` derives one state per spec "Insight panel states" from
`{render, lastAttempt, isPipelineOwner, tier, variant, refreshPending}`. `isPipelineOwner` is the signed-in user owning
the insight's PIPELINE (never `Output.ownerId`): resolved by a small `usePipelineOwnership(pipelineId)` that reads
`Pipeline.ownerId` from the pipelines slice when loaded, else one cached `GET /api/pipelines/:id` per pipeline id; a
404/403/error resolves to false (dashboard-only viewers cannot read the pipeline). Public: always false, no request.
Owner-only quota is the client-side floor; the server (L4 R3b) also collapses quota for viewers. Editors cannot be told
apart from viewers client-side without L4's role-shaped response, so editors see the neutral note until a follow-up
reads L4's role; this is stated in the PR. Status handling is a closed switch with a default branch to the neutral "not updated" note (forward
compatible with L4's collapsed viewer status). Notes are quiet `field-hint`-style lines under the render, failed uses
the intent-error style, not-yet-rendered keeps its copy and gains `role="status"`; upsell uses `EmptyState` with a
link. `refreshPending` is a prop defaulting to false; nothing sets it until L4 (the rendering state is unit-tested
only). Footer: the panel chrome's "UPDATED" value (today `panel.meta.lastUpdated`, `PanelCard.tsx` ~l.332, and the same
field in the other chrome sites) for an insight panel is the render's `createdAt`/`renderedAt` (hidden when no
render). Rows: the insight panel SHALL NOT fetch rows it never shows; gate `usePanelData`'s row fetch off for kind
`insight` once the kind is known (or state why it cannot be, with the request count measured) — implement by letting the insight body report its render time to the chrome (callback/context) or by
the chrome reading the same `useInsight` cache; executor picks the smaller change and states it. The chrome's refresh
action for an insight panel calls the insight `refetch` instead of the rows refetch. No refresh button that calls
the server is added (L4).

**D8 Public `panelId` (backend).** `PublicPanelInsightResolver` builds `outputId -> panelId` for the requested
dashboard only, AFTER the dashboard ACL directive and `resolvePanelOutput` have succeeded, with one system-context
query of that dashboard's output panels (bound `dashboard_id = :d` in SQL, never a cross-dashboard lookup), choosing
the lowest panel id when an Output is placed twice (pinned by a test); `OutputInsightResponses.public` takes the map and sets
`PublicInsightCitation.panelId: Option[String]`. Protocol writes it only when present. Schema
`public-output-insight-response.schema.json` gains optional `panelId` (string), keeping `additionalProperties: false`.
Tests: existing public projection spec stays green; a new case pins placed / unplaced / placed-on-another-dashboard;
the forbidden-names assertion still passes. Fail-first: the new spec case runs red before the change. Overlap note:
HEL-1743 edits `OutputInsightProtocol.scala` and the read service; keep the diff minimal and rebase on merge.

**D9 e2e (`e2e/hel1744-insight-panel.spec.ts`), red first.** Throwaway beta user (`setUserTierForTest`); pipeline with a
CSV source and a table Output and a metric Output on one node, created through the API. UI: open the pipeline page,
create an insight Output via the sheet (pick Insight, assert defaults and pre-ticked Outputs, save without typing; assert
the POST body has no `prompt`). Place the insight and the table Output on a dashboard (API). Run the pipeline (real
run, wait for success). Then, because L4's after-run trigger is not merged, seed one `ok` row with a test-only helper
`e2e/support/insightSeed.ts` (`seedInsightRender`) through `e2e/support/db.cjs` with `SET LOCAL
app.current_user_id`, id validation and exact-row-count checks like `historySeed.ts`; markdown = two sentences citing
`c1` (table Output, placed) and `c2` (metric Output, not placed), with `model`, tokens and `costMicros` populated. If L4
has merged before Execution and its trigger can be driven with a fake client without a production backdoor, use it
instead and record why; otherwise the seed stays and the PR says so. Assertions: two sentences, two chips; clicking a
chip shows the popover (computed `visibility: visible`, non-zero rect, `elementFromPoint` at its centre inside it) and
`document.activeElement` inside it; Escape returns focus to the chip; footer shows the render time. Public: make the
dashboard shareable, open the public viewer, chip c1 opens the table panel's provenance, chip c2 falls back to the
insight panel's own; assert the page text and the public insight response contain none of the seeded model id, token
numbers or cost. Free-tier owner with no render: upsell visible. Run in light and dark, desktop 1280x800 and phone
390x844. Workers 2. Before any run, check the page URL/port is this lane's `DEV_PORT`. Cleanup by exact id via the
existing teardown; plain throwaway emails.

**D10 Red-first and mutations.** Unit tests (jest, maxWorkers 3) for D1-D7 are written and run red before code;
outputs in `red-evidence.md`. Guards with a recorded mutation in `mutations.md`: picker drift, allow-list mapping
(re-add `costMicros` to the mapped type -> red), sanitizer (drop `skipHtml` / allow `a` -> red), viewer quota collapse
(show quota for non-owner -> red), public `panelId` (drop the map -> red).

**D11 Visual check.** Running app in light and dark, desktop and phone: the editor card (create and existing), the
panel in each state reachable with seeded rows (rendered, failed-with-previous, unchanged, quota as owner, neutral as
grantee, not yet rendered, upsell), chips focused and the popover open. Compare against neighbouring panels and the
existing provenance popover for cohesion (DESIGN.md §0 accent discipline, §7 states). Screenshots under
`.concertino/scratch/HEL-1744/`.

## Risks / Trade-offs

- [Editors see the neutral note instead of the quota note, because the client knows only ownership] -> accepted for
  L5; L4's role-shaped response can carry the role later. Owners (who pay, D6) see the real state.
- [Refactoring ProvenanceTrigger regresses HEL-1756] -> existing unit and e2e specs run unmodified.
- [Seeded render is not a real render] -> the PR states it; the follow-up after L4 swaps the seed for the trigger.
- [HEL-1743 overlap in OutputInsightProtocol.scala; HEL-1758 may touch shared e2e fixtures] -> minimal diffs; report.
- [Shared Playwright browser hijack] -> URL/port check before every probe.

## Migration Plan

None. Backend change is additive (optional field).

## Planner Notes

Self-approved: chip popover anchored at the chip rather than opening the target panel's own trigger (D6); public
`panelId` extension to satisfy the ticket's "where that Output is placed" on public boards (D8); cost/model/tokens
shown nowhere (stricter than R3); quota visible to owners only (R3b, client-side by ownership); live Output column
unchanged; seed instead of L4 trigger unless L4 merges (driver-authorized).

Executor notes from skeptic-design-2 (CONFIRM): (a) when a free-tier pipeline owner has no render and the newest
attempt is skipped for quota, the upsell wins; (b) add a unit row: an editor-created insight viewed by the pipeline
owner shows the quota note; (c) "SHALL NOT write reads.windows" means the editor never changes them; it re-sends stored
windows unchanged inside `reads`; (d) the e2e seed uses distinctive token and cost numbers (e.g. 987654 tokens,
costMicros 4242421) and a distinctive model id string, so the no-cost assertions cannot pass or fail by coincidence;
(e) the live Output column keeps its not-yet-rendered state (Non-goal).
