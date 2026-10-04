## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed commit 5a0e83f348f40d46ddaf1bb480a819b4944b20e5, base 7138d4e9.

### Phase 1: Spec Review — PASS
- AC narrowed per owner ruling (15 MiB / 50,000 rows / 300,000 cells); proposal, design, tasks, spec delta and measurements all state the shipped caps (C4 satisfied in artifacts; the PR body must repeat it).
- Enforcement present at every CSV entry/consumption point: createCsv, infer, createCsvUrl (post-fetch), refresh (URL + stored), previewCsv, run-time load (`csvRowsWithinLimits` for both the fetched and stored-path branches), first-run (goes through infer + create). `CsvUrlFetch.maxFileSizeBytes` now aliases `CsvLimits.maxBytes` (single source). Run-time failure is an IllegalArgumentException carrying the limits message.
- Constraints: C1 (bare CR/CRLF/LF counted, test present), C2 (see below), C3 (verified live), C5 (no large files committed; scratch deleted) honored.
- Scope: head-only inference/UTF-8 streaming validation is in-scope per D4. No unrelated changes seen.

### Phase 2: Code Review — PASS
Gates run fresh in WORKTREE_PATH:
- `nice -n 19 sbt testFull`: 5557 passed, 0 failed, 383 suites; `sbt --client shutdown` separately. No known-flake hits.
- `npm run lint`, `format:check`, `typecheck`: clean. `npm test`: 411 suites / 4281 tests pass (+ helio-mcp 349). `npm --prefix frontend run build`: OK. `npm run check:schemas`: in sync. `openspec validate csv-upload-entity-limit`: valid.

Targeted review:
1. Per-part limits (DataSourceRoutes.scala:291-305): `file` part capped at max(csv,text,pdf,image)+1 MiB, every other part at 1 MiB, by name, so part order is irrelevant (verified live with `file` before `type`). Live: 25 MB pdf -> 413, 15 MB text -> 413 with the text-cap message, 16 MB CSV create -> 413, never 500.
2. Semaphore (CsvUploadDirectives.scala): `tryAcquire` before `inner`, 429 + Retry-After before the entity is touched (test with a lazy body asserts untouched), release via `result.onComplete` plus a catch for synchronous throws; tests cover success, inner failure and 429-before-body. Live: 4 concurrent slow uploads -> 2x200, 2x429.
3. Row counting: LF/CR/CRLF in `CsvLimits.scan` matches `linesIterator`; bare-CR tested in CsvLimitsSpec and via HTTP.
5. Frontend: hard-coded constant removed (grep clean), limits fetched/cached and the pre-check skipped on fetch failure (tested), 413 shows the server message with no Retry (tested), 429 copy exists on the first-run path, edge test now pins the fetched limit.

### Phase 3: UI Review — PASS
Servers started via start-servers.sh; bound pids' cwd verified to be this worktree (readlink /proc/<pid>/cwd). In AddSourceModal (CSV, "Preview schema"): a 16.16 MB file in dark theme and a 60,000-row file in light theme both surface the server's 413 message ("CSV is too large: files are limited to 15 MiB (15728640 bytes), 50000 rows and 300000 cells (rows x columns)") in the modal with no retry affordance; the only console error is the expected 413 network entry. A 12 MB in-cap file infers 200. Servers stopped by exact pid; scratch files deleted; no dev-DB rows created (all create attempts were rejected, infer persists nothing). Breakpoint resize and the first-run drop zone were not exercised live (covered by unit tests; the drop zone is only reachable on an empty account).

### Overall: PASS

### Change Requests
none

### Non-blocking Suggestions
- The test "return 413, not 500, for a pdf upload over the largest non-CSV cap without buffering the whole entity" is mislabeled and weak: the 25 MiB body is buffered up to ~21 MiB before the limit trips, and the assertion holds under any smaller limit, so it does not pin the per-type behavior. Effective buffer for text (cap 10 MiB), pdf/image (cap 20 MiB) is now max-cap+1 MiB = 21 MiB, i.e. above their own caps for text (bounded by 2 permits). Suggest renaming and adding mutation-failable cases: text/pdf of 11-20 MiB -> 413 carrying the per-type cap message, and `file` before `type` ordering (I confirmed both live with curl, but no test pins them).
- `entityTooLarge` maps every `EntityStreamException` (malformed/truncated multipart, client abort) to a 413 "CSV is too large" message; only `EntityStreamSizeException` is truly a size problem. Also an over-limit pdf/text/image hits that CSV-worded message (live: 25 MB pdf) rather than its own cap message.
- AddSourceModal shows its generic copy for a 429 from the new gate; the first-run flow already has retry-later copy.
- DataSourceRoutes.scala:292 and DataSourcePreviewRoutes.scala:73 leave the new `csvUpload { ... }` block bodies un-indented relative to the wrapper.
- PR body must state the AC narrowing (C4).
