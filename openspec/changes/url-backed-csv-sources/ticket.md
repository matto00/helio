# HEL-862: CSV sources: accept an HTTPS URL so they can refresh

## Description

From the Sleeper field report (`/home/matt/Development/fantasy/docs/helio-issues.md`, issue #7). Leaf 6 of epic HEL-857 (agent-authored external-API ingestion), v0.7.

`list_connectors` metadata advertises `csv` with `requiredFields: [{name: "path"}]`, and stored sources show `config.path = "csv/<uuid>.csv"`, but `create_csv_data_source` on the MCP surface accepts only inline `content`, uploaded as a snapshot. A CSV-backed dashboard therefore cannot refresh on a schedule at all — there is nothing to re-read, so refreshing means an agent re-uploading the entire CSV text every cycle.

HEL-599 (merged) relieved the compounding failure by removing the nested-JSON -> CSV detour, but URL-backed CSV is independently valuable: it is the natural shape for the many public datasets published as a CSV at a stable URL.

## Scope

- Accept an HTTPS URL for `csv` sources and re-read it on refresh.
- Keep inline `content` working; existing snapshot-backed sources unaffected, no migration regression.
- Treat a URL-backed CSV as a first-class refreshable source so the scheduler (and HEL-863's MCP schedule surface) can drive it.
- A URL-backed source also sidesteps HEL-861's row cap concern for large CSVs; note but do not conflate.

## Coordinator decisions (binding, supersede the original ticket wording)

1. **Build on `ContentSourceSupport.fetchUrl`. Reuse, do not fork.** The original ticket said to reuse "the same egress restrictions the REST connector uses". Premise validation found the REST connector has NO egress guard at all (`RestApiConnectorDriver.buildResolvedRequest` and `buildEphemeralRequest` both hand a caller-influenced `Uri` to `singleRequest` with only timeout settings; `ConnectorEntityService` checks `baseUrl.isEmpty` and nothing else). That is now filed separately as HEL-879 and is explicitly OUT OF SCOPE here. The real guard is `ContentSourceSupport` (`validateUrl`/`fetchUrl`/`isBlockedAddress`/`pinnedTransport`), already backing text/pdf/image URL sources. Its pinning of the TCP connection to the already-validated `InetAddress` is what makes it genuinely rather than superficially safe and must not be reimplemented.
2. **https-only enforced at the CSV call site; the shared guard stays untouched.** `ContentSourceSupport` permits http AND https. Do not tighten it — that would silently change behaviour for existing text/pdf/image callers who never asked for it. If this proves awkward in implementation, say so rather than quietly widening it.
3. **NO caller-supplied filesystem path.** The original AC asking for "a local path or an HTTPS URL" is OVERRIDDEN by the coordinator. An MCP caller cannot see the server's uploads root, so the capability has no legitimate use from the API surface, and adding traversal validation for it is pure attack surface. Record this override in design.md.
4. **The scheduled path is NOT `DataSourceService.refresh`.** A scheduled run goes `PipelineSchedulerService` -> `PipelineRunService.executeRun` -> `InProcessPipelineEngine.loadRowsWithStats`, whose `case c: CsvSource` unconditionally does `fileSystem.read(c.config.path)`. AC3 fails no matter how correct `refreshCsv` is unless the engine branch is fixed. Verify AC3 by running an actual scheduled fire, not by asserting `refreshCsv` was called.
5. **Carry into design:** text/pdf/image already carry `sourceUrl` with upload-vs-URL semantics, so this is extending an established pattern — but do not let that make you incurious. Check whether those three share the same scheduled-path gap just found in CSV. If `refreshText` works but the engine never calls it on a scheduled run, they share this bug, and that is wanted as a FINDING rather than an assumption either way. Do not silently fix it in this diff; report it.

## Acceptance criteria

- [ ] A CSV source created from an HTTPS URL re-reads that URL on refresh and reflects upstream changes without re-upload.
- [ ] A CSV source created from inline content behaves exactly as today; existing sources continue to work with no migration regression.
- [ ] A URL-backed CSV source refreshes on a schedule end to end.
- [ ] Non-HTTPS schemes and internal/link-local addresses are rejected with a clear error; tests cover each rejection class, not one representative.
- [ ] AC3's scheduled refresh is verified by running an actual scheduled fire through the engine path, not by asserting `refreshCsv` was called.
- [ ] The MCP tool description accurately states which inputs are accepted (the current mismatch between `list_connectors` metadata and the tool's real surface is itself part of the bug).

## Standing requirements (binding; have found a real defect in all six prior runs of this epic)

1. **Verify by measurement, not attestation.** Confirm red-on-revert against the FINAL committed tests; recapture if tests changed after evidence was taken. Prefer BEHAVIOURAL MUTATION over a compile-error revert — HEL-861 found a revert proved only that tests referenced the new API, while mutation proved three assertions were weak, including one where `include("1000")` was satisfied by the substring "1000-row run cap" alone.
2. **Audit prose against code, including your own premise check.** Reading a signature is not reading a call path. This is exactly how decision 4 above was found.
3. **A weak assertion is the same as no test.** Assert content, not presence. This epic has produced five tests that passed while asserting the wrong thing.
4. **User-facing wording is behaviour, not documentation.** Any error returned for a rejected URL must lead a caller to a correct conclusion. HEL-860's best catch was guidance text naming an accepted-but-wrong config.
5. **Derive sets by enumeration, not intuition, and distrust the ticket's counts and line numbers — including the coordinator's.** HEL-861 found "exactly two ConnectorDriver implementations" was five; HEL-860 found "exactly two files" was essentially all 24 decoders.

## Environmental notes

- `scripts/concertino/` is gitignored except a few force-tracked files: `emit-event.sh`, `persist-evidence.sh`, `next-report-number.sh` and `tui-attached.sh` DO NOT EXIST in this worktree. Run them from the main checkout at `/home/matt/Development/helio`, or fall back to `SendMessage` to `main`.
- Never report a `tsc --noEmit` result from a dependency-less worktree as a gate result. `frontend/node_modules` is linked here — verified present.
- `squash-branch.sh` parses only the FIRST backtick-quoted path per `^-` bullet in `files-modified.md`. One full path per bullet.
- `concertino-executor` has NO Linear tools. Route all ticket filing to the orchestrator.
- Another session is working in the shared main checkout on branch `task/readme-refresh`. Do NOT switch branches, stash, reset, clean, or delete files there. Main-checkout commands must be read-only.
