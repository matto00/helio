## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD `cea3c4332a407f771168fe61e24ea599e9d0f89f` against base `9c41719c376b858ab9269fa6075f8b3b74acabd1`, which was resolved live with `resolve-review-base.sh <wt> main origin` (rc=0). All installs, builds and probes ran in fresh `git archive` exports of base, a774c3d99 (the bump alone) and HEAD under `$SCRATCH/hel1348-sk/`. npm cache and logs went to the scratchpad. Nothing was written under `~` and no committed file was modified.

### What I verified (with evidence)

1. **Diff scope.** `git diff --stat BASE...HEAD` touches only `helio-mcp/package.json` (1 line), `helio-mcp/package-lock.json` (6+/6-), `helio-mcp/src/index.ts` (+23/-1), plus files in the change dir. It does not touch `ci.yml`, `.audit-ci.jsonc`, `frontend/`, or the verify harness or README. `evaluation-3.md` exists in the worktree but is untracked.
2. **Lockfile churn.** I compared the base and HEAD `packages` maps with Python. Keys added: none. Keys removed: none. The only version change is `node_modules/@modelcontextprotocol/sdk` 1.29.0 -> 1.31.0. The only changed entries are that one and the root `""` range line. The sdk entry's `@hono/node-server` range widened to `^1.19.9 || ^2.0.5`, but the resolved hono entry is unchanged. `node_modules/zod` is byte-identical (True).
3. **AC: sdk >= 1.31.0 with the smallest change.** The declared range is `^1.31.0`. After a fresh `npm ci` in the HEAD export, `helio-mcp/node_modules/@modelcontextprotocol/sdk/package.json` reports `1.31.0`.
4. **AC: no allowlist entry, audit red to green.** `.audit-ci.jsonc` is identical on base and HEAD (`"moderate": true, "allowlist": []`). I ran a fresh root `npm ci`, which installs root-pinned audit-ci 7.1.0, then the exact CI command `npx audit-ci --config helio-mcp/.audit-ci.jsonc --directory helio-mcp`:
   - HEAD: rc=0, `Passed npm security audit.`
   - Base lockfile (same config): rc=1, the only path is `GHSA-6qxp-vccf-f47h|@modelcontextprotocol/sdk`.
   - Logs: `hel1348-sk/audit-head.log` and `hel1348-sk/audit-base.log`.
5. **AC: build, typecheck and Jest on a fresh install (HEAD export).**
   - `npm --prefix helio-mcp ci`: rc=0.
   - `npm --prefix helio-mcp run build`: rc=0.
   - `npm run check:helio-mcp-types`: rc=0.
   - Root `npx jest helio-mcp --maxWorkers=3`: rc=0, 38 suites and 371 tests passed.
   - Root `node_modules` has no `@modelcontextprotocol`, so Jest uses helio-mcp's 1.31.0 copy.
6. **AC: transport and tool-registration API unchanged.** I diffed the sdk typings from the 1.29.0 install (base) against 1.31.0 for every module helio-mcp imports (`server/mcp`, `server/index`, `client/index`, `shared/protocol`, `inMemory`, `types`). All are byte-identical. `server/stdio.d.ts` and `client/stdio.d.ts` differ only by an added optional `maxBufferSize` option, so the change is additive.
7. **AC: 11 MB red/green.** I wrote my own probe, `hel1348-sk/probe/probe.mjs`. It uses an sdk Client and StdioClientTransport, with a stub HTTP backend that records request bytes, and sends an 11,000,000-byte inline-CSV `create_csv_data_source`:
   - a774c3d99 (bump alone): `MCP error -32000: Connection closed`. The stub received nothing, and server stderr shows only targeting/ready, so the session closed silently.
   - HEAD: the call succeeds and the stub logged `POST /api/data-sources bytes=11000255`.
   - Logs: `hel1348-sk/redgreen-bump.log` and `hel1348-sk/redgreen-head.log`.
8. **Is 64 MiB sound?** I checked the comment's citations against the source:
   - `CsvLimits.scala:17`: 15728640.
   - `UploadRoutes.scala:37`: 10485760.
   - The 8 MiB per-part `toStrict` hazard is documented at `DataSourceRoutes.scala:309`.
   - The sdk default is `10 * 1024 * 1024` (`shared/stdio.js:2`).

   The cap is not the per-line maximum. `ReadBuffer.append` compares the accumulated undelivered bytes against the cap, and `processReadBuffer` drains complete lines after every chunk, so in practice it is "one line plus one stdin chunk".

   Worst-case probe: a 15 MiB CSV made entirely of `"` characters. That is about 30 MiB on the wire after JSON escaping, and it was forwarded on HEAD (`bytes=15728895`, `hel1348-sk/head-15q.log`).

   The C0-control (6x `\uXXXX`) exception is real, and the comment discloses it honestly. Non-Node clients that use ensure_ascii-style escaping inflate a character by at most 3x (a 2-byte UTF-8 character becomes `\uXXXX`), which is still under the 4x budget. The value and its stated derivation hold.
9. **Overflow logging and stdout safety.** A 70,000,000-byte request on HEAD produces stderr `helio-mcp: transport error: ReadBuffer exceeded maximum size of 67108864 bytes`, then the client gets a clean `-32000 Connection closed` (`hel1348-sk/head-70m.log`). The client parsed every response it got (the 11 MB and 15 MiB calls) with no JSON-RPC framing errors.

   Code review of the handler:
   - It writes only via `process.stderr.write` and never touches stdout.
   - `Protocol.connect` (`shared/protocol.js:225-228`) chains `transport.onerror` into `this._onerror`, which calls `this.onerror`. Setting `server.server.onerror` before `connect` is therefore preserved.
   - The sdk's own `close()` path is unchanged.
   - Truncation to 500 chars bounds the log size.
10. **Owner ruling.** `ticket.md` contains the `include-index-edit` ACs, which match the source of this review's dispatch. `files-modified.md` and design.md D6 (line 64) both mark the response side as UNVERIFIED, as the AC requires.
11. **Process hygiene.** I recorded the four probe server PIDs (383579, 383611, 384074, 384838). `ps -p` shows none remaining. I killed nothing.

### Verdict: CONFIRM

### Non-blocking notes
- **AC "show the audit red to green on CI" is not yet satisfiable.** No PR exists yet (`gh pr list --head <branch>` is empty). tasks.md 2.7 leaves it open and assigns it to the orchestrator. The orchestrator must cite the CI run id with the `security` job's helio-mcp audit step green before merge. Locally, the exact command is reproduced red on base and green on HEAD.
- **The comment's "Per-line stdin cap" is slightly imprecise.** The sdk caps the accumulated undelivered read buffer, as described in item 8. That is effectively per-line at 64 KiB stdin chunks, so this is not a defect.
- **Narrow theoretical gap in the `onerror` handler.** It assumes `err.message` is a string. If the transport ever passed a non-Error, `.length` would throw inside the stdin `data` handler. Every current sdk throw site I traced passes an `Error` (`JSON.parse` throws SyntaxError, zod throws ZodError, `ReadBuffer` and `Protocol` construct `new Error`), so this is not reachable today.
- **The bump-alone (a774c3d99) export's `tsc` build exited 2** because the standalone export has no root `@types/jest`. It is environmental to my scratch layout: the export lacks the root `node_modules`, and the HEAD export, which had the root install, built rc=0. tsc still emitted `dist/index.js`, and I used that for the red probe after confirming it contains the un-optioned `new StdioServerTransport()`.
- I did not observe any gate defect around mtime-based evidence. No claim in this report depends on mtimes.
