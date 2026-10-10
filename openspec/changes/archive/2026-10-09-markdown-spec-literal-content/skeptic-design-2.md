## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed HEAD e88b929c6fa1d92d94a870c2277430374e844fc7 (= origin/main; the change dir is still untracked).
Spawn-cwd guard: `READY ambient=/home/matt/Development/helio branch=task/markdown-spec-datatype-cleanup/HEL-1405`.

### What I verified (with evidence)

**Round-1 CR1 (behaviour change had no spec): addressed.**
- A new `specs/panel-cross-filtering/spec.md` delta adds the requirement "A markdown Output panel is never a cross-filter target", with two scenarios.
- I checked each claim in it against origin/main code, with task 2.2 applied, and all of them hold:
  - "SHALL NOT be a cross-filter target": the three target decisions all depend on `isPanelFilterableByDimension`, and nothing else decides targeting:
    - `useCrossFilterServerOps.ts:55-60`: `isCandidate`, then `NO_CROSS_FILTER` with mode `"none"`.
    - `OutputPanelContent.tsx:127-136`: `isEligibleTarget`.
    - `useCrossFilteredPanelData.ts:72-76`: the early returns.
  - After 2.2, `fieldMappingForKind("markdown")` falls to `default: return {}`, so the result is false whatever `fieldMapping` is stored.
  - "SHALL NOT show a cross-filter loaded-scope disclosure": the only cross-filter `LoadedScopeDisclosure` is `OutputPanelContent.tsx:283`, gated on `isCrossFiltered && rowsTruncated`. `isCrossFiltered` (`:151`) requires `isEligibleTarget`, which goes false. The disclosure in `TableRenderer.tsx:814` is the table's own and does not apply to markdown. `grep isCrossFiltered|crossFilterMode=` shows no other consumer.
  - "renders its literal `config.content` unchanged": the markdown branch at `OutputPanelContent.tsx:237-239` reads only `readMarkdownConfig(output.config).content`, never rows.
  - Cross-filter targeting is frontend-only. The only backend hit is a comment in `NodeSnapshotFilterSql.scala:64` about the `eq` op itself. `PublicDashboardViewerPage.tsx:134` passes `crossFilterMode="none"`.
  - "the narrowing requirement above": after a test archive, the ADDED block lands at the end of `panel-cross-filtering/spec.md` (diff: `153a154,171`). The narrowing requirement (canonical `:46`) is above it, so the reference resolves.

**Round-1 CR2 (mutation procedure underspecified): addressed.**
- 3.5(a) now restores the whole base file (`git show $(git merge-base HEAD origin/main):…`). That brings back the import and the case together, so the failure can only come from an assertion, not a compile error.
- 2.1 and C2 both require the transcript to show `Expected: false` / `Received: true`, and 2.1 says outright that "a compile error does not count".
- T2 passes on pre-change code: `{fieldMapping:{}}` gives an empty mapping, and a config with no `fieldMapping` gives `safeRecord` → `{}`. So "others pass" holds.
- Existing test `crossFilterRows.test.ts:171` (`markdown/collection/timeline all read fieldMapping the same way`) asserts markdown===true. 3.1 updates it correctly.

**Round-1 CR3 (backslash-escaped backticks): addressed.**
- E1-E4 are now fenced blocks with real backticks.
- 1.3 gives E3 as pre-wrapped lines. The target lines 4-7 of `mcp-panel-composition-tools/spec.md` match the file exactly.
- The 1.1 and 1.2 targets match too: `markdown-panel/spec.md:4` is the TBD line, and `markdown-panel-content-source/spec.md:4` is the Source/Static line.
- The backslash-backtick guard grep (`grep -c '\\`' openspec/specs/*/spec.md | grep -v ':0'`) prints nothing at baseline, so it is a valid zero-hit guard.

**Factual claims re-checked against code:**
- E2's wording matches the three requirements left in `markdown-panel-content-source` (uploads scheme, the image constraint, documented).
- The placeholder text matches `MarkdownPanel.tsx:15` exactly.
- `placements.ts:77-78` backs the upload_image MODIFIED text.
- The T3 harness exists: `renderWithStore` and `makeOutputPanel` are imported (`PanelContent.test.tsx:3,6`), `makeOutput` is at `:36`, the describe block is at `:89`, and `PanelContent` accepts `rawRows`/`headers` (`PanelContent.tsx:32-33`).

**OpenSpec mechanics, run fresh:**
- `openspec validate markdown-spec-literal-content --type change --strict` → "Change 'markdown-spec-literal-content' is valid", exit 0.
- A test `openspec archive -y` in a scratchpad copy reported: markdown-panel +1/-1, mcp ~2, panel-cross-filtering +1, exit 0. The diffs match intent.
- `check-spec-structure.mjs` on the archived scratch copy (its root resolves to the scratch copy) → "465 canonical specs, 0 issues", exit 0. On the worktree baseline, `check-spec-structure` and `check-openspec-hygiene` both exit 0.

**Scope against Linear:** the Linear description has no formal ACs; the ACs in ticket.md were written by the planner. Item 2's "no behaviour change" premise is stale for legacy V94 rows. ticket.md's Planning note and design D3 both say so openly, and the plan labels tests honestly instead of hiding it. That is consistent with HEL-1139's no-binding ruling.

### Verdict: CONFIRM

### Non-blocking notes (things a Haiku executor could misread)
- design.md heads E3 "(4 lines)", but the block has 3 lines and tasks 1.3 says 3. Copy the fenced content; ignore the label.
- E4 says to add lines "before the closing `*/`", but in the current JSDoc the `*/` shares a line with text (`… which never matches any dimension. */`). The executor has to split that line, moving `*/` after E4's last line. Either valid placement is fine; the result must still be a single JSDoc block.
- The 1.3 guard command sits inside an inline code span that itself contains a backtick (`'\\`'`). The intended command is `grep -c '\\`' openspec/specs/*/spec.md | grep -v ':0'`. I ran it, and it works and prints nothing.
- C1: the ledger has no line showing the disclosure gate behind the new "SHALL NOT show a … disclosure" statement. Consider adding `sed -n 283p frontend/src/features/panels/ui/OutputPanelContent.tsx` (`{isCrossFiltered && rowsTruncated && (`) next to V10 in evidence.md.
- `--testPathPatterns=PanelContent.test` also matches `OutputPanelContent.test.tsx`. That is harmless: it runs more tests.
- Carried over from round 1: the Non-goals follow-up ticket (Follow-up label, relatedTo HEL-1405) is assigned to the orchestrator only in design.md Planner Notes. File it at Delivery. The PR body should say why AC1/item 1 uses REMOVED+ADDED instead of MODIFIED, citing the validator's "omits scenario(s)" error.
