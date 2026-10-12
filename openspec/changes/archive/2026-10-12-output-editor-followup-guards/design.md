## Context

See proposal.md - Why. Ground truth (verified at b71af7072):
- `ChartDisplayFields.tsx:103` builds `fieldSelectOptions = [{value:"", label:"— None —"}, ...fieldOptions]` for the
  scatter selects; its prop doc says `fieldOptions` carries no "— None —" prefix. Its only production caller,
  `OutputKindFields.tsx:176` (`ChartKindFields`), receives `aggFieldOptions` from `OutputKindConfigCard.tsx:88`, i.e.
  `aggColumnOptions()` (`outputConfigTypes.ts:204`), which already starts with that same entry. Two options with value
  "" -> duplicate key. The Annotation `BoundOrLiteralField` in the same component uses `fieldOptions` as-is and so
  shows "— None —" once today (exercised by `OutputEditorSheet.configPatch.test.tsx:208`).
- `RestApiForm.test.tsx:42` ends `} as unknown as UseRestSourceFormReturn;`; `useRestSourceForm.ts:98,161` has `reset`.
- `TableDisplayFields.css.test.ts` reads CSS source; HEL-1464's fix is the `TableDisplayFields.css` hunk of d6aef6c46
  (base-rule `min-width: 0` on `__row`, `__column-list-container`, `__column-row`; `grid-template-columns:
  minmax(0, 1fr)` on `__column-list`). No e2e covers it.

## Goals / Non-Goals

Goals: the three ticket items, each with red-first proof. Non-goals: `isBound` semantics, other layout changes.

## Decisions

**D1 - Fix the duplicate at the component, by contract.** `ChartDisplayFields` stops prepending; its scatter selects
use `fieldOptions` as-is, exactly like the Annotation select already does, and the prop doc is corrected to "the
caller's options, including the leading clear option". Rationale: one component already treats `fieldOptions` that
way; the sole caller supplies the clear option; the result is one source for the clear entry. Alternatives: (a) strip
"" in the caller and keep the prepend - the Annotation select would then lose its clear option (behavior regression),
or the caller must pass two lists; (b) "prepend only if absent" - defensive dual contract, rejected. Update
`ChartDisplayFields.test.tsx` fixtures to pass a leading clear option as the real caller does (a fixture edit that
mirrors production input, stated in the commit, not a test made to pass).
Red test: through the real Output editor path (`OutputEditorSheet` / `OutputKindFields` test harness, whichever the
existing `OutputEditorSheet.*.test.tsx` files use), open each scatter picker and assert exactly one "— None —" option
and no `console.error` matching "same key". Must be red at base.

**D2 - Typed mock, no cast.** `makeForm(): UseRestSourceFormReturn` returns an object literal checked against the type
(plain return-type annotation or `satisfies`), adding `reset: jest.fn()`. Red proof: remove the cast alone and run
`npm run typecheck` (confirm test files are in the typecheck's tsconfig scope first; if they are not, use the
narrowest command that typechecks that file and record it) - it must report the missing `reset`; then add `reset`.

**D3 - Rendered-geometry e2e replaces the source-text guard.** New `e2e/hel1510-output-editor-table-overflow.spec.ts`.
Seed via API as a registered throwaway `@example.test` user using the existing `e2e/support/auth.ts` +
`userCleanup`/user-registry helpers (follow an existing Output-editor spec such as `hel1307-conditional-formatting`
or `hel1331-history-payloads-toggle` for seeding a CSV source -> pipeline -> table Output). One column name of exactly
86 characters (assert `.length === 86` in the spec). Viewport 1100 wide. Open the Output editor, wait for the Columns
list, then measure with `getBoundingClientRect` (never computed style or CSS text): the Configuration card's
content-box right edge (rect right minus border and padding); every control in every Columns row (visibility
checkbox/name, format select, move buttons) and the Cell density select have `right <= cardContentRight + 0.5`;
the editor sheet's scroll container has `scrollWidth <= clientWidth`; the long name element has width > 0 and a
`title` equal to the full name. Assert in both light and dark themes only if the existing specs make theme switching
cheap; 1100px light is the ticket's minimum.
Revert proof (evidence, not CI): `git show d6aef6c46 -- frontend/src/features/panels/ui/editors/TableDisplayFields.css
| git apply -R` in the worktree -> spec FAILS on an overflow assertion (record the measured overflow px); restore
(`git checkout --` that file) -> spec PASSES. Save both transcripts under the run evidence dir. Then delete
`TableDisplayFields.css.test.ts`. Check `e2e/shard-weights.tsv` / `scripts/e2e-shard.mjs` handle an unlisted spec
(never hand-edit the tsv; if an unlisted spec is not scheduled, stop and report).

## Risks / Trade-offs

- [E2E flake / dev-DB residue] -> throwaway user, cleanup via registry teardown; deterministic waits on rendered rows.
- [Shared MCP browser] -> e2e runs via `npx playwright test` (headless), never the shared browser.
- [Deleting the jest guard loses pre-commit coverage] -> the e2e runs in CI's e2e glob; accepted, since the jest guard
  could pass while the layout overflowed.

## Planner Notes

- Self-approved: D1's single-source contract; deleting the source-text guard (ticket: "Replace it with, or add").
- Observation, not scope: on the Output editor path `isBound={fieldOptions.length > 0}` is always true (the list always
  holds the clear option), so the "Bind a data type..." hint is unreachable. Report as a possible follow-up.
