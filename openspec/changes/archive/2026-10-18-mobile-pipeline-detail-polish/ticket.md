# HEL-1668: Mobile pipeline detail polish after HEL-1582: step-sheet deep link, toasts and Escape inside the sheet, schema panel placement, sticky hover, copy

## Description

Follow-up of HEL-1582 (PR #1060, merged as d83875077). Parent epic: HEL-1570. Phone pipeline detail, found during HEL-1582's gates:

1. **Deep link.** A phone `?step=` deep link should open that step's sheet (desktop selects the step).
2. **Toasts behind the sheet.** Toasts render behind an open modal sheet. For example, a failed delete reopens the sheet, and its error toast is hidden.
3. **Escape.** Pressing Escape on the schema panel inside the sheet closes the sheet too. It should close only the panel.
4. **Schema panel placement:**
   * It chooses above or below by its max height, not its real height. Since HEL-1582 it also opens below on desktop when it is tall.
   * Its height cap may ignore the bottom nav (unverified).
   * `OutputSchemaDisclosure` has literal pixel constants that mirror its CSS rem values.
5. **Sticky hover.** Hover fills stick after a touch tap. Gate them behind `@media (hover: hover)`.
6. **Copy (from HEL-1579's components):**
   * The source card says "Static" twice (meta line plus sample label).
   * The Output card's "off <step>" wording is unclear.
   * With an 8-digit row count at 375px, the relative time is ellipsized away completely (it is still in `title` and the Runs tab).
7. **Coverage.** No e2e covers an editor's refresh on phone; only a skeptic probe did.

## Acceptance Criteria

Each item fixed and covered by a test that fails first, at 375 and 768, in light and dark. Item 4's desktop behaviour is checked too.

## Run context (driver brief, overnight mode)

- Keep HEL-1608's desktop compact-spine behaviour (769-1100px) and its `hel1608` spec green.
- Sibling lanes in flight: HEL-1620 (touches `frontend/src/app/App.tsx`, `e2e/hel1579-pipeline-spine-layout.spec.ts`, `e2e/support/apiRequestCounter.ts`) and HEL-1669 (app-wide accent hover contrast tokens). Avoid their files; report any overlap before committing.
- Out of scope: HEL-1661 (viewer Run buttons, grantee banner), HEL-1670 (tidy, schedule 404s). No release.
- Reversible UI decisions are taken overnight with the recommended option and listed in the PR body under "UI decisions taken overnight".
