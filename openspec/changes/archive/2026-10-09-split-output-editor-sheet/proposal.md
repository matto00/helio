## Why

`OutputEditorSheet.tsx` is 739 lines (CONTRIBUTING budget ~400) and seeds per-kind editor state independently of
`configPatch.ts`'s `openingParams`, which already encodes the same seeding for HEL-1389's edit-Save baseline: two copies
that must stay in lockstep or an untouched Save starts sending a spurious patch. Separately, `PipelineDetailPage` mounts
the sheet without a `key`, so swapping to another Output while mounted (the `?outputId=` deep link) keeps the previous
Output's per-kind state. A HEL-1389 test comment also misstates its own pre-fix behaviour.

## What Changes

- Split `OutputEditorSheet.tsx` into the sheet plus extracted units (one per-kind state hook seeded from `openingParams`,
  plus presentational/effect units moved verbatim) so the sheet is ~400 lines or under. Behaviour-preserving.
- Add a characterization test of every kind's opening state (create + edit), committed green on the base first.
- Key the sheet in `PipelineDetailPage` by Output id (create mode keyed distinctly) so a different Output reseeds.
- Correct the metric-pairing guard comment in `OutputEditorSheet.configPatch.test.tsx` to the verified truth.

## Capabilities

### New Capabilities

### Modified Capabilities

- `pipeline-output-sheet`: adds a requirement that opening a different Output while the sheet is mounted shows that
  Output's own stored state for every field (today only name/kind/step reseed).

## Non-goals

- HEL-1432 (Kind/Step label `htmlFor` → Select `id`; table options overflow at 375px) — next ticket, same file.
- Any change to what an edit or create Save sends, to `configPatch.ts`'s patch semantics, or to visual styling.
- Splitting `OutputKindFields.tsx` or other outputEditor files.

## Impact

- `frontend/src/features/pipelines/ui/outputEditor/` (sheet + new extracted files + new characterization test,
  one-line comment fix in the configPatch test).
- `frontend/src/features/pipelines/ui/PipelineDetailPage.tsx` (`key` prop) + a PipelineDetailPage test.
- No backend, schema, or API changes.
