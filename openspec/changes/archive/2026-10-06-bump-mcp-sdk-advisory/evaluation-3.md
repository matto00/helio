## Evaluation Report — Cycle 3 (evaluation-3.md)

Reviewed HEAD `cea3c4332a407f771168fe61e24ea599e9d0f89f` against live-resolved base `9c41719c376b858ab9269fa6075f8b3b74acabd1`
(origin/main), plus the cycle-3 delta `cfb92b2df..cea3c4332`.

- Scratch logs: `/tmp/claude-1000/-home-matt-Development-helio/7c91d5de-7eee-4b42-a6c7-dffd6f7b4dc2/scratchpad/hel1348-eval3-*`.
- Every npm/npx call used the scratchpad cache and logs dir.

### Phase 1: Spec Review — PASS

- **Scope.** `git diff --name-only base...HEAD` outside the change dir is exactly `helio-mcp/package.json`,
  `helio-mcp/package-lock.json` and `helio-mcp/src/index.ts`, which is the owner-ruled C1. The worktree is clean.
- **Every ticket AC is met:**
  - sdk resolves to 1.31.0, with the lockfile changed for the sdk entry only (cycle 1, unchanged since).
  - No allowlist entry.
  - The changed-package list is in `files-modified.md`.
  - Build, typecheck and Jest pass.
  - The transport and tool-registration API is unchanged (cycle-1 smoke).
  - Owner-ruling ACs: `maxBufferSize` set with its derivation stated, and a stderr `onerror` handler registered.
  - The 11 MB red/green is reproduced (cycles 2 and 3).
  - The response side is marked UNVERIFIED.
- **Pending, orchestrator-owned:** task 2.7, the CI red-to-green run id, after the PR opens.
- **Evaluation-2 change requests are addressed:**
  - CR1a: the comment now cites `IMAGE_UPLOAD_MAX_FILE_SIZE_BYTES`, 10 MiB, about 13.3 MiB as base64, with the pekko
    per-part cap marked unverified. True per `UploadRoutes.scala:36-37,46`.
  - CR1b: the C0-control case is now stated as not covered, and it says CsvLimits/UTF-8 validation do not reject it.
    True per `DataSourceService.scala:224-240`.
  - CR2: `files-modified.md` and design D6 carry the same corrections. The stale "20 MiB image" and "backend would
    reject it anyway" wording is gone from both.

### Phase 2: Code Review — PASS

**Gates I ran myself in `WORKTREE_PATH`:**

| Gate | Result |
|---|---|
| Root `npm ci` | exit 0 |
| helio-mcp `npm ci` | exit 0; installed sdk `package.json` version 1.31.0 |
| helio-mcp `rm -rf dist && npm run build` | exit 0; the `[truncated]` handler is present in `dist/index.js` |
| helio-mcp `npm run typecheck` | exit 0 |
| Root `npx jest helio-mcp` | exit 0, 38 suites / 371 tests (only helio-mcp's 1.31.0 sdk copy is resolvable) |
| Root `npm run lint` | exit 0 |
| `prettier --check helio-mcp/src/index.ts` | clean |
| Exact CI audit command `npx audit-ci --config helio-mcp/.audit-ci.jsonc --directory helio-mcp` | exit 0, "Passed npm security audit." (`hel1348-eval3-audit-head.log`) |

**Probes against the freshly built HEAD `dist`, using my own stub HTTP listener.** The stub ran as PID 373527, and I
stopped it by that PID only. Results are in `hel1348-eval3-redgreen.log` and `hel1348-eval3-stub.log`.

| Request | Result |
|---|---|
| 11,000,024-byte inline CSV | forwarded; stub logged `POST /api/data-sources bytes=11000279` |
| 70,000,014-byte inline CSV (over the 64 MiB limit) | `-32000 Connection closed`; stub received nothing; stderr `helio-mcp: transport error: ReadBuffer exceeded maximum size of 67108864 bytes` |

The a774c3d99 red half (11 MB gives `-32000`, stub receives nothing) was measured in cycle 2 and nothing in that path
has changed since.

**Truncation behaviour** (`hel1348-eval3-raw.log`). I spawned the server and wrote straight to its stdin: a non-JSON
line, a non-JSON-RPC object, an unknown-id response with a 5,000-byte payload, then initialize and tools/list.
- Stdout is exactly two valid JSON-RPC lines (id 1, id 2), and the process stays alive.
- Every error goes to stderr. The unknown-id error is one 543-character line ending in `... [truncated]`.
- The zod union dump is cut off at 500 characters of message, though it still spans several stderr lines because the
  message itself contains newlines.
- The handler only calls `process.stderr.write`, so nothing can reach stdout.

**Can the truncation throw?**
- For an `Error`, it cannot: a 600-character message gives 515 characters, and an empty message gives 0.
- For a non-`Error` value it can. A string or `undefined` makes `err.message.length` throw a `TypeError` (tested in
  isolation).
- In sdk 1.31.0 I found no path that delivers a non-`Error` to `onerror`:
  - Every `Protocol` `_onerror` call wraps its value in `new Error(...)`.
  - The raw-error sites are `server/stdio.js:20,25,50` and `shared/protocol.js:857`. They receive ReadBuffer `Error`s,
    `JSON.parse` `SyntaxError`s, zod errors (subclasses of `Error`), stdin stream `Error`s, and `send()` rejections.
    `send()` only ever resolves, apart from a `JSON.stringify` `TypeError`.
  - Request and notification handlers run inside promise chains whose catches wrap in `new Error`.
- So no reachable input makes the handler throw, and this is not blocking. The cycle-2 version (`${err.message}`) would
  also have thrown on `undefined`.

**Accuracy of the derivation comment:**
- "JSON escaping at most doubles it (all quotes/newlines; ~1.03x for typical CSV)" holds for JS
  `JSON.stringify`-based clients. I measured 1.03x for typical CSV and 2.00x for all quotes/newlines in cycle 2. C0
  controls (6x) are called out separately.
- A client that escapes all non-ASCII (`ensure_ascii`) can reach 3x. 4 x 15 MiB still covers that, so the gap is in the
  wording only (see suggestions).
- "~9.8 MiB of C0" is (64 − 15) / 5. It assumes the remaining bytes expand 1x; with 2x bytes elsewhere the threshold is
  about 8.5 MiB. The "~" makes this acceptable.

**Other review points:** the code is minimal and readable, with a named constant and no dead code or type escape
hatches. The comment explains why, which CONTRIBUTING.md asks for.

### Phase 3: UI Review — N/A

No UI-triggering paths changed (`helio-mcp/**` and the change dir only). No dev servers were started.

### Overall: PASS

### Non-blocking Suggestions

- Harden the handler for non-`Error` values at no cost:
  `const text = err instanceof Error ? err.message : String(err);` and then truncate `text`. It isn't reachable today,
  but it would mean a future sdk path passing a raw value can't turn the error logger into a thrower.
- The comment's "at most doubles" could add "(JS clients; ensure_ascii-style clients up to 3x, still within 4x)".
- Out-of-scope follow-up, carried from evaluation-2: `UploadRoutes.scala:46`'s `p.toStrict(60.seconds)` probably caps
  image uploads at pekko's 8 MiB per part, below the configured 10 MiB. Not verified at runtime.
