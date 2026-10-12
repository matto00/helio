# HEL-1510: After HEL-1464: duplicate "— None —" in scatter pickers; RestApiForm test cast hides a missing mock; replace the CSS-source guard with a real overflow e2e

## Description

These follow-ups came from HEL-1464 (matto00/helio#957, d6aef6c46), which fixed the Output editor's desktop overflow,
seven labels that pointed at nothing, and two label/accessible-name mismatches.

1. The scatter size and color pickers list "— None —" twice, which logs a duplicate React key warning. This predates
   HEL-1464.
2. `RestApiForm.test.tsx:42` casts the mocked form `as unknown as`, which hides that the mock is missing `reset`.
3. `TableDisplayFields.css.test.ts` guards the overflow fix by reading the CSS source text, so a descendant selector can
   fool it. Replace it with, or add, a Playwright check at 1100px with an 86-character column name that asserts no
   overflow.

## Acceptance Criteria

- AC1: In the Output editor, a scatter chart's "Point size field" and "Color by field" pickers each list "— None —"
  exactly once, and opening them logs no duplicate-React-key warning. A test proves it and is red on the base SHA.
- AC2: `RestApiForm.test.tsx` builds its mocked form without an `as unknown as` (or any other widening) cast; the mock
  is a complete `UseRestSourceFormReturn` (including `reset`), so a future missing member is a type error. Red-first:
  removing the cast without adding `reset` fails `npm run typecheck`.
- AC3: A Playwright e2e spec opens a table Output whose columns include an 86-character name in the Output editor at a
  1100px-wide viewport and asserts no overflow (every Columns-row control and the Cell density control lie within the
  Configuration card's content box; the sheet's scrollWidth equals its clientWidth; the long name keeps non-zero width).
  It is shown to FAIL with HEL-1464's `TableDisplayFields.css` change reverse-applied and PASS with it restored
  (transcripts as evidence). The CSS-source-text guard is replaced by it.
- No new `eslint-disable`. Driver context: HEL-1508 lane may touch chart pickers; re-sync with origin/main before PR.
