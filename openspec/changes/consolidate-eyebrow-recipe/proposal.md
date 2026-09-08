## Why

DESIGN.md's `.eyebrow` utility exists in `theme.css`, but 29 rule blocks across 23 component CSS
files re-declare the same mono/uppercase/tracked recipe locally. Each copy is a place the recipe can
drift from the tokens, and drift in this exact family is what HEL-346 exists to eliminate — HEL-451
shipped `var(--weight-normal)` against a `--weight-regular` definition and rendered at computed 600
instead of 400 through a fully green suite.

## What Changes

- Component CSS blocks that replicate the recipe adopt the shared `.eyebrow` utility instead.
- **Only where measurement proves adopting it does not change computed style.** Matching declared
  values is NOT sufficient: replacing declarations with a utility class can change specificity and
  cascade position, so EVERY converted block is measured. Blocks with no consumer, an unreachable
  rendered state, or a divergent `font-size` are not converted at all. Counts are DERIVED by the
  executor from task §0's predicates, not read from these artifacts.
- Blocks left unconverted are listed in the PR with a stated reason, never left silent.

## Capabilities

### New Capabilities

- `eyebrow-utility-consolidation`: the eyebrow recipe has one definition — the shared utility — and
  a component adopts it only where doing so is computed-style-neutral, with any exception recorded.

## Impact

- Component CSS files under `frontend/src/features/**` and `frontend/src/shared/**` (23 files
  contain candidate blocks; the converted set is determined by measurement, not by the count).
- Corresponding `className` additions where a block is replaced by the utility.
- No change to `theme.css`, `.eyebrow`, or the `--eyebrow-*` tokens.
- No behavioural or backend change.

## Non-goals

- HEL-830 (off-scale spacing literals), HEL-680 (chip padding) — this is one recipe, not a token
  sweep.
- New eyebrow variants or tokens; changing `.eyebrow` itself.
- Converting a block whose computed style would change, without justification. **A sweep that
  silently folds a differently-weighted label into `.eyebrow` is a visual regression arriving as a
  refactor** — the one outcome this change must not produce.
