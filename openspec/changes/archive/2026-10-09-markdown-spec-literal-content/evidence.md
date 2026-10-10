# HEL-1405 evidence

## T1 red (pre-change)

```
> helio-frontend@0.0.0 test
> jest --config jest.config.cjs --passWithNoTests

FAIL src/utils/crossFilterRows.test.ts
  ● isPanelFilterableByDimension › every other output kind › markdown: a legacy stored fieldMapping never makes it filterable

    expect(received).toBe(expected) // Object.is equality

    Expected: false
    Received: true

      197 |           "region",
      198 |         ),
    > 199 |       ).toBe(false);
          |         ^
      200 |     });
      201 |
      202 |     // HEL-1405 — GUARD: passes before and after (current writes store {}).

      at Object.<anonymous> (src/utils/crossFilterRows.test.ts:199:9)


Summary of all failing tests
FAIL src/utils/crossFilterRows.test.ts
  ● isPanelFilterableByDimension › every other output kind › markdown: a legacy stored fieldMapping never makes it filterable

    expect(received).toBe(expected) // Object.is equality

    Expected: false
    Received: true

      197 |           "region",
      198 |         ),
    > 199 |       ).toBe(false);
          |         ^
      200 |     });
      201 |
      202 |     // HEL-1405 — GUARD: passes before and after (current writes store {}).

      at Object.<anonymous> (src/utils/crossFilterRows.test.ts:199:9)


Test Suites: 1 failed, 500 passed, 501 total
Tests:       1 failed, 5253 passed, 5254 total
Snapshots:   19 passed, 19 total
Time:        81.088 s
Ran all test suites.
```
exit=1 (npm test: root jest 0 failures; frontend jest 1 failure = T1, expected red)

## After

```
$ npm --prefix frontend test -- --testPathPatterns="crossFilterRows|PanelContent.test" --verbose
Test Suites: 2 passed, 2 total
Tests:       51 passed, 51 total
exit=0
```

Note: the root `npm test -- --testPathPatterns=...` script does not forward the pattern to the frontend jest; it ran all 501 suites (5254 tests), exit 0.


## Mutations

### (a) crossFilterRows.ts replaced by the pre-change file (git show e88b929c6:...)

```
$ npm test -- --testPathPatterns=crossFilterRows   (frontend suite output, filtered)
FAIL src/utils/crossFilterRows.test.ts
  ● isPanelFilterableByDimension › every other output kind › markdown: a legacy stored fieldMapping never makes it filterable

    expect(received).toBe(expected) // Object.is equality

    Expected: false
    Received: true

      197 |           "region",
      198 |         ),
    > 199 |       ).toBe(false);
          |         ^
      200 |     });
      201 |
      202 |     // HEL-1405 — GUARD: passes before and after (current writes store {}).

      at Object.<anonymous> (src/utils/crossFilterRows.test.ts:199:9)

Test Suites: 1 failed, 1 total
Tests:       1 failed, 21 passed, 22 total
Snapshots:   0 total
Time:        2.941 s
Test Suites: 1 failed, 1 total
Tests:       1 failed, 21 passed, 22 total
exit=1 (expected: T1 red)
```

Restored: crossFilterRows.ts copied back from /tmp backup; the backup was removed.

### (b) OutputPanelContent.tsx line 239 `cfg.content` -> `""`

```
$ sed -i '239s/content={cfg.content}/content={""}/' OutputPanelContent.tsx; sed -n 239p ...
    content = <MarkdownRenderer content={""} />;
$ npm test -- --testPathPatterns=PanelContent.test
27:  ● PanelContent — output kind dispatch › renders the literal config.content of a placed markdown Output, ignoring a legacy fieldMapping
58:Test Suites: 1 failed, 1 total
59:Tests:       1 failed, 28 passed, 29 total
exit=1 (expected: T3 red)
```

Restored with `git checkout -- frontend/src/features/panels/ui/OutputPanelContent.tsx`; `git diff --stat` for that file is empty.

## Verification ledger

