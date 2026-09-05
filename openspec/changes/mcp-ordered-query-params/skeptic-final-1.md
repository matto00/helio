## Skeptic Report — final gate (round 1, skeptic-final-1.md)

### What I verified (with evidence)

- **Diff scope**: `git diff main...HEAD --stat` — confined to `helio-mcp/src/**` + `openspec/**`. No Flyway migration, no `.husky` change, no `backend/**` change, nothing under `frontend/src/features/pipelines` (`git diff main...HEAD --name-only | grep -Ei "flyway|migration|\.husky|frontend/src/features/pipelines|backend/"` returned empty).

- **Type widening (AC 1/2/3)**: `helio-mcp/src/types.ts` adds `QueryParamPair`/`QueryParamsInput = QueryParamPair[] | Record<string,string>`; `helioApi.ts`, `pipelinesHandlers.ts`, `restDataSourceSchema.ts` all updated to accept it. Read the full diff of all 5 non-test source files.

- **Completeness grep (AC 5)**: `grep -rn "queryParams" helio-mcp/src --include=*.ts -A2 -B2 | grep -i "Record<string, string>\|z.record"` — the only matches are `headers` (an unrelated field, correctly untouched) and the union's own legacy branch inside `restDataSourceSchema.ts` (intentional, dual-read). No stray `queryParams`-typed `Record<string,string>` remains. Zero collapse points survive.

- **Fixture rigor (design.md D5)**: `FIXTURE` in `queryParamsOrdering.test.ts` is 6 pairs (`z,tag,alpha,tag,m,beta`), non-alphabetical, duplicate `tag` at non-adjacent indices 1 and 3, no numeric-like names. Matches the design doc's stated canonical fixture exactly.

- **Ran the full test file** (`npx jest queryParamsOrdering.test.ts` from repo root, using the root `jest.config.cjs` which overrides `module`/`moduleResolution` to `NodeNext` for this exact reason): **8/8 pass** against a real `node:http` server (not mocked fetch), asserting the actual parsed JSON body the server received — not just a 200.

- **Mutation-proof, sort-by-name — reproduced against real source**: reverted `restDataSourceSchema.ts`'s `queryParams` field to `z.record(z.string(), z.string()).optional()` (the pre-fix schema) and reran: 4 tests go red, including a genuine `ZodError: Expected object, received array` — this **is** the AC-4 red-before-fix proof, and it reproduces live (not just a captured comment). Restored the file afterward; confirmed `git diff` on it is empty.

- **Mutation-proof, group-duplicates — reproduced against real source (the gap the evaluator explicitly left unchecked)**: patched `helioApi.ts`'s `createRestDataSource` to group array entries by name (stable, first-seen order) before forwarding, simulating a "preserves multiplicity, destroys interleaving" bug. Reran: 3 tests go red, including the "AUTHORED order" test and the group-duplicates mutation-proof test itself, with a diff showing `tag/b` and `alpha/2` swapped — i.e. the assertion `not.toEqual(grouped)` really would fail to catch a real grouping bug if `toEqual(FIXTURE)` weren't independently present, but the primary ordering assertion (`toEqual(FIXTURE)`) DOES catch it. Restored `helioApi.ts` afterward; confirmed `git diff` on it is empty.

- **Legacy object encoding unchanged (AC 3)**: test asserts `body.config.queryParams` equals the input object form byte-for-byte; confirmed by reading `helioApi.ts` — `queryParams: input.queryParams` is a straight passthrough, no normalization in either direction, matching design.md D3.

- **Tool description updated**: `write.ts`'s `create_rest_data_source` description now states both encodings and when the array form is required (design.md D7 — a widened type an agent doesn't know about is unreachable in practice).

- **Gates re-run myself**:
  - `npm run typecheck` (helio-mcp, `tsc --noEmit -p tsconfig.typecheck.json`) — clean.
  - `npx eslint` on all 6 changed source files — zero errors/warnings.
  - `npm run check:openspec` — "openspec/ is clean".
  - `npm run check:schemas` — schemas in sync, no drift.

### Verdict: CONFIRM

### Non-blocking notes
- The inline-pipeline-root test is honestly labelled a GUARD, not a red-before proof (comment explains why — the cast was type-only, so an array already flowed through pre-fix on that path). This is accurate and not a HEL-844-style false rigor claim.
