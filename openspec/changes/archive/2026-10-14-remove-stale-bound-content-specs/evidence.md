# Evidence (C1)

## 2.1 dead-path proof (grep + call graph)
```
$ grep -n 'data: null' frontend/src/features/panels/hooks/usePanelData.ts
338:      data: null,
367:    data: null,
$ grep -rn '<PanelContent' --include=*.tsx frontend/src | grep -v test | grep -v '//' 
frontend/src/features/panels/ui/PanelCardBody.tsx:248:      <PanelContent
frontend/src/features/panels/ui/PanelFullscreenOverlay.tsx:38:   *  feed this component's own `<PanelContent>` and must stay RAW for D7
frontend/src/features/panels/ui/PanelFullscreenOverlay.tsx:217:          <PanelContent
frontend/src/features/panels/ui/detailModal/PanelDetailModal.tsx:230:            <PanelContent
frontend/src/features/dashboards/ui/PublicDashboardViewerPage.tsx:114:      <PanelContent
$ grep -n "data={" PanelCardBody/PanelFullscreenOverlay/PanelDetailModal (all pass usePanelData result .data); PublicDashboardViewerPage passes none
frontend/src/features/panels/ui/detailModal/PanelDetailModal.tsx:232:              data={data}
frontend/src/features/panels/ui/PanelCardBody.tsx:251:        data={data}
frontend/src/features/panels/ui/PanelFullscreenOverlay.tsx:219:            data={data}
```
Conclusion: usePanelData returns data: null in both of its return paths (lines 338, 367); every non-test PanelContent caller sources data from it or passes none; so no path supplies non-null data to a text panel. Path was dead; removed.

## 2.3 deleted tests
Deleted from frontend/src/features/panels/ui/PanelContent.test.tsx: 'renders .panel-content__text-live element when text panel has live content' (bound data), 'text-live element displays the bound content', 'bound data.content takes precedence over literal config.content when both are present'. Kept: literal-content test. Added guard test. `grep -rn TextRenderer frontend/src --include=*.test.*` -> no other test references it:
```
(exit 1)
```

## 4.1/4.2 guard + mutation (restored 'data?.content ?? content' in TextRenderer and 'data={data}' in PanelContent, then reverted)
Red (mutated):
```
FAIL src/features/panels/ui/PanelContent.test.tsx
  ● PanelContent — text panel literal content › renders only config.content, never a non-null data.content, for a Text panel
    expect(element).toHaveTextContent()
    Expected element to have text content:
      LITERAL
    Received:
      BOUND
      373 |     );
      374 |     const liveEl = container.querySelector(".panel-content__text-live");
    > 375 |     expect(liveEl).toHaveTextContent("LITERAL");
          |                    ^
      376 |     expect(screen.queryByText("BOUND")).not.toBeInTheDocument();
      377 |     expect(container).not.toHaveTextContent("BOUND");
      378 |   });
      at Object.<anonymous> (src/features/panels/ui/PanelContent.test.tsx:375:20)
Test Suites: 1 failed, 1 total
Tests:       1 failed, 25 skipped, 1 passed, 27 total
Snapshots:   0 total
Time:        3.6 s, estimated 5 s
Ran all test suites matching src/features/panels/ui/PanelContent.test.tsx with tests matching "text panel literal".
```

## 3.1 root vs prefix form (HELIO_JEST_MAX_WORKERS=3, nice -n 19)
Root: `npm test -- --testPathPatterns=dashboardsSlice` (exit 0). The expanded inner command is `npm --prefix frontend test --testPathPatterns=dashboardsSlice` (no `--`), so npm consumes the flag:
```

> helio@0.7.4 test
> jest && npm --prefix frontend test --testPathPatterns=dashboardsSlice

159:Test Suites: 51 passed, 51 total
160:Tests:       469 passed, 469 total
169:Test Suites: 596 passed, 596 total
170:Tests:       7131 passed, 7131 total
```
Prefix: `npm --prefix frontend test -- --testPathPatterns=dashboardsSlice` (exit 0):
```

> helio-frontend@0.0.0 test
> jest --config jest.config.cjs --passWithNoTests --testPathPatterns=dashboardsSlice
Test Suites: 3 passed, 3 total
Tests:       47 passed, 47 total
```
Result: root form ran 51 root suites (helio-mcp etc.) + 596 frontend suites / 7131 tests (full, un-narrowed); prefix form ran 3 suites / 47 tests. Item 4 confirmed; fixed in CLAUDE.md (doc), script untouched (3.2).

