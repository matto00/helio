- `helio-mcp/package.json` — `@modelcontextprotocol/sdk` `^1.29.0` -> `^1.31.0` (only line changed)
- `helio-mcp/package-lock.json` — sdk entry 1.29.0 -> 1.31.0 (version/resolved/integrity); also expected, not version churn: root `packages[""]` dependency-range line `^1.29.0` -> `^1.31.0`, and the sdk entry's own `@hono/node-server` range `^1.19.9` -> `^1.19.9 || ^2.0.5`.
- `helio-mcp/src/index.ts` — `StdioServerTransport` `maxBufferSize` 64 MiB + truncated stderr `onerror` (owner ruling include-index-edit; see ReadBuffer section)

## Lockfile churn (jq over base vs branch `packages`)
Changed versions: only `node_modules/@modelcontextprotocol/sdk` 1.29.0 -> 1.31.0. Added keys: none. Removed keys: none. `node_modules/zod` entry byte-identical. Diff is 6 insertions / 6 deletions.

## Gate results (scratchpad logs prefixed hel1348-)
- Root `npm ci` first; audit-ci 7.1.0 (root-pinned).
- Base red: `npx audit-ci --config helio-mcp/.audit-ci.jsonc --directory helio-mcp` exit 1, `GHSA-6qxp-vccf-f47h|@modelcontextprotocol/sdk` (hel1348-audit-base.log).
- Branch green: same command exit 0, "Passed npm security audit." No allowlist change (hel1348-audit-branch.log).
- helio-mcp `npm ci` exit 0; installed sdk package.json version 1.31.0.
- helio-mcp `npm run build` exit 0; `npm run typecheck` exit 0.
- Root `npm ci` exit 0; `npx jest helio-mcp`: exit 0, 38 suites / 371 tests passed. Root node_modules has no sdk, so Jest resolves helio-mcp/node_modules copy = 1.31.0.
- Root `npm run lint` exit 0.

## Stdio smoke (base 1.29.0 build vs branch 1.31.0 build; scratchpad script, not committed)
Full listTools() JSON (76 tools, inputSchemas included) and listResources identical. Only differences: client sdk version string, and invalid-args callTool error text, per design change (b): base listed the raw zod issue JSON array, branch prints `Required at pipelineId\nRequired at kind\nRequired at name`. Same code -32602, isError true.

## API diff 1.29 -> 1.31
Public .d.ts used by helio-mcp (server/mcp, server/index, client/index, shared/protocol, inMemory, types) byte-identical; additive only (optional `maxBufferSize` on stdio transports). No source/test edit needed.

## 10 MiB ReadBuffer assessment (revised after evaluation-1; owner ruling `include-index-edit`)
- Inbound requests are NOT small. Uncapped in helio-mcp: `create_csv_data_source.content` (`helio-mcp/src/tools/write.ts` ~257), `create_data_source.rows` (:100), `append_dataset_rows.rows` (:128), `replace_dataset_rows.rows` (:150), and `upload_image.content` (base64). Backend limits: CSV `CsvLimits.maxBytes` 15728640 (15 MiB) / 300k cells (entity limit +1 MiB multipart margin); image `upload_image` posts to `/api/uploads/image`, governed by `IMAGE_UPLOAD_MAX_FILE_SIZE_BYTES` default 10485760 (10 MiB), ~13.3 MiB as base64 (`UploadRoutes.scala:37`; its `toStrict` may cap each part lower at pekko's 8 MiB, unverified; the 20 MiB `IMAGE_MAX_FILE_SIZE_BYTES` governs image data sources, which helio-mcp has no inline tool for); JSON row bodies: no override in application.conf (pekko default 8 MiB, not runtime-verified).
- sdk 1.31.0 `StdioServerTransport` throws on a >10 MiB buffered line and then calls `close()`: the whole session dies. Measured repro (stub HTTP listener standing in for the backend, `hel1348-redgreen.log`):
  - a774c3d99 (bump alone), 11,000,000-byte inline CSV: `MCP error -32000: Connection closed`, nothing on server stderr, stub received nothing.
  - fix build, same request: forwarded, stub logged `POST /api/data-sources bytes=11000259`.
  - fix build, 70,000,000-byte request (above N): stderr `helio-mcp: transport error: ReadBuffer exceeded maximum size of 67108864 bytes`, then `-32000 Connection closed` (session still closes by sdk design, but no longer silent).
- Fix (`helio-mcp/src/index.ts` only): `StdioServerTransport(undefined, undefined, { maxBufferSize: 64 MiB })` and `server.server.onerror` writing to stderr. Protocol.connect chains `transport.onerror` into `server.onerror`, so the handler receives the overflow error; the sdk's own `close()` handling is untouched. N arithmetic: 4 x 15 MiB CSV (JSON escaping at most doubles it: all quotes/newlines; ~1.03x for typical CSV) = 60 MiB + headroom = 64 MiB = 67,108,864; the ~13.3 MiB base64 image fits easily. Not covered: > ~9.8 MiB of C0 control bytes inside a <= 15 MiB CSV (6x `\uXXXX` escaping), which CsvLimits/UTF-8 validation (`DataSourceService.createCsv`) do not reject; such a request closes the session with a stderr log. The stderr handler truncates messages to 500 chars (sdk errors can echo whole inbound payloads); verified with a 5000-byte unknown-id response (543-char line ending `[truncated]`) and the 70 MB probe still logs the overflow line (`hel1348-trunc-c3.log`).
- Response side (a client reading >10 MiB of helio-mcp output, e.g. the verify/e2e harnesses on sdk 1.31): UNVERIFIED. Read tools cap row count (e.g. `max(500)`), not bytes per cell, and no backend-backed measurement was made.
- Installed-version check: `require('@modelcontextprotocol/sdk/package.json').version` prints `undefined` (resolves to the dist/cjs type marker); read `helio-mcp/node_modules/@modelcontextprotocol/sdk/package.json` directly (1.31.0).

## Cycle 2 gates
helio-mcp `npm ci` 0 (sdk 1.31.0), build 0, typecheck 0; root `npx jest helio-mcp` 0 (38 suites, 371 tests); root `npm run lint` 0; CI audit command 0 ("Passed npm security audit").
