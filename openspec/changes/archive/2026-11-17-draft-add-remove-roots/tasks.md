## Standing Constraints

- [C1] Never read, cat, grep, source or print any .env file; never run env-dumping commands (env, printenv, set, export -p, /proc/*/environ). Scripts may read scripts/concertino/.concertino.env but never print it.
- [C2] Quoted heredocs only (<<'EOF') or Write/Edit; no backticks or $(...) inside echo strings.
- [C3] No pkill/pgrep/killall; kill only by exact PID; stop servers with stop-servers.sh; DB residue deleted only by exact id via buildUserDeleteSql.
- [C4] jest maxWorkers 3, Playwright workers 2, sbt -J-Xmx3g, nice -n 19.
- [C5] timeout 600000 on long calls; use sbt testFull (sbt can print TESTS FAILED and exit 0).
- [C12] Every e2e test and guard fails first, with recorded mutations; UI compared against the running app light/dark, desktop/phone.
- [C13] Scratch in .concertino/scratch/HEL-1734/ only.
- [C15] Any DB needed uses a lane-private database (createdb helio_hel1734 + DATABASE_URL override on start-servers.sh), dropped at Delivery; a migration, if any, is V143.

## 1. Backend

### Backend

- [x] 1.1 Add `roots`, `rootClientId`, `confirmCascade.rootIds`, `impact.rootIds`, `definition.roots` to `DraftSaveProtocol` and `schemas/pipelines/draft-save-request`, `draft-save-response` and `draft-cascade-required-response` schemas (D1); schema-drift check passes
- [x] 1.2 `DraftDiff` root pass (D2/D3): resolve, order, final positions, removed roots, `rootClientId` for steps/Outputs, `addedSourceIds`, `needsAdvisory`; `DraftDiffSpec` covers each 400 in the spec
- [x] 1.3 `checkReferences`: caller-owned added sources in Public mode (D6); 404 case in `DraftSaveApiSpec`
- [x] 1.4 Lock site (0) `LockSite.SaveRootSources` before `lockDefinition`, the post-re-plan subset guard, and the in-transaction cycle check (D4)
- [x] 1.5 Apply root inserts, removals (node_snapshots + root rows), position compaction, cascade gate `rootIds`, audit payload (D5)
- [x] 1.6 Journal `rootDefs` and `DraftRestore` roots, with restore-mode source-exists refusal (D6/D7)
- [x] 1.7 Response `definition.roots` via `DraftDefinitionReads`

## 2. Frontend

### Frontend

- [x] 2.1 `rootAdd`/`rootRemove` ops, replay (cascade to steps/Outputs), prune, `DraftOverlay` v4, keptDraft v3 migration that rejects a root op in a v2/v3 blob (D9)
- [x] 2.2 Draft roots in the page model: spine and mobile source lists, draft styling, add/insert anchors on a draft root
- [x] 2.3 Unblock Add source / Remove source in a draft (desktop spine, phone menu, source card); last-source block uses draft count
- [x] 2.4 Save request `roots` + cascade confirmation listing removed sources; apply `definition.roots` after save
- [x] 2.5 Draft preview: sample ids include draft roots' sources; root frames keyed by draft root id

## 3. Tests

### Tests

- [x] 3.1 `DraftSaveApiSpec`: add, remove, add+step, absent-roots unchanged, foreign source 404, empty roots 400, reorder 400, survivor-with-sourceId 400, cycle 400, replace-the-only-root 200, remove-first-and-add 200 (both red against insert-at-final-position), unconfirmed 422, stale 409 after a standalone root add
- [x] 3.2 `DraftSaveRaceSpec` root-adding and root-removing save vs source delete, root add, root remove (writer-first/save-first, control red with the lock site removed; source delete writer-first answers 404 not 500), dataset append vs a root-adding save, `g1-writers.md` rows for the dataset writers; `DraftSaveDeadlockSpec` with an opposite-order control raising 40P01; record red logs under the change's `evidence/`
- [x] 3.3 `DraftSaveUndoSpec`: undo of a root add and of the removal of the root at position 0 of two (original ids and position, fingerprint equals pre-save), source-deleted refusal
- [x] 3.4 `SourceSampleServiceSpec`: editor's own non-root source with `pipelineId` → 200; foreign non-root → 404 (D8)
- [x] 3.5 Jest: op replay/prune/keptDraft migration/save-request builder/unblocked controls, each with a recorded mutation that turns it red
- [x] 3.6 Playwright e2e per action (add source in draft + save; remove source in draft + confirm + save; discard; kept-draft reload; stale-base reload) on desktop and phone, failing first with recorded mutations
- [x] 3.7 Screenshots of drafted add/remove source in light and dark, desktop and phone, compared with the running app; update `docs/live-draft-preview.md` section 8.3.1 for lock site (0) in the save
