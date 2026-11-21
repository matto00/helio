## Standing Constraints

- [C1] Never read, print, copy or source any .env file; no env-dumping commands (only scripts may read .concertino.env).
- [C2] Quoted heredocs only (<<'EOF').
- [C3] No pkill/pgrep/killall; exact PIDs; stop servers with stop-servers.sh; residue removed by exact id.
- [C4] jest 3 workers, Playwright 2, sbt -J-Xmx3g, nice -n 19.
- [C5] Bash timeout 600000; sbt testFull in shards fitting the timeout; no background run past the tool timeout.
- [C12] Red first with mutations, full spec files; commit the red run before implementation code; no sleep timing.
- [C14] Lane DB helio_hel1796 via DATABASE_URL for servers, Playwright, jest and hooks; ANTHROPIC_API_KEY exported empty.

### Backend

## 1. Probe and red

- [x] 1.1 Confirm D3/D4 timestamp facts in probe-notes.md, incl. stored data_sources.created_at == stored dataset_rows.created_at
- [x] 1.2 Write red spec on helio_app_test (rolbypassrls=false) covering every spec scenario; commit the red run

## 2. Journal

- [x] 2.1 Add JournaledCreatedDataset + optional createdDataset on JournaledEdit (format order as documented)
- [x] 2.2 Journal JournaledCreatedDataset(rowsStampedAt = stored data_sources.created_at, declaredSchema) per D2 (never fails apply)

## 3. Guard

- [x] 3.1 Add privileged-pool read (appendedCount, editedCount, live dataset_schema, sourceUpdatedAt) on DataSourceRepository
- [x] 3.2 Add PatchSetUndoDatasetLaterWork (created_at detection, fallback, nameList reference wording, D7 messages)
- [x] 3.3 Wire Phase-1 blockers into checkOne's dataSource create arm (not guarded's else branch)
- [x] 3.4 Add the Phase-2 re-check to the dataSource create arm of PatchSetUndoService (minimal)

### Tests

## 4. Verification

- [x] 4.1 Turn the red spec green; run the mutations from design D8 and record each red
- [x] 4.2 Re-run existing patch-set undo/apply specs, MCP undo_patch_set wording test and web undo toast test
- [x] 4.3 Update patchsets README for the new guard and journal field

### Delivery

## 5. Delivery (orchestrator)

- [x] 5.1 (superseded: owner chose fold-in, see 6.x) Raise the D9 inline-dataset-root follow-up via follow-up triage before presenting the PR; cite its id in PR body + closing comment

### Backend (fold-in, design D9)

## 6. Inline dataset roots

- [x] 6.1 Red first on helio_app_test (rolbypassrls=false): append, row edit, schema edit, referenced-kept (visible and hidden), clean undo; commit red
- [x] 6.1b Also: non-dataset inline root with moved updated_at undoes; old-journal append refuses via fallback; own join/lookup ref not counted
- [x] 6.2 Journal createdDataset on JournaledInlineSource for dataset-kind inline roots (never fails apply)
- [x] 6.3 Shared inline check: live kind = dataset only; refs minus undone pipeline incl. hidden counts = skip; wired in guarded
- [x] 6.4 Phase-2 re-check (same shared check, references included) before the pipeline delete; hook tests unreferenced + referenced

### Tests (fold-in)

## 7. Verification

- [x] 7.1 Green the 6.1 spec; mutations (drop inline check, drop Phase-1 ref skip, drop Phase-2 ref skip, drop kind filter, flip a comparison) each red
- [x] 7.2 Re-run patch-set/sources spec sets, MCP refinement and web patchSets tests; update patchsets README
