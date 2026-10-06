## Evaluation Report — Cycle 2 (evaluation-2.md)

Reviewed HEAD `cfb92b2df5e6e84dfbd9306598340626a9c5f277` against live-resolved base `9c41719c376b858ab9269fa6075f8b3b74acabd1`
(origin/main), plus the cycle-2 delta `a774c3d99..cfb92b2df`.

- Scratch logs and scripts: `/tmp/claude-1000/-home-matt-Development-helio/7c91d5de-7eee-4b42-a6c7-dffd6f7b4dc2/scratchpad/hel1348-eval2-*`
  and `hel1348-eval-scripts/`.
- Every npm/npx call used the scratchpad cache and logs dir.
- Scope ruling verified at source: `.concertino/runs/HEL-1348/events.jsonl` line 16 is `escalation.answered`,
  answer `include-index-edit`, `answer_source: human`, escalation_id `HEL-1348-1791308333627-b3fa45`.

### Phase 1: Spec Review — FAIL

- **Scope.** Outside the change dir, `base...HEAD` touches only `helio-mcp/package.json`, `helio-mcp/package-lock.json`
  and `helio-mcp/src/index.ts`, which is the widened C1 from the owner ruling. In the cycle-2 delta, `helio-mcp/` changes
  only `src/index.ts`, so the lockfile is unchanged since cycle 1. The worktree is clean.
- **Owner-ruling ACs:**
  - `{ maxBufferSize }` is passed to `StdioServerTransport`: met.
  - A stderr `onerror` handler is registered: met.
  - The 11 MB red/green: met (independently reproduced, see Phase 2).
  - The response side is marked UNVERIFIED: met.
  - "Value and its derivation stated": **the derivation contains two false factual claims** (Phase 2, finding 1).
    It therefore fails the AC as written, and the same claims appear in `files-modified.md`.
- Evaluation-1 CR1 (corrected assessment) is mostly addressed, apart from those two claims. CR2 (record the ruling) is
  addressed in ticket.md, design D6, tasks C1/C1b and Planner Notes.

### Phase 2: Code Review — FAIL

**Gates I ran myself in `WORKTREE_PATH`:**

| Gate | Result |
|---|---|
| Root `npm ci` | exit 0 |
| helio-mcp `npm ci` | exit 0; installed sdk `package.json` version 1.31.0 |
| helio-mcp `rm -rf dist && npm run build` | exit 0; `dist/index.js` contains the 64 MiB constant |
| helio-mcp `npm run typecheck` | exit 0 |
| Root `npx jest helio-mcp` | exit 0, 38 suites / 371 tests; root `node_modules` has no `@modelcontextprotocol`, so Jest loads helio-mcp's 1.31.0 |
| Root `npm run lint` | exit 0; `eslint --max-warnings=0 helio-mcp/src/index.ts` also exit 0 |
| `prettier --check helio-mcp/src/index.ts` | clean |
| Exact CI audit command `npx audit-ci --config helio-mcp/.audit-ci.jsonc --directory helio-mcp` (root-pinned 7.1.0) | exit 0, "Passed npm security audit." (`hel1348-eval2-audit-head.log`) |

**(2) The onerror wiring is correct and doesn't interfere with the sdk.**
- In sdk 1.31.0, `Protocol.connect` (`shared/protocol.js:225-229`) wraps `transport.onerror` so that it calls
  `this._onerror` and then `this.onerror` (line 271). `this.onerror` is read at call time, so assigning
  `server.server.onerror` before `connect` is fine.
- Nothing in the sdk server or McpServer assigns `onerror`, and nothing in helio-mcp did before (grep), so nothing is
  overwritten.
- On overflow, `StdioServerTransport._ondata` calls `onerror` and then `close()` (`server/stdio.js:14-22`). The handler
  only writes to stderr, so the sdk's own close path is unchanged.