## 1.1 / 1.1a / 1.1b markdown-panel delta claims (route-level probe)
Probe: backend/src/test/scala/com/helio/api/routes/panels/PanelContentOwnershipSpec.scala (new, kept as a permanent guard) and a HEL-1466 case in DashboardApplyProposalConfigSpec.scala.
Command: `cd backend && HELIO_TEST_JVM_XMX=3g SBT_OPTS=-J-Xmx3g sbt 'testOnly com.helio.api.routes.panels.PanelContentOwnershipSpec com.helio.api.routes.proposals.DashboardApplyProposalConfigSpec'`
```
[info] a markdown panel
[info] - should carry literal content only in config.content, with no top-level content, and round-trip through export
[info] - should update content on PATCH, leave it unchanged when config.content is absent, and clear it to "" on null
[info] a text panel
[info] - should keep its own literal content in config.content
[info] a content key sent for a non-content panel kind
[info] - should never become stored content on create (image, output, divider dropped; form rejected 400)
[info]   + form create with content -> 400 Bad Request {"message":"Unrecognized form config attribute(s): content"} 
[info] - should never become stored content on update (image, output, divider, form)
[info]   + PATCH config.content on 75e90857-e62d-44d6-881b-1f508cd4af18 -> 200 OK {"appearance":{"background":"transparent","color":"inherit","transparency":0.0},"config":{"imageFit":"contain","imageUrl":"https://example.test/a.pn
[info]   + PATCH config.content on 9e83c5a6-aa81-4d06-b3d1-45c6be5dc58b -> 200 OK {"appearance":{"background":"transparent","color":"inherit","transparency":0.0},"config":{"controls":[],"outputId":"ab56c810-ac2b-4aff-b688-075a917f
[info]   + PATCH config.content on e183e2a6-cff4-40b0-aa4f-046121c1f647 -> 200 OK {"appearance":{"background":"transparent","color":"inherit","transparency":0.0},"config":{"orientation":"horizontal"},"dashboardId":"521d429f-69d4-4
[info]   + PATCH config.content on 2e48b842-d85c-4301-be33-8c334f73da71 -> 200 OK {"appearance":{"background":"transparent","color":"inherit","transparency":0.0},"config":{"dataSourceId":"be6c66fc-c8fb-4a7b-a30d-20eb0fccd968","fie
[info] Tests: succeeded 5, failed 0, canceled 0, ignored 0, pending 0
[info] All tests passed.
```
Mapping of claims to outcomes:
- config.content location, no top-level `content` on create response and on GET /api/dashboards/:id/export panel, text keeps its own, export round-trip: test 1 and 'text panel' test (pass).
- 1.1a PATCH with config.content absent (`config:{}`) leaves content unchanged; 1.1b PATCH `content:null` returns `""`: test 2 (pass, three sequential PATCHes: string, absent, null).
- stray `content` on CREATE: image/output/divider -> 201 and no config.content (dropped); form -> 400 `{"message":"Unrecognized form config attribute(s): content"}` (matches the delta: form create is rejected, naming the attribute).
- stray `content` on UPDATE (PATCH config.content): image, output, divider, form all -> 200 and no config.content in response (ignored; the delta states only 'dropped or rejected', which holds). Statuses printed above.
Code backing: `MarkdownPanel.scala` Patch.decode (`case None => None; case Some(JsNull) => Some("")`), `FormPanel.scala` AllowedKeys closed set:
```
backend/src/main/scala/com/helio/domain/panels/MarkdownPanel.scala:48:          case Some(JsNull)      => Some("")
backend/src/main/scala/com/helio/domain/panels/TextPanel.scala:48:          case Some(JsNull)      => Some("")
238:          deserializationError(s"Unrecognized form config attribute(s): ${unknown.toSeq.sorted.mkString(", ")}")
```
Top-level `content` absent from the panel schema (`schemas/panels/panel.schema.json`):
```
top-level properties: ['appearance', 'config', 'dashboardId', 'dataAsOf', 'id', 'layout', 'layoutVersion', 'layouts', 'meta', 'ownerId', 'title', 'type']
has top-level content: False
```
REMOVED 'Non-markdown panels have null content' reason: current main spec text (`grep -n -A2 'Non-markdown panels have null content' openspec/specs/markdown-panel/spec.md`) lists metric/chart/text/table and `content: null`:
```
34:### Requirement: Non-markdown panels have null content
35-Panels of type `metric`, `chart`, `text`, or `table` SHALL have `content: null` in all API responses.
36-The `content` field SHALL be ignored (not stored) if sent for a non-markdown panel on create or update.
kind constraint after V94 (metric/chart/table/collection no longer valid):
365:ALTER TABLE panels ADD CONSTRAINT panels_kind_check CHECK (kind IS NULL OR kind IN ('output', 'text', 'markdown', 'image', 'divider'));
```