```
$ grep -n "isMarkdownPanel(panel)" frontend/src/features/panels/ui/PanelContent.tsx
238:  if (isMarkdownPanel(panel)) return <MarkdownRenderer content={panel.config.content} />;
exit=0

$ sed -n 237,239p frontend/src/features/panels/ui/OutputPanelContent.tsx
  } else if (kind === "markdown") {
    const cfg = readMarkdownConfig(output.config);
    content = <MarkdownRenderer content={cfg.content} />;
exit=0

$ grep -n "final case class MarkdownPanelConfig" backend/src/main/scala/com/helio/domain/panels/MarkdownPanel.scala
14:final case class MarkdownPanelConfig(content: String)
exit=0

$ sed -n 97,106p backend/src/main/scala/com/helio/domain/panels/OutputBindingSpec.scala
  // markdown → no fieldMapping slots and no data binding of any kind: a
  // markdown Output's text is the literal `config.content`, and
  // `validateFieldMapping` below rejects every `fieldMapping` key for this
  // kind (HEL-1139 owner ruling removed the bound Content mode). Vacuously
  // bindable, same as `table`. Narrative text bound to rows is the planned
  // `insight` kind (HEL-921), not this one. No `PanelBindingSpec`
  // predecessor (data-bound text/markdown panels were not in
  // `PanelBindingSpec.DataBindable` before HEL-904).
  val Markdown: OutputBindingSpec =
    OutputBindingSpec(OutputKind.Markdown, Vector.empty, Vector.empty, Map.empty)
exit=0

$ sed -n 327,328p backend/src/main/scala/com/helio/services/proposals/ProposalPanelSupport.scala
      case "text" | "markdown" =>
        panel.content.map(c => JsObject("content" -> JsString(c)))
exit=0

$ sed -n 558,563p backend/src/main/resources/db/migration/V94__outputs_model.sql
-- `metric`/`collection` -> {value, label, unit}; `chart` -> {xAxis, yAxis,
-- series, annotation}; `timeline` -> {time, event}; `table`/data-bound
-- `text` have no fixed slot list (`PanelBindingSpec.Table`'s empty
-- `allSlots`, and data-bound text/markdown is not in `PanelBindingSpec.
-- DataBindable` at all) -- every key is kept unfiltered for those two
-- kinds. Any dropped key is appended to a genuine (non-temporary)
exit=0

$ grep -n "No content yet" frontend/src/features/panels/ui/MarkdownPanel.tsx
15:          No content yet. Open panel settings to add markdown.
exit=0

$ grep -rn "readMarkdownConfig" frontend/src --include=*.ts --include=*.tsx
frontend/src/features/panels/ui/OutputPanelContent.tsx:15:  readMarkdownConfig,
frontend/src/features/panels/ui/OutputPanelContent.tsx:238:    const cfg = readMarkdownConfig(output.config);
frontend/src/features/pipelines/ui/outputEditor/configPatch.ts:21:  readMarkdownConfig,
frontend/src/features/pipelines/ui/outputEditor/configPatch.ts:55:  const markdown = readMarkdownConfig(config);
frontend/src/features/pipelines/ui/outputEditor/outputConfigTypes.ts:275:export function readMarkdownConfig(config: Record<string, unknown>): MarkdownOutputConfig {
exit=0

$ grep -rn "isPanelFilterableByDimension(" frontend/src --include=*.ts --include=*.tsx | grep -v test
frontend/src/utils/crossFilterRows.ts:116:export function isPanelFilterableByDimension(
frontend/src/features/panels/ui/OutputPanelContent.tsx:131:    isPanelFilterableByDimension(
frontend/src/features/panels/hooks/useCrossFilteredPanelData.ts:76:    if (!isPanelFilterableByDimension(output.kind, output.config, headers, crossFilter.dimension)) {
frontend/src/features/panels/hooks/useCrossFilterServerOps.ts:60:    isPanelFilterableByDimension(output.kind, output.config, schemaNames, dimension);
exit=0

$ sed -n 283p frontend/src/features/panels/ui/OutputPanelContent.tsx
      {isCrossFiltered && rowsTruncated && (
exit=0

$ grep -rn -i "datatype\|bound/authored\|content binding\|Source/Static\|bound-over-literal" openspec/specs/markdown-panel openspec/specs/markdown-panel-content-source openspec/changes/markdown-spec-literal-content/specs
openspec/specs/markdown-panel/spec.md:37:Resolved content is the bound DataType field's value when the panel is bound and data is available,
openspec/specs/markdown-panel/spec.md:47:- **WHEN** a markdown panel bound to a DataType field with row data is displayed in the grid
openspec/changes/markdown-spec-literal-content/specs/markdown-panel/spec.md:5:**Reason**: It resolved content from "the bound DataType field's value" and carried the scenario "Grid renders bound
openspec/changes/markdown-spec-literal-content/specs/markdown-panel/spec.md:6:content when panel is bound". DataTypes and the markdown Source (field-bound) mode no longer exist (HEL-904,
openspec/changes/markdown-spec-literal-content/specs/mcp-panel-composition-tools/spec.md:35:  DataType
openspec/changes/markdown-spec-literal-content/specs/mcp-panel-composition-tools/spec.md:44:  with a source-companion (non-pipeline-output) DataType id
exit=0

```

V9 note: the canonical `openspec/specs/markdown-panel/spec.md` lines 37/47 still hold the stale requirement until archive; the REMOVED+ADDED delta (specs/markdown-panel/spec.md) supersedes it on archive, and the Purpose edit does not touch requirements (tasks.md 1.4). The two mcp hits are the verbatim scenarios the proposal lists as follow-ups. Pre-archive, the remaining hits are the canonical stale text plus the deltas themselves.

## Gates (task 1.4 and 3.6)

```
$ openspec validate markdown-spec-literal-content --type change --strict
Change 'markdown-spec-literal-content' is valid
exit=0

$ npm run lint                      -> eslint . --max-warnings=0            exit=0
$ npm run format:check              -> All matched files use Prettier code style!   exit=0
$ npm run typecheck                 -> tsc --noEmit                          exit=0
$ npm run check:openspec            -> openspec/ is clean                    exit=0
$ npm run check:spec-structure      -> spec-structure check passed (465 canonical specs, 0 issues)   exit=0
$ npm --prefix frontend run build   -> PWA v1.3.0, precache 35 entries, files generated   exit=0
```
