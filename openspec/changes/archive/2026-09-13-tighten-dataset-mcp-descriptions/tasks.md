## 1. Canonical column-type constant + drift guard

- [x] 1.1 Add a small exported constant (e.g. `CANONICAL_COLUMN_TYPES`) in `helio-mcp/src/tools/`
      listing the 7 canonical wire values in `DataFieldType.CanonicalWireValues`'s order:
      `string, integer, float, boolean, timestamp, string-body, binary-ref`.
- [x] 1.2 Add a drift-guard test in `helio-mcp` (runs under the repo-root `jest.config.cjs`, same
      as every other `helio-mcp` test) mirroring
      `frontend/src/features/sources/types/canonicalFieldTypesDriftGuard.test.ts`'s approach: read
      `backend/src/main/scala/com/helio/domain/model/model.scala` from disk (walk up from
      `__dirname` until a directory containing `backend/` is found, exactly as the frontend guard
      does), regex-extract `CanonicalWireValues`'s `Vector(...)` literal and `fromString`'s case
      table, and assert the new constant matches content and order exactly.
- [x] 1.3 Interpolate the constant into `create_data_source`'s, `get_dataset_schema`'s, and
      `update_dataset_schema`'s tool descriptions (`helio-mcp/src/tools/write.ts`,
      `helio-mcp/src/tools/read.ts`).

## 2. Fix append_dataset_rows / replace_dataset_rows description accuracy

- [x] 2.1 Rewrite `append_dataset_rows`'s and `replace_dataset_rows`'s tool descriptions in
      `helio-mcp/src/tools/write.ts` to state: a row longer than the declared schema is rejected;
      for a row no longer than the schema, a missing trailing position OR an explicit `null`
      position is padded from that field's `default` (or left `null` if optional with no default);
      only a `required` field missing/`null` with no `default`, or a declared-type mismatch on a
      present non-null value, causes rejection.
- [x] 2.2 Cross-check the final wording against the delta already drafted in
      `specs/mcp-data-source-tools/spec.md` (MODIFIED Requirements) and adjust either side if
      implementation reveals a nuance not yet captured.

## 3. Document the creation-time explicit-null-default limitation

- [x] 3.1 Add a note to `create_data_source`'s tool description (`helio-mcp/src/tools/write.ts`)
      that an explicit `default: null` on a column is currently indistinguishable from omitting
      `default` at creation time (`StaticColumnPayload`'s wire format), and that
      `update_dataset_schema` (post-creation) should be used instead if the distinction matters.

## 4. Verification

- [x] 4.1 Build `helio-mcp` (`npm run build` or equivalent) and start a FRESH `helio-mcp` process
      (never the session's own attached/frozen MCP client) against a real running backend.
- [x] 4.2 As a non-superuser role (RLS is forced on dataset rows), exercise: (a) `create_data_source`
      (kind `dataset`) with a short-row-tolerant schema, then `append_dataset_rows` with (i) a
      genuinely short row and (ii) a row with an explicit `null` at an optional/defaulted
      position — confirm both succeed and pad as documented; (b) a too-long row and a
      missing/null-required-field row — confirm both are rejected verbatim; (c) `get_dataset_schema`,
      `create_data_source`, and `update_dataset_schema` descriptions list all 7 canonical types
      matching `DataFieldType.CanonicalWireValues`.
- [x] 4.3 Run `helio-mcp`'s unit test suite (existing `datasetTools.test.ts` plus the new
      drift-guard test, via the repo-root Jest config) and the frontend's own
      `canonicalFieldTypesDriftGuard.test.ts` to confirm no regressions.
- [x] 4.4 Run backend/frontend gates as applicable (lint/typecheck/tests) for any touched files.