## 1.2 mcp-panel-composition-tools delta claims
```
$ node zprobe.cjs  (zod z.enum(PANEL_TYPES) from helio-mcp/src/tools/proposal.ts + schema enum)
PANEL_TYPES = ["text","markdown","image","output","form"]
collection REJECTED
metric     REJECTED
chart      REJECTED
table      REJECTED
timeline   REJECTED
divider    REJECTED
text       ACCEPTED
markdown   ACCEPTED
image      ACCEPTED
output     ACCEPTED
form       ACCEPTED
schema ProposalPanel.type enum = ["text","markdown","image","output","form"]
enums equal: true
$ grep -n "panels: z.array(panelSchema)" helio-mcp/src/tools/proposal.ts   (propose_dashboard and apply_proposal share panelSchema)
175:        panels: z.array(panelSchema),
199:        panels: z.array(panelSchema),
$ sed -n 12,19p scripts/lib/agentFacingPanelTypes.mjs   (divider exclusion reason)
/** Kinds left off the agent-facing surfaces on purpose, each with its stated reason. The reason is a
 *  product-scope one, NOT a binding predicate: `divider` IS expressible on the wire (`orientation`),
 *  it is excluded because it is purely presentational. */
export const AGENT_SURFACE_EXCLUSIONS = {
  divider:
    "purely presentational layout chrome: no content, binding or data an agent can author; " +
    "create_panel's enum excludes it, and the proposal surfaces mirror that parity",
};
$ grep -n "type\` ∈" helio-mcp/src/tools/proposal.ts
142:        "`type` ∈ text/markdown/image/output/form (there is no `divider`: dropped for agent/UI parity, " +
$ npm run check:schemas
schemas in sync with JsonProtocols (124 checked across 54 protocol files)
panel-type enums in sync with backend canonical sets (11 surfaces checked)
panel-kind enum coverage: 7 schema enums/const groups detected, each checked or exempted
AssistantProposalToolSchemas.scala in sync with schemas/ (14 surfaces checked)
$ mergeConfig: explicit config wins (d.fields ++ c.fields), flat outputId re-applied; withSourceBinding re-applies dataSourceId
272:    dataSourceId.fold(config)(id => Some(JsObject(config.fold(Map.empty[String, JsValue])(_.fields) + ("dataSourceId" -> JsString(id)))))
286:      case (Some(d), Some(c)) => Some(JsObject(d.fields ++ c.fields))
292:      case Some(id) => merged.map(m => JsObject(m.fields + (bindingKey -> JsString(id))))
$ grep -n "PanelConfigCodec.decodeCreateConfig" (same create path for apply-proposal/contents)
backend/src/main/scala/com/helio/domain/panels/PanelConfigCodec.scala:10: *  `encodeConfig` (responses), `decodeCreateConfig` (create paths, e.g.
backend/src/main/scala/com/helio/domain/panels/PanelConfigCodec.scala:53:  def decodeCreateConfig(kind: String, json: Option[JsValue]): Either[String, CreateConfig] = {
backend/src/main/scala/com/helio/api/protocols/panels/PanelProtocol.scala:246:   *  the service via [[PanelConfigCodec.decodeCreateConfig]] once `type`
backend/src/main/scala/com/helio/api/protocols/dashboards/DashboardProtocol.scala:93: *  reconstructs the typed config via [[PanelConfigCodec.decodeCreateConfig]].
backend/src/main/scala/com/helio/infrastructure/persistence/dashboards/DashboardSnapshotRepository.scala:174:      val created = PanelConfigCodec.decodeCreateConfig(entry
backend/src/main/scala/com/helio/services/panels/PanelServiceHelpers.scala:111:      PanelConfigCodec.decodeCreateConfig(PanelType.asString(pt), request.config)
backend/src/main/scala/com/helio/services/dashboards/DashboardServiceValidation.scala:67:          PanelConfigCodec.decodeCreateConfig(entry.`type`, Some(entry.config))
backend/src/main/scala/com/helio/services/dashboards/DashboardSnapshotImport.scala:54:   *   - Gap B: decode `entry.config` via `PanelConfigCodec.decodeCreateConfig`, bui
backend/src/main/scala/com/helio/services/dashboards/DashboardSnapshotImport.scala:69:        createConfig <- PanelConfigCodec.decodeCreateConfig(entry.`type`, Some(entry
```
Passthrough scenarios (backend route tests, all green in the run above and in the 27-test run of DashboardApplyProposalSpec/ConfigSpec/FormSpec + PanelContentOwnershipSpec): 'carry literal content and image fields through config' (markdown content '# Notes', text, image imageUrl/caption); 'keep the flat outputId authoritative when config attempts to override it (HEL-316, V41)'; 'make the flat dataSourceId authoritative over a conflicting config.dataSourceId'; 'create a dashboard with bound + unbound panels' (output panel, valid caller-owned outputId); 'reject an invalid panel type and create nothing' (backend rejects unknown type).
REMOVED-reason claims against current main spec text (collection 'bound to the DataType', chart chartOptions, 'source-companion', 'seven proposable types'):
```
48:- **THEN** `divider` is absent from the accepted values and only the seven proposable types remain
50:#### Scenario: Collection is proposable
68:- **THEN** the applied panel persists as a collection with that base type and layout, bound to the
73:  `config: { chartOptions: { smooth: true } }` alongside its binding
78:  with a source-companion (non-pipeline-output) DataType id
```