- **Stdout purity probe** (`hel1348-eval2-raw.log`, raw spawn, no sdk client): I sent a non-JSON line, a non-JSON-RPC
  object, a response for an unknown id, then initialize and tools/list.
  - On both the a774c3d99 build and the fix build, stdout holds exactly two valid JSON-RPC lines (id 1, id 2) and the
    process stays alive.
  - Only the fix build adds three `helio-mcp: transport error: ...` lines, all on **stderr**.
  - Newly surfaced error classes include stdin parse/validation errors, unknown-id responses and failed sends. None
    can reach stdout.

**(3) Red/green, reproduced independently.**
- Setup: my own stub HTTP listener (`hel1348-eval-scripts/stub.mjs`), PID 350192, recorded and killed by that PID only.
  The a774c3d99 tree was built in scratch via `git archive` + `npm ci` (sdk 1.31.0). Its tsc exit 2 comes from 1135
  `@types/jest` errors, all in `*.test.ts`, caused by building outside the repo; `dist` was emitted.
- Results are in `hel1348-eval2-redgreen.log` and `hel1348-eval2-stub.log`:

  | request (inline CSV) | a774c3d99 (bump only) | cfb92b2df (fix) |
  |---|---|---|
  | 1,000,034 B | forwarded, stub got 1,000,289 B | forwarded, stub got 1,000,289 B |
  | 11,000,024 B | **`-32000 Connection closed`**, stub got nothing, server stderr silent | **forwarded**, stub got `POST /api/data-sources bytes=11000279` |
  | 60,000,024 B | — | forwarded, 60,000,279 B (5.1 s) |
  | 70,000,014 B (> N) | — | `-32000 Connection closed`, stub got nothing, stderr `helio-mcp: transport error: ReadBuffer exceeded maximum size of 67108864 bytes` |

**(1) Checking the derivation of N against the real limits in the tree:**
- **CSV.** `CsvLimits.maxBytes` is 15,728,640. `create_csv_data_source.content` is posted as multipart to
  `/api/data-sources`, as the stub log shows. Confirmed.
- **Row-array tools at pekko's 8 MiB default.** Supported by in-tree evidence: `application.conf` has no
  `max-content-length`/`parsing` override, and `DataSourceRoutes.scala:309-310` itself documents "Pekko's global 8 MiB
  `max-content-length`". It is not runtime-verified, and `files-modified.md` says so. Acceptable.
- **"JSON escaping roughly doubles it, 4x covered".** Measured JSON.stringify expansion (UTF-8 bytes out / in):
  - typical CSV 1.03x
  - all quotes/newlines 2.00x
  - all tabs 2.00x
  - non-ASCII under an `ensure_ascii`-style client up to 3.00x (`é`)
  - C0 control characters 6.00x

  So 4x does cover every class except C0 controls. "Roughly doubles" describes the worst case for quotes and newlines,
  not typical CSV. That wording is imprecise but conservative and not blocking.
- **Finding 1a (false claim): "A pathological all-control-character CSV (6x escape) is not covered — the backend would
  reject it anyway"** (`helio-mcp/src/index.ts`, the doc comment above `MAX_STDIO_BUFFER_BYTES`; repeated in
  `files-modified.md`). The backend does not reject such content.
  - `DataSourceService.createCsv` (`backend/.../services/sources/DataSourceService.scala:224-240`) checks only
    `CsvLimits.violation`, which is bytes, rows and cells (`CsvLimits.scala:63-68`), then the tag, then
    `isValidUtf8`. C0 control bytes are valid UTF-8.
  - No control-character check exists anywhere in the CSV path (grep `isControl|isISOControl` finds nothing relevant).
  - So a 15 MiB CSV with more than about 9.8 MiB of C0 controls is within backend limits. At 6x escaping it exceeds the
    64 MiB stdin line and kills the session (now with a stderr log).

  The case is unrealistic, and the code doesn't need to change. The comment does: it states a guarantee that does not
  exist.
