## 1. Re-enumerate before touching anything

- [x] 1.1 Re-run the enumeration from the tree — do NOT trust ticket.md's or design.md's list.
      `grep -rn "queryParams" helio-mcp/src/` and `grep -rn "Record<string, *string>" helio-mcp/src/`.
      Record the full site list in the commit-time notes. If it differs from design.md's six,
      the design's list is the stale one; fix the code for the real list.

## 2. The shared type

- [x] 2.1 In `helio-mcp/src/types.ts`, add exported `QueryParamPair` (`{name, value}`) and
      `QueryParamsInput` (`QueryParamPair[] | Record<string, string>`), with a comment naming
      HEL-982/HEL-844 and stating that the array form preserves duplicates and authored order.
- [x] 2.2 Change `CreatePipelineRootRequest.restConfig.queryParams` to `QueryParamsInput`.

## 3. Widen every site

- [x] 3.1 `helio-mcp/src/helioApi.ts` — `createRestDataSource` input `queryParams?: QueryParamsInput`.
      Confirm the line that puts it in the POST body forwards it unchanged (no normalization, D3).
- [x] 3.2 `helio-mcp/src/tools/restDataSourceSchema.ts` — replace `z.record(z.string(), z.string())`
      with the D2 union (array branch first, pair object `.strict()`), still `.optional()`.
- [x] 3.3 `helio-mcp/src/tools/pipelinesHandlers.ts` — replace the
      `as Record<string, string> | undefined` cast with `as QueryParamsInput | undefined`.
- [x] 3.4 `helio-mcp/src/tools/write.ts` — confirm the destructure/forward still type-checks and
      still performs no transformation.
- [x] 3.5 Any additional site found in 1.1.

## 4. Tool description (D7)

- [x] 4.1 Add one sentence to `create_rest_data_source`'s description in `write.ts`: `queryParams`
      accepts either a JSON object (unique keys) or an ordered `[{name, value}]` array, and the
      array form is the one that expresses a repeated key (`?tag=a&tag=b`) and controls order.

## 5. Tests — real HTTP server, no mocks (D4/D5)

- [x] 5.1 Add a test helper starting a real `node:http` server on an ephemeral port that records
      every received request's method, path and parsed JSON body, and shuts down in `afterEach`.
      Point a real `HelioApi`/`HttpClient` at its address — no stubbed fetch anywhere.
- [x] 5.2 Define the canonical fixture per D5: SIX pairs, deliberately non-alphabetical, a
      NON-ADJACENT duplicate name, no numeric-like names. Write the expectation out in full, in
      authored order.
- [x] 5.3 **Red-before proof** (`create_rest_data_source`): assert that with the array fixture the
      tool's zod schema REJECTS the input before the fix. Capture the failing output, then make it
      pass with the fix. This is acceptance criterion 4 — record the red evidence in the notes.
- [x] 5.4 Assert the request body the server received has `config.queryParams` deep-equal to the
      full ordered fixture: both duplicate entries present, in authored (not alphabetical, not
      grouped) order.
- [x] 5.5 Legacy-encoding test: call with the object form and assert the server received that
      object **unchanged** — proving criterion 3 and D3's no-normalization rule in the same test.
- [x] 5.6 Malformed-entry test: an array containing a non-`{name,value}` entry (and one with an
      extra key) fails validation loudly rather than being silently dropped.
- [x] 5.7 Inline-root guard (`create_pipeline` / `add_root`): assert the array survives to the
      server for the inline `rest_api` root. **Comment it explicitly as a GUARD, not a proof** —
      per design.md D4 this path passes before the fix too (the cast is a no-op at runtime), so
      claiming a red here would be false.
- [x] 5.8 **Mutation-prove every ordering assertion.** For each ordering test, temporarily mutate
      the handler to sort by name, and separately to group duplicates, and confirm each mutation
      turns the test RED. Revert. Record both mutations and their failures in the notes. An
      ordering assertion that survives a sort mutation is vacuous and must be strengthened.

## 6. Completeness proof (D6)

- [x] 6.1 Run a grep for `Record<string, *string>` and `z.record(z.string(), *z.string())` on or
      adjacent to a `queryParams` declaration across `helio-mcp/src`. Output MUST be empty.
      Record the exact command and its empty output. Do not substitute a hand-kept tally.
      (`headers` legitimately keeps `Record<string, string>` — scope the grep to `queryParams`.)

## 7. Gates

- [x] 7.1 `npm run lint`, `npm run typecheck`, and `helio-mcp`'s own
      `npm --prefix helio-mcp run typecheck` all clean.
- [x] 7.2 `npx jest` green, including the new tests.
- [x] 7.3 `npm run format:check` clean.
- [x] 7.4 Confirm the diff contains NO file under `backend/src/main/resources/db/migration/`
      (hard constraint), no `.husky/**` change, and nothing under `frontend/src/features/pipelines`
      (HEL-968/HEL-970 territory).
- [x] 7.5 `openspec validate --change mcp-ordered-query-params` exits zero.
