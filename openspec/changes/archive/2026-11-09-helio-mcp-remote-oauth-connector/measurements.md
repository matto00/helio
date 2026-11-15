# helio-mcp HTTP entry: memory measurement and Cloud Run sizing (task 5.1a)

## Method

`helio-mcp/scripts/measureHttpMemory.ts` (run on the desktop, Node 22.23, built `dist/http.js`, one
fresh process per size, `NODE_ENV=production`, no `--max-old-space-size`). It performs the real OAuth flow against the
process, then one `tools/call create_csv_data_source` whose `content` makes the JSON body 8 MiB or 32 MiB
(an ASCII CSV; the tool forwards it as multipart to a local stub backend that drains it and answers 201).
Peak RSS is `VmHWM` from `/proc/<pid>/status`. Transcript: `evidence/measure-memory.txt`.

| Measurement                      | Total RSS (MiB) | Over idle (MiB) |
| -------------------------------- | --------------- | --------------- |
| Idle (after OAuth flow)          | 129             | 0               |
| Peak, one 8 MiB `create_csv...`  | 202             | 73              |
| Peak, one 32 MiB `create_csv...` | 410             | 281             |

Both calls returned 200 and the stub's response id, so the whole path (parse, tool, multipart forward) was
exercised, not just the body parser.

## Cloud Run request cap

Source: https://cloud.google.com/run/quotas ("Cloud Run Quotas and Limits"), fetched by the evaluator on 2026-11-09:
"Maximum HTTP/1 request size 32 MiB per request. Limit applies if using HTTP/1 server. No limit if using HTTP/2
server." The same page caps the HTTP/1 response at 32 MiB (noted in the README). This lane could not fetch the page
itself; the figure is the evaluator's confirmation. It is one constant, `MAX_BODY_BYTES` in `helio-mcp/src/httpApp.ts`.

## Derived settings

Constraint: `idle + slots x peak(32) + (concurrency - slots) x peak(8) < 75 % of memory`, using the over-idle
column as the per-request cost (any request under 8 MiB costs less than the 8 MiB figure).

- `--memory=1Gi` (75 % = 768 MiB)
- `HELIO_MCP_LARGE_BODY_SLOTS=1`
- `--concurrency=5`

Check: 129 + 1 x 281 + (5 - 1) x 73 = 702 MiB < 768 MiB. Two concurrent large uploads on one instance get an
immediate `429` with `Retry-After: 5`; a second instance (`--max-instances=2`) or a retry absorbs them.

The code default for `HELIO_MCP_LARGE_BODY_SLOTS` is 2 (range 1..16) so a developer running locally is not
throttled; the deploy script pins the measured value.
