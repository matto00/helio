## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD: 7ea2715bba395cf3f3d2ab1e0b06d455bab75758. Base resolved live with resolve-review-base.sh: 8ce3710b9c694753b864e2d86276a79492772d93.

### What I verified (with evidence)

- **Spawn cwd guard:** `assert-cwd.sh` returned `READY ambient=/home/matt/Development/helio branch=feature/mcp-tools-datasets/HEL-1081`.
- **Scope:** `git diff --stat BASE...HEAD` shows 18 files. 9 are under `helio-mcp/src/**` and the rest are this change's own openspec artifacts. No backend, frontend or schemas files are touched.
- **Gates, re-run fresh by me:**
  - `npx jest helio-mcp`: 27 suites and 270 tests passed.
  - `npx eslint helio-mcp --max-warnings=0`: exit 0.
  - `npx prettier --check`: clean.
  - `npm run build` (tsc): exit 0.
  - `tsc --noEmit`: exit 0.
- **Wire parity:** I read the source for every call myself.
  - The routes in `DataSourceRoutes.scala` match `helioApi.ts`. Rows use GET/POST/PUT, a single row uses PATCH (updatedAt in the body) and DELETE (updatedAt as a query parameter), and the schema uses GET/PATCH.
  - The types in `types.ts` match `DataSourceProtocol.scala:254-350`.
  - `httpClient.delete` now forwards `query` with an undefined body.
- **Error surfacing:** `describeError` passes only `body.message` through. For the 409 schema conflict, `DataSourceService.scala:920-923` puts each rejected field's `name: reason` into `message`, so the field names reach the agent. I confirmed this live (below).
- **AC end to end, live, with no UI:** I started servers on 6513/9420 (`assert-phase.sh servers` passed) and minted a PAT for the dev account. I then drove the built `helio-mcp/dist/index.js` over real MCP stdio using the SDK `Client`. Observed:
  - `listTools` includes all 7 new tools plus `create_data_source`.
  - `create_data_source` with `rows: []` and declared `required`/`default` created a `dataset` source. `get_dataset_schema` then returned `team required:true` and `note default:"n/a"`, so the declared schema was persisted.
  - `append_dataset_rows` returned 3 rows with id/seq/updatedAt. A type-violating row was rejected with `400 ... field 'pts' — expected float, got string`.
  - `get_dataset_rows limit=2` returned `nextCursor:1`. Passing that cursor returned the rest, with `nextCursor` absent on the last page. Row `data` is positional.
  - `update_dataset_row` succeeded. Re-sending the stale updatedAt returned `409 ... was modified concurrently`.
  - `delete_dataset_row` with the stale updatedAt returned 409, and the URL carried `?updatedAt=...`. With the fresh updatedAt it returned `{deleted:true}`.
  - `update_dataset_schema` with a rename via `previousName` that also dropped `note`, without confirmDrop, returned `409 Conflict: note: dropping a field with existing rows requires confirmDrop: true`. With `confirmDrop:true` it returned `points` renamed and `rowsMigrated:3`.
  - `replace_dataset_rows` followed by `get_dataset_rows` returned `total:2`.
  - `create_pipeline` with `roots:[{sourceId}]` and a table output, then `run_pipeline`, returned `succeeded, rowCount 2`. `get_output_rows` returned `[{team:q,points:5},{team:r,points:7}]`, a panel-bindable Output.
  - `teardown_resources` by tag deleted 1 pipeline and 1 source.
  - (Live transcript excerpts are quoted inline above. The run output was kept in the session scratchpad and not persisted, because this role writes no files besides this report.)

### Verdict: CONFIRM

Every AC traces to observed live behavior. The evaluator's "credible, not independently re-run" gap on the end-to-end proof is now closed by a fresh run.

### Non-blocking notes

1. **The `append_dataset_rows` description overstates arity rejection.** `write.ts` "append_dataset_rows" says a row with "wrong arity" is rejected. Live, the short row `["short"]` was **accepted** and padded to `["short", null, "n/a"]`, with trailing optional fields filled from null or their default. Suggest rewording to say that trailing omitted optional fields are filled, and only over-long rows or missing required values are rejected.
2. **Explicit `null` default reads back as absent.** I created `pts` with `default: null`, and `get_dataset_schema` returned `pts` with no `default` key. The backend collapses it through `Option[JsValue]` in `StaticColumnPayload`. So the "absent `default` and explicit `null` default are different things" wording in `get_dataset_schema` / `createDataSource` does not hold at the create path. The MCP layer forwards the value correctly; only the description overpromises.
3. `update_dataset_schema` accepted `type: "number"` and stored it as `float`. That is harmless, but the descriptions never list the valid type strings.
4. The dev DB still has a `skeptic-hel1081` PAT minted for this probe. The probe's source and pipeline were torn down.

No gate defect: no evidence in this review depends on mtime ordering.