## 1.3 panel-cross-filtering delta quotes (byte-exact grep -F, lines joined because the delta hard-wraps)
```
$ tr '\n' ' ' < FILE | tr -s ' ' | grep -cF "<quoted string>"
header: main spec=1  delta=1
target definition: main spec=1  delta=1
```
Both quoted strings appear verbatim in the main spec's narrowing requirement (header line 46, definition line 47) and in the delta (1/1 each).
Unchanged behavioural claims (markdown never a target, legacy fieldMapping, no disclosure) are backed by existing frontend tests:
```
191:    it("markdown: a legacy stored fieldMapping never makes it filterable", () => {
203:    it("markdown: a current markdown Output (empty fieldMapping) is not filterable", () => {
81: *  `markdown` is deliberately absent (HEL-1405): a markdown Output has no
```

## 1.4 panel-content-sizing delta (claims corrected to ground truth, C1)
Values that failed verification were corrected: font sizes (var(--text-xs/sm/lg) = 0.75/0.875/1.125rem, not 0.78/0.9/1.1rem), skeleton radius (var(--app-radius-sm) = 6px, not 4px). The sparseness line height was first mis-corrected to 21px (cycle 1) and is now 18px, see below.
Tokens:
```
$ grep -n '^\s*--text-xs:\|^\s*--text-sm:\|^\s*--text-lg:\|^\s*--space-2:\|^\s*--space-3:\|^\s*--space-4:\|^\s*--app-radius-sm:' frontend/src/theme/theme.css
29:  --text-xs: 0.75rem; /* 12px */
30:  --text-sm: 0.875rem; /* 14px */
32:  --text-lg: 1.125rem; /* 18px */
49:  --space-2: 0.5rem; /* 8px */
50:  --space-3: 0.75rem; /* 12px */
51:  --space-4: 1rem; /* 16px */
64:  --app-radius-sm: 6px;
```
padding 12px 16px (space-3/space-4) on .panel-content:
```
$ sed -n 1,8p frontend/src/features/panels/ui/PanelContent.css
.panel-content {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--space-3) var(--space-4);
  min-height: 0;
}
```
overflow-y: auto on .panel-content--text (PanelContent.css:77-80) and gap 8px (space-2):
```
$ sed -n 77,80p frontend/src/features/panels/ui/PanelContent.css; sed -n 97,101p frontend/src/features/panels/ui/PanelContent.css
.panel-content--text,
.panel-content--table,
.panel-content--form {
  overflow-y: auto;
.panel-content--text {
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-2);
}
```
skeleton lines 10px / radius / 85% / 60%:
```
$ sed -n 143,157p frontend/src/features/panels/ui/PanelContent.css
.panel-content__text-line {
  display: block;
  height: 10px;
  border-radius: var(--app-radius-sm);
  background: var(--app-border-subtle);
}

.panel-content__text-line--long {
  width: 85%;
}

.panel-content__text-line--short {
  width: 60%;
}

```
live text: default var(--text-sm), pre-wrap, and the compact (max-height 179px -> text-xs) / spacious (min-height 280px -> text-lg) container queries:
```
$ grep -n -B2 -A3 'text-live' frontend/src/features/panels/ui/PanelContent.css
255-}
256-
257:.panel-content__text-live {
258-  font-size: var(--text-sm);
259-  color: inherit;
260-  white-space: pre-wrap;
--
380-
381-@container panel-card (max-height: 179px) {
382:  .panel-content__text-live {
383-    font-size: var(--text-xs);
384-  }
385-}
--
388-
389-@container panel-card (min-height: 280px) {
390:  .panel-content__text-live {
391-    font-size: var(--text-lg);
392-  }
393-}
```
Sparseness line height: body sets line-height 1.5 but the later `font: inherit` rule (same specificity, later in the cascade) resets line-height via the font shorthand, so the computed value is `normal`; one 14px (var(--text-sm)) line is therefore about 18px (live measurement by the evaluator, evaluation-1.md, 18px; the old '< 20px' claim was true). theme.css is unchanged:
```
$ sed -n 345,363p frontend/src/theme/theme.css
body {
  margin: 0;
  background-color: var(--app-bg);
  color: var(--app-text);
  font-size: var(--text-sm);
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
  transition:
    background-color var(--app-transition),
    color var(--app-transition);
}

body,
button,
input,
textarea,
select {
  font: inherit;
}
```
## 3.x CLAUDE.md note
Only the 'Run a single test file' lines changed: `git diff --stat CLAUDE.md`
```
 CLAUDE.md | 4 ++--
 1 file changed, 2 insertions(+), 2 deletions(-)
```

## 4.3 gates
```
npm run lint -> exit 0; npm run format:check -> exit 0; npm --prefix frontend run typecheck -> exit 0
panels jest subset (features/panels, 3 workers): Test Suites: 194 passed, 194 total
panels jest subset (features/panels, 3 workers): Tests:       2577 passed, 2577 total
openspec validate remove-stale-bound-content-specs --type change --strict -> valid
sbt testOnly PanelContentOwnershipSpec DashboardApplyProposalConfigSpec -> 9 passed, 0 failed
```