- **Finding 1b (wrong limit cited): "upload_image.content (backend IMAGE_MAX_FILE_SIZE_BYTES 20 MiB, base64 x4/3 =
  ~26.7 MiB)"** (same comment; repeated in `files-modified.md` and design D6).
  - `upload_image` posts to `/api/uploads/image` (`helio-mcp/src/helioApi.ts:897-910`). That route is bounded by
    `IMAGE_UPLOAD_MAX_FILE_SIZE_BYTES`, default 10,485,760 (`UploadRoutes.scala:36-37`).
  - `IMAGE_MAX_FILE_SIZE_BYTES` (20 MiB) governs image *data sources* (`DataSourceRoutes.scala:68`,
    `ContentSourceSupport.scala:87`). helio-mcp has no inline-content tool for those; the only inline `content` fields
    are `write.ts:257` (CSV) and `write.ts:696` (upload_image).
  - `UploadRoutes.scala:46` also uses `p.toStrict(60.seconds)` with no `maxBytes`. That is the hazard
    `DataSourceRoutes.scala:309` documents as capping each part at pekko's 8 MiB.

  The error makes the comment overstate the limit rather than understate it, so N still covers the real limit. But the
  comment cites a variable that doesn't govern this path.

**Other review points:** the code change is minimal: a named constant, one handler, one constructor argument. No dead
code, no type escape hatches, and no over-engineering.

### Phase 3: UI Review — N/A

No UI-triggering paths changed (`helio-mcp/**` and the change dir only). No dev servers were started.

### Overall: FAIL

### Change Requests

1. In `helio-mcp/src/index.ts`, rewrite the doc comment above `MAX_STDIO_BUFFER_BYTES` (the image sentence and the
   final sentence):
   - (a) Replace "upload_image.content (backend IMAGE_MAX_FILE_SIZE_BYTES 20 MiB, base64 x4/3 = ~26.7 MiB)" with the
     limit that actually governs `/api/uploads/image`: `IMAGE_UPLOAD_MAX_FILE_SIZE_BYTES`, default 10 MiB, which is
     about 13.3 MiB base64, and in practice capped lower by pekko's 8 MiB per-part `toStrict` default. Alternatively,
     drop the image figure and keep only the binding CSV derivation.
   - (b) Replace "the backend would reject it anyway" with a true statement. For example: "not covered: needs > ~9.8
     MiB of C0 control bytes inside a <= 15 MiB CSV, which CsvLimits/UTF-8 validation do not reject; such a request
     closes the session with a stderr log." Or raise N to cover 6 x 15 MiB plus envelope, about 96 MiB, if you'd rather
     close the case than document it. Either is acceptable. Only the false claim is blocking.
2. Make the same two corrections in `openspec/changes/bump-mcp-sdk-advisory/files-modified.md` (the "Backend limits"
   bullet's image figure, and the "Not covered ... backend would reject it anyway" sentence) and in design.md D6
   ("covers 20 MiB image base64").

### Non-blocking Suggestions

- Consider truncating `err.message` in the stderr handler, for example to the first 500 characters. sdk messages such
  as `Received a response for an unknown message ID: ${JSON.stringify(response)}` and the zod union dump (seen in
  `hel1348-eval2-raw.log`) echo whole inbound messages. That means a misbehaving host could push up to 64 MiB of its
  own payload into stderr, and so into host log files.
- "JSON escaping of newlines/quotes roughly doubles it" would read more accurately as "at most doubles it (all
  quotes/newlines); ~1.03x for typical CSV". Measured above.
- An observation for a separate ticket, out of scope here: `UploadRoutes.scala:46`'s `p.toStrict(60.seconds)` has the
  same 8 MiB per-part hazard that `DataSourceRoutes.scala:309` already fixed. So the 10 MiB
  `IMAGE_UPLOAD_MAX_FILE_SIZE_BYTES` is probably not reachable. I did not verify this at runtime.
