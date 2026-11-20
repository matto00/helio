## Standing Constraints

## 1. Tests (red first)

- [x] 1.1 Add the D5 component tests (rename, large schema, disabled/not-previewed, descendant); run the full file on the
  unchanged code, confirm red for rename/large, record and commit the red run in `.concertino/scratch/HEL-1777/`

### Frontend

## 2. Implementation

- [x] 2.1 Export `renameOrigins` (rowOps.ts, on `foldRenames`) and add pure `draftSchemaFields`, with unit tests
  (swap, collision, insertion-vs-fold-order chain, rule 3 fallback); tests pass
- [x] 2.2 Add `showsDraftGrid`; drive `draftColumns` and the chips (inline + disclosure) from `draftFields`;
  the 1.1 tests turn green
- [x] 2.3 Record the three D5 mutations in `.concertino/scratch/HEL-1777/`, each turning a test red

## 3. Verification

- [x] 3.1 `npm run lint`, `npm run typecheck`, full jest for `features/pipelines` pass
- [x] 3.2 e2e `hel1631-draft-mode` and `hel1632-live-output` (full files) pass; grep e2e/ for altered selectors
