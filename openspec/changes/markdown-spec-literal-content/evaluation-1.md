## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD `b8530065dfaccb539acf31b5584789aef5a6a2c1` against base `e88b929c6` (resolved via
resolve-review-base.sh, exit 0).

### Phase 1: Spec Review — PASS
Issues: none

- AC1: the REMOVED+ADDED delta in `specs/markdown-panel/spec.md` drops "Grid renders bound content when panel is
  bound" and the "bound DataType field's value" wording. The new requirement says content is the literal
  `config.content` (for a panel or a placed Output). The `TBD` Purpose is replaced with E1.
- AC2: the `markdown-panel-content-source` Purpose no longer mentions Source/Static modes or bound-over-literal
  resolution.
- AC3: the Purpose was rewritten (E3). The MODIFIED blocks for "upload_image MCP tool" and "Proposal panels accept a
  generic config passthrough" change only the two markdown-binding phrases ("bound/authored markdown panel" became
  "literal `config.content`"; "text/markdown content binding" became "text/markdown literal `content`"). I compared
  them line by line against the canonical spec at :10-25 and :54-80. Leaving the DataType collection scenarios in
  place verbatim is an explicit Non-goal.
- AC4: the `markdown` case and the `readMarkdownConfig` import are removed from `crossFilterRows.ts`. The ADDED
  `panel-cross-filtering` requirement covers the change. Tests T1, T2 and T3 are present and honestly labelled
  (see Phase 2).
- AC5: `npm run check:openspec`, `npm run check:spec-structure` and
  `openspec validate markdown-spec-literal-content --type change --strict` all exit 0 (my own runs). No PR body
  exists yet; C1 applies to it at Delivery.
- Factual statements re-verified on the code (I re-ran the design.md ledger myself):
  - V1: `PanelContent.tsx:238` renders `panel.config.content`.
  - V2: `OutputPanelContent.tsx:237-239` renders `readMarkdownConfig(output.config).content`.
  - V3: `MarkdownPanel.scala:14` has `MarkdownPanelConfig(content: String)`.
  - V4: `OutputBindingSpec.scala:97-106` gives markdown no slots, and `validateFieldMapping` rejects every key.
  - V5: `ProposalPanelSupport.scala:326-328` sends text/markdown as `{"content": ...}` only.
  - V6: V94 keeps data-bound text/markdown `fieldMapping` unfiltered. Only V43/V44/V76/V94 touch `fieldMapping`, so
    no later migration clears it.
  - V7: the placeholder string "No content yet. Open panel settings to add markdown." exists (`MarkdownPanel.tsx:15`).
    `MarkdownRenderer` wraps that view, so the placeholder scenario holds for empty content on both paths.
  - V10: the three callers gate target status on `isPanelFilterableByDimension` (`OutputPanelContent.tsx:131`,
    `useCrossFilteredPanelData.ts:76`, `useCrossFilterServerOps.ts:60`).
  - V11: the disclosure at `OutputPanelContent.tsx:283` is gated on `isCrossFiltered`, which requires
    `isEligibleTarget` (:127-136, :151).
  - The ADDED cross-filter requirement's reference to "the narrowing requirement above" matches
    `panel-cross-filtering/spec.md:46-47`.
- Tasks: all items are ticked and match the diff.
- Scope: there is no scope creep.
- CONSTRAINTS:
  - C1: honored for the specs. Every claim maps to a V-command with output pasted in evidence.md.
  - C2: honored. I reproduced the labels independently (Phase 2).

### Phase 2: Code Review — PASS
Issues: none

Gates I ran fresh in WORKTREE_PATH:

| Gate | Result |
|---|---|
| `npm run lint` | exit 0, zero warnings |
| `npm run format:check` | clean |
| `npm run typecheck` | clean |
| `npm test` | 44 suites / 433 tests, then 501 suites / 5254 tests, all passed |
| `npm --prefix frontend run build` | succeeded |
| Targeted run (`crossFilterRows\|PanelContent.test`) | 51/51 passed |

Test-label honesty (C2), re-run by me:

- **Mutation (a)**, `crossFilterRows.ts` restored to its `e88b929c6` contents: exactly 1 failure, "markdown: a legacy
  stored fieldMapping never makes it filterable", with `Expected: false` / `Received: true`. The other 21 tests
  passed, so T2 passes on the old code, which confirms it is a GUARD. This confirms T1 is RED-FIRST.
- **Mutation (b)**, `cfg.content` changed to `""` at `OutputPanelContent.tsx:239`: T3 fails (1 failed, 28 passed),
  so T3 is a failable GUARD.
- Both mutations were restored, and `git status` is clean.

Code quality:
- The production diff is small. The removed import is no longer used (lint confirms). The JSDoc addition explains
  why `markdown` is absent.
- `readMarkdownConfig` is still used by `OutputPanelContent.tsx` and `configPatch.ts`, so it is not dead code.
- There are no type escape hatches, TODOs or dead code.

### Phase 3: UI Review — N/A
The triggers technically match (`frontend/**`, `openspec/specs/**`), but there is no rendered UI change. The only
production change is that a legacy markdown Output with a stored `fieldMapping` stops being a cross-filter target.
Markdown renders no rows, so the visible content is unchanged; T3 covers this at component level. The driver
directed that servers not be started. No live check was run.

### Overall: PASS

### Non-blocking Suggestions
- The quoted phrase "a field mapping that references the filter's dimension" in the ADDED `panel-cross-filtering`
  requirement paraphrases the body of the target requirement ("whose Output field mapping references the filter's
  dimension"). It is accurate in substance; an exact quote would be marginally clearer.
- T3's `queryByText("Bound value")` assertion is weak: rows are never rendered for markdown on either code path.
  The load-bearing assertion is the `textContent` equality, and mutation (b) proves that one is failable.
