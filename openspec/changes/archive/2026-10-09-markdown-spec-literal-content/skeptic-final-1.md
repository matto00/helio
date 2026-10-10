## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD `b8530065dfaccb539acf31b5584789aef5a6a2c1`. The base came from `resolve-review-base.sh`, which exited 0 and returned `e88b929c6fa1d92d94a870c2277430374e844fc7`. The branch is one commit on top of that base.
Spawn-cwd guard: `READY ambient=/home/matt/Development/helio branch=task/markdown-spec-datatype-cleanup/HEL-1405`.

### What I verified (with evidence)

**Behaviour claims in the spec deltas, checked against the code myself:**

- **markdown-panel ADDED requirement:**
  - A literal markdown panel renders `panel.config.content` (`PanelContent.tsx:238`).
  - A placed markdown Output renders `readMarkdownConfig(output.config).content` (`OutputPanelContent.tsx:237-239`). Neither path reads rows or `fieldMapping`.
  - The placeholder string matches `MarkdownPanel.tsx:15` exactly.
- **Backend has no markdown binding:**
  - `OutputBindingSpec.Markdown` has empty slots.
  - `validateFieldMapping` rejects every key, with a markdown-specific message (`OutputBindingSpec.scala:160-168`).
- **Legacy rows:**
  - Only V5/V33/V43/V44/V53/V55/V57/V58/V76/V94 mention `fieldMapping`. Nothing after V94 clears it.
  - V117 only drops `format` for markdown. So the "legacy stored `fieldMapping`" premise holds.
- **panel-cross-filtering ADDED requirement:** every targeting decision goes through `isPanelFilterableByDimension`:
  - `useCrossFilterServerOps.ts:53-60` (`isCandidate` false → `NO_CROSS_FILTER`).
  - `OutputPanelContent.tsx:127-136` (`isEligibleTarget`).
  - `useCrossFilteredPanelData.ts:72-76`.
  - The only cross-filter `LoadedScopeDisclosure` is `OutputPanelContent.tsx:283`, gated on `isCrossFiltered`, which in turn requires `isEligibleTarget`.
  - With the `markdown` case gone, `fieldMappingForKind` returns `{}`, so a markdown Output is never a target. "Never a target / no disclosure / content unchanged" is true.
- **mcp MODIFIED blocks:**
  - `helio-mcp/src/tools/write.ts:685-694` (`upload_image`) returns the ref for "a markdown panel's config.content" / "image panel's config.imageUrl".
  - `placements.ts:76-80` documents literal `content` for text/markdown.
  - Both rewritten phrases are true.

**The three edited canonical Purpose lines:**

- **E1 (markdown-panel):** matches the remaining requirements (store, PATCH, literal render).
- **E2 (markdown-panel-content-source):** matches exactly the three requirements left in that spec: the URL scheme, images constrained to the panel, and the docs.
- **E3 (mcp):** "author literal text/markdown panel content" is backed by `create_content_panel`. The `TBD` and the "Source/Static" and "bind text/markdown" phrases are gone, confirmed by the diff.

**evidence.md:** I re-ran the material ledger lines (V1-V6, V10, V11), and their content matches the code at HEAD.

**Test labels, mutation-checked myself:**

- **T1 (RED-FIRST):** I restored `crossFilterRows.ts` from `e88b929c6` and ran `npm --prefix frontend test -- --testPathPatterns=crossFilterRows`.
  - Result: `1 failed, 21 passed`. The only failure is T1, with `Expected: false` / `Received: true`. It is an assertion failure, not a compile error.
  - T2 passed on the old code, so it is honestly a GUARD.
  - File restored.
- **T3 (GUARD):** I changed `cfg.content` to `""` in `OutputPanelContent.tsx`.
  - Result: T3 failed (`1 failed, 28 passed`).
  - Reverted with `git checkout`.
- **Green at HEAD:** `npm --prefix frontend test -- --testPathPatterns="crossFilterRows|PanelContent.test"` → 51/51 passed.
- After the mutations, `git status` shows only the expected untracked `evaluation-1.md`.

**Gates (fresh runs):** all exit 0.

- `openspec validate markdown-spec-literal-content --type change --strict` → valid.
- `npm run check:openspec` → clean.
- `npm run check:spec-structure` → 465 specs, 0 issues.
- `npm run lint` and `npm run typecheck`.
- Prettier on the changed TS and delta files → clean.

**Archive (scratch copy `/tmp/hel1405-skeptic`, since removed):**

- `openspec archive -y` exited 0 with markdown-panel +1/-1, mcp ~2, and panel-cross-filtering +1.
- Diffing the archived specs against canonical:
  - mcp changes only at :21 and :60-61.
  - panel-cross-filtering gains the block at the end. Its reference to "the narrowing requirement above" resolves.
  - markdown-panel swaps in the literal-content requirement.
- `check-spec-structure.mjs`, run from the scratch copy's own `scripts/` (repoRoot = the scratch copy) → 0 issues.

**Post-archive sweep of living specs:**

- Grep for `datatype|bound/authored|content binding|Source/Static|bound-over-literal|bound content|bound field` over the four touched specs: the only hits are `mcp-panel-composition-tools` :69 and :78 (the collection and source-companion scenarios, explicit Non-goals) and :280 ("DataType/binding fields SHALL NOT be accepted", which is a prohibition and true).
- A broader grep for markdown + bound/binding/fieldMapping across all specs finds only `pipeline-output-sheet` (literal-only, rejects `fieldMapping`), `panel-manual-refresh` ("no bound Output"), and the new text.
- No living spec still describes field-bound markdown content.

**UI (step 4):** skipped. Nothing renders differently. The only production change is that a legacy markdown Output stops being a cross-filter target, and its rendered content is unchanged (T3 plus mutation b). No CSS or component markup changed.

### Verdict: CONFIRM

### Non-blocking notes

- AC5's "and PR body" plus the REMOVED+ADDED-vs-MODIFIED rationale have to land in the PR body at Delivery. The proposal's Non-goals follow-up ticket (stale mcp collection/DataType scenarios, `propose_dashboard` type set, markdown-panel top-level `content` / "text … content: null") still needs filing.
- Outside this ticket's markdown scope, but similar: `panel-content-sizing/spec.md:47-53` still has "Text panel with bound data/bound content" scenarios. That is worth adding to the same follow-up.
- T3's `queryByText("Bound value")` assertion is vacuous (the markdown path never renders rows). The `textContent` assertion is the one that matters, and mutation b proves it.
