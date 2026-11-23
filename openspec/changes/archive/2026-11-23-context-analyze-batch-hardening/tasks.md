## 1. Item 1: raw source-id lookup (backend)

- [x] 1.1 Add red-first parity cases (upper-case and non-UUID secondary and upsert-target ids, seeded below the API) to the context-analyze routes spec; run the full spec file; commit the red run as `red-backend-raw-id.txt` in this change dir before any fix
- [x] 1.2 Implement D1 in `PipelineContextAnalyzeReads` (raw ids prefetched, plain `map.get(raw)` resolver, no `UUID.fromString`, no throw); verify the prefetch collects exactly the ids the shared fetch requests
- [x] 1.3 Fix the comments (D2) on `DataSourceRepository.findByIdsOwned` (and `findByIdsInternal` if it repeats it) and in `PipelineContextAnalyzeReads`
- [x] 1.4 Re-run every context-analyze spec (routes, query-count, undecodable-row) and the analyze route specs green

## 2. Item 2: missing `steps` falls back per pipeline (helio-mcp)

- [x] 2.1 Add the red-first golden-loop path (full + concise) and request-count/stderr assertion in `contextRequestBudget.test.ts`; run it; commit the red run as `red-mcp-missing-steps.txt` before any fix
- [x] 2.2 Implement D3 in `fetchContextAnalyze` (only items with an array `steps` enter the map)
- [x] 2.3 Run the full helio-mcp test suite, typecheck and lint green; confirm `git diff main -- helio-mcp/src/__golden__` is empty

## 3. Item 3: N+1 mutation red for the statement-count spec

- [x] 3.1 Apply a one-query-per-pipeline mutation (D5), run the full `PipelineContextAnalyzeQueryCountSpec`, commit the red output as `red-n-plus-one-mutation.txt` (mutation code itself never committed)
- [x] 3.2 Revert the mutation and re-run the spec green

## 4. Wrap-up

- [x] 4.1 Backend formatting/quality gates and the pre-commit hook pass; `files-modified.md` lists every touched file
