## Skeptic Report — design gate (round 3, skeptic-design-3.md)

Reviewed the current ticket.md (six owner rulings), proposal.md, design.md, tasks.md and
specs/{output-conditional-formatting,output-routes-api,mcp-output-tools}/spec.md. Worktree HEAD is
5dceeae9d11ca1b0a8891ad31f0a2c4397b92521; no code change yet, only the change dir is untracked. I checked every claim
against the code myself and did not rely on the round-1 or round-2 narratives.

### What I verified (with evidence)

**Backend hook points.**
- `OutputConfigValidation.validateConfig` gates the key check on `ValidateWrite`, then runs fieldMapping/`OutputCompare`/
  `PayloadOptIn` on the MERGED config (OutputConfigValidation.scala:180-197).
- `PipelineCreatePreflight.validateOutputConfig` chains `validate` → `OutputCompare` → `PayloadOptIn` separately
  (PipelineCreatePreflight.scala:204-208).
- D2's two chain points are therefore correct and sufficient.
- `KnownKeys` (lines 21-25) feeds `KeysDoc`. That reaches AssistantProposalToolSchemas.scala:256,397 and
  RefinementEditShape.scala:266.

**Hand-copied key lists.** I ran `git grep pinnedColumns` outside panels/shared/tests/archive. The only hand copies are
the three `schemas/**` request schemas and `helio-mcp/src/tools/outputs.ts`, which tasks 2.1/2.2 cover. The
output-routes-api delta covers the openspec copy.

**Round-2 CR (unit colour), checked against the code.**
- MetricRenderer.tsx renders the unit as a child of `.panel-content__metric-value`, which is `color: inherit`
  (PanelContent.css:15-25).
- The unit itself is `color-mix(currentColor 60%)` (PanelContent.css:36-42).
- D4 now puts the tone class on a new inner span that wraps only the glyph, the value and the sr text. The unit stays a
  sibling outside that span, and its CSS is untouched. Structurally this fixes the defect.

**Rendering seams.**
- `CollectionRenderer` maps each raw string row to one `MetricRenderer`.
- `DataGrid` keeps the caller's column order as given (`resolvedColumns = columns`, DataGrid.tsx:437).
- `TableRenderer.orderedColumns` (:171-177) owns `columnOrder`, so "first visible data cell" is `columns[0]` after
  ordering, which makes it unambiguous.
- `rowClassName(row)` already takes the row object (DataGrid.tsx:309, :1228).
- The `<td>` currently gets only the pinned class (:1250-1256), so an additive `cellClassName` is clean.

**Editor.**
- `configPatch.buildConfigPatch` diffs the built config against the build of `openingParams` (configPatch.ts).
- D7's "emit only when rules exist or the stored key existed, `[]` to clear" yields:
  - no diff when untouched;
  - `[]` when the last rule is removed;
  - the full list when a rule is added.
- `buildAggregateTailConfigs` has a metric branch (buildOutputConfig.ts:183+), so "BOTH builder paths" is real.
- `columnOptions(capabilities)` exists (outputConfigTypes.ts:153).

**Tokens and contrast.** The three intents and their `-surface` washes exist in both themes (theme.css:197-218, 282-288).
contrast-audit §2 records intent-on-own-wash, post-remediation, at >= 4.5.

**ACs traced to tasks.**
- AC1 (metric token colour, both themes) → 3.3, 4.4, 4.7, C4.
- AC2 (table cell/row) → 3.4, 3.5, 4.4.
- AC3 (invalid rejected, no-rules unchanged) → 1.2, 1.3, 4.1, 4.2, C3.
- The six owner rulings are each reflected in the spec and design (rule model, colouring targets, three tones,
  glyph + label, table column/target independence, delta independence).
- No scope drift found.

**New defect: the CSS-dependent proofs are routed to a harness that cannot measure CSS.**
- `frontend/jest.config.cjs` maps every `\.(css)$` import to `src/test/styleMock.js`, which is `module.exports = {};`.
  Under Jest/jsdom no stylesheet (theme.css, PanelContent.css, DataGrid.css) is ever applied. `getComputedStyle` can
  therefore never resolve `--app-warning`, a `-surface` wash, or `color-mix(currentColor 60%)`.
- The existing `*.css.test.ts` guards read CSS source as text. They do not compute styles.
- Task 4.7 says "e2e (Playwright) **or Jest computed-style proof** that a metric rule renders the `--app-*` token
  colour in both themes". The Jest branch cannot be red, so it is a vacuous proof of AC1 and of the spec scenario
  "computed colour equals `--app-warning` in the light theme and in the dark theme".
- Task 4.4 is listed under "Renderer tests" (Jest). It asserts:
  - "unit colour equals the no-rules render under a non-default `--panel-text-override`" (the round-2 CR's required
    guard);
  - "cell-REPLACES-row wash".

  Both are CSS-cascade properties. In jsdom the unit's computed colour is identical whether or not the round-2 bug is
  present, so this guard cannot fail on the mutation it exists to catch. That violates C1 ("guards proven failable by
  mutation").

### Verdict: REFUTE

### Change Requests

1. **tasks.md 4.4 and 4.7: route every CSS-dependent assertion to a harness that applies CSS, and make the Jest parts
   structural.**
   - (a) **Task 4.7:** delete "or Jest computed-style proof". The token-colour proof for AC1 must be a Playwright
     computed-style assertion on the running app (this worktree's pinned ports, via the repo's e2e entry point), in
     light AND dark: the value's `color` equals the resolved `--app-<tone>`.
   - (b) **Unit-colour guard.** Move the unit-colour-under-`--panel-text-override` assertion to that same Playwright
     spec. In 4.4, replace the Jest version with a structural assertion that does fail on the round-2 defect in jsdom:
     the unit element is not a descendant of the tone-classed element, and it carries no tone class. Label it as a
     structural guard.
   - (c) **"One wash per cell, cell replaces row" (spec scenario "Cell rule inside a washed row", including the pinned
     cell).** The Jest test may assert classes only: the row-tone class is on the `<tr>`, and the cell-tone class is
     on that `<td>`. The no-layering and pinned-gradient behaviour must be proven by a Playwright computed `background`
     check on an unpinned cell and on a pinned cell:
     - a row-washed cell shows exactly one row wash;
     - a cell-rule cell inside a washed row shows only its own tone's wash.
   - (d) **Mutation proof (C1).** State that each of these Playwright assertions must be shown red under a mutation:
     - tone class on the outer value span, for (b);
     - row wash also painted on the `<tr>`, for (c).

### Non-blocking notes

- **Editor empty label.** In the editor, an empty optional label input should be omitted from the rule (or written as
  `null`), never written as `""`. The server rejects `""` (1-60 after trimming). Say so in D7 so the "inline errors
  mirror the server" rule does not flag an untouched optional field.
- **`eq`/`neq` value type round trip.** For `eq`/`neq`, D7 does not say whether the editor writes a numeric-looking
  value as a JSON number or a string. Evaluation makes the two equivalent, so this is only a round-trip churn question
  (a stored `5` re-saved as `"5"`). Pin the choice in the seam fixture's `valid` cases.
- **Row-rule tooltip.** D5 says "the styled element carries `title`", but for a row rule the styled element is the
  `<tr>`. Specify that the row-rule glyph wrapper in the first visible cell carries the `title`, so the tooltip clause
  of the spec is met at that one place.
- **Final-gate check (carried forward from round 2).** Glyph optical size at `--text-3xl` vs. the compact `--text-xl`
  metric, and ellipsis on a long toned cell (keep the wrapper inline), are still for the C4 browser pass to judge.
