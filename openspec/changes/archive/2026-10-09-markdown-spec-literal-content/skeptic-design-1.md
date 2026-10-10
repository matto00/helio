## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed HEAD e88b929c6fa1d92d94a870c2277430374e844fc7 (= origin/main; the change dir is untracked).

### What I verified (with evidence)

**Every factual claim checked against origin/main code myself, not the design.md ledger. All hold:**
- Literal markdown panel renders `panel.config.content`: `PanelContent.tsx:238` `if (isMarkdownPanel(panel)) return <MarkdownRenderer content={panel.config.content} />;`
- Placed markdown Output renders `readMarkdownConfig(output.config).content`: `OutputPanelContent.tsx:237-239`. Neither path reads `fieldMapping`.
- `MarkdownPanelConfig(content: String)`: `MarkdownPanel.scala:14`. `OutputBindingSpec.Markdown` has empty slots (`:105-106`) and `validateFieldMapping` (`:160`) rejects every key, with a markdown-specific message.
- Proposal text/markdown get `{"content": ...}` only: `ProposalPanelSupport.scala:327-328`. `TextPanelConfig(content: String)` (`TextPanel.scala:14`) backs the "text/markdown literal `content`" wording in the mcp MODIFIED block.
- Legacy rows: V94:558-563 keeps data-bound text/markdown `fieldMapping` unfiltered. `grep -l fieldMapping` over migrations finds nothing after V94. V117 only drops `format` for markdown (`V117…sql:20`). `pipeline-output-sheet/spec.md:84` names the legacy `fieldMapping.content` case.
- The placeholder text in the ADDED scenario matches `MarkdownPanel.tsx:15` exactly. `!content` covers both null and empty.
- MCP: `helio-mcp/src/tools/placements.ts:77-78` documents literal `content` plus the `helio://uploads/image/<id>` ref for text/markdown. The rewritten upload_image scenario is true.
- `crossFilterRows.ts:91-92` maps markdown to `readMarkdownConfig(...).fieldMapping`. `safeRecord` (`outputConfigTypes.ts:166-175`) keeps string values, so `{fieldMapping:{content:"region"}}` returns true today. Callers cited (`OutputPanelContent.tsx:131`, `useCrossFilteredPanelData.ts:76`, `useCrossFilterServerOps.ts:60`) are correct. `readMarkdownConfig` stays used by `OutputPanelContent.tsx:238` and `configPatch.ts:55`, so dropping only the crossFilterRows import is safe.

**OpenSpec mechanics:**
- `openspec validate markdown-spec-literal-content --type change --strict` prints "Change … is valid" (exit 0).
- The REMOVED+ADDED choice is necessary. I rewrote the markdown-panel delta as MODIFIED in a scratch copy and `openspec validate` failed with exit 1: "MODIFIED … omits scenario(s) the current spec still has: 'Grid renders bound content when panel is bound'". The design's D1 claim is true. Note: AC1's text says "(MODIFIED delta)", so the PR body has to explain this deviation.
- I ran a test archive in a scratch copy (`openspec archive -y`) and it exits cleanly ("+1 added, -1 removed, ~2 modified"). In the resulting mcp spec, `diff` against canonical shows only line 22 and lines 61-62 changed. The kept verbatim DataType text produces zero net diff.
- Baseline `check-spec-structure.mjs` and `check-openspec-hygiene.mjs` both exit 0.

**Test workability:**
- T1 fails on current code. `fieldMappingForKind("markdown")` returns `{content:"region"}`, so the call returns true where T1 expects false. The RED-FIRST label is honest.
- T3 harness exists (`PanelContent.test.tsx`: `getOutputByIdMock`, `makeOutput`, `makeOutputPanel`, `renderWithStore`, `describe("PanelContent — output kind dispatch")`). The global react-markdown mock (`jest.config.cjs:12` → `src/test/reactMarkdownMock.tsx`) renders raw children under `data-testid="markdown-content"`, so textContent is exactly `"# Literal heading"`. Under mutation (b) (`cfg.content`→`""`), `MarkdownPanel` renders the placeholder and has no `markdown-content` testid, so `findByTestId` fails. T3's GUARD claim is workable.

**Item 5, stale verbatim text in the mcp MODIFIED block:** acceptable. My test archive shows those lines round-trip byte-identical, so it adds no new claim. It is acceptable only if the follow-up is actually filed; see the non-blocking note.

### Verdict: REFUTE

### Change Requests

1. **The plan changes behaviour (AC4) but no spec records it, and a living spec's wording stays literally broader than the code.** After task 2.2, a markdown Output is never a cross-filter target, even with a stored legacy `fieldMapping`. That behaviour appears in no spec. The ADDED markdown-panel requirement only says `fieldMapping` "SHALL NOT change what is rendered", which says nothing about filterability. Meanwhile `openspec/specs/panel-cross-filtering/spec.md:47` says an active cross-filter "SHALL narrow every target panel … whose Output field mapping references the filter's dimension". A legacy markdown Output with `fieldMapping.content: "region"` has exactly that, and the change makes it not narrow. Fix: pre-write a delta under `specs/panel-cross-filtering/spec.md`. Preferred is an `## ADDED Requirements` block (no verbatim copy needed), e.g. "A markdown Output is never a cross-filter target": a `markdown`-kind Output has no field mapping (HEL-1139), so a legacy stored `fieldMapping` (V94) SHALL NOT make it a target. Give it one scenario. Back it with a ledger V-command (e.g. `sed -n 86,100p frontend/src/utils/crossFilterRows.ts` after the change) and with T1/T2. Rerun `openspec validate --strict` and a test archive.

2. **Mutation 3.5(a) is underspecified and can give a false "T1 fails".** The task says "re-add the markdown case". Task 2.2 also deletes the `readMarkdownConfig` import, and Jest here uses `ts-jest` (`frontend/jest.config.cjs:4`). Re-adding only the `case` makes the suite fail on a compile/ReferenceError ("Cannot find name 'readMarkdownConfig'"), not on T1's assertion. That would look like a passing mutation while proving nothing about T1. Rewrite 3.5(a) as an exact procedure:
   - `git -C <worktree> stash push frontend/src/utils/crossFilterRows.ts`, or restore both the import line and the two case lines.
   - Run `npm test -- --testPathPatterns=crossFilterRows`.
   - The pasted output MUST show T1 failing with `Expected: false` / `Received: true`, with T2 and the other tests still passing.
   - Then restore and re-run green.

   Apply the same rule to 2.1's pre-change T1 transcript: it must be an assertion failure, not a compile error.

3. **The "exact text" in tasks 1.1, 1.2 and 2.2 contains backslash-escaped backticks (`\`config.content\``, `\`helio://uploads/image/<id>\``, `\`markdown\``, `\`fieldMapping\``) inside inline code spans.** In a Markdown code span the backslash is literal, so a literal-minded Haiku executor copying "exact text" will likely write `\`` into the specs and the TS comment. Put each replacement string in its own fenced code block with real backticks. Also replace 1.3's "(wrap at 120 cols)" with the exact pre-wrapped lines (the surrounding file wraps near 100), so there is nothing to interpret.

### Non-blocking notes
- No task files the follow-ups listed in proposal Non-goals: the mcp collection "bound to the DataType" and "source-companion DataType id" scenarios, the `propose_dashboard` type set (`metric/chart/table/…/collection`, while `helio-mcp/src/tools/proposal.ts:44` is `text/markdown/image/output/form`), markdown-panel's top-level `content` and "text … content: null". Add an explicit orchestrator/delivery step to create that ticket (Follow-up label, relatedTo HEL-1405). Otherwise item 5's justification rests on a follow-up that may never exist.
- 2.1 does not say which command to run for the pre-change transcript. Reuse 3.4's `npm test -- --testPathPatterns="crossFilterRows|PanelContent.test"`.
- T3's `queryByText("Bound value")` assertion is trivially true: the markdown path never touches rows. Mutation (b) is what makes T3 real. Fine as a GUARD, but don't describe it as proving `fieldMapping` is ignored.
- The PR body should explain AC1's "(MODIFIED delta)" → REMOVED+ADDED deviation, citing the validator error reproduced above.
