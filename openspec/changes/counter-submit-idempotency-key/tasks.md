## Standing Constraints

- [C1] Never read/cat/grep/source/print any .env file, never copy one, never run env-dumping commands; start servers only via start-servers.sh.
- [C2] Red first: write the Tests group (5.x) first, record the red run as committed .txt evidence, then implement; each guard paired with a mutation.
- [C3] Lane-private DB helio_hel1175 (jdbc:postgresql://localhost:5432/helio_hel1175) exported in the SAME command as every server start, sbt run, Playwright run, e2e cleanup and DB-touching hook; ANTHROPIC_API_KEY exported empty.
- [C4] Caps: jest 3 workers, Playwright 2 workers total, sbt -J-Xmx3g, nice -n 19; Bash timeout 600000; sbt testFull in shards that finish under it.
- [C5] Quoted heredocs only; no pkill/pgrep/killall; stop servers by exact PID / stop-servers.sh; scratch only in the main checkout's .concertino/scratch/HEL-1175/.
- [C6] Migration is additive only (no UPDATE/backfill on FORCE-RLS dataset_rows); avoid HEL-1707 and HEL-1517 files.

### Backend

## 1. Migration and repository

- [x] 1.1 Add the next-free-V migration: submit_key/submit_user_id/submit_panel_id columns + partial unique index (design D2)
- [x] 1.2 Add SubmitKeyStamp, new public appendBuiltRowKeyed, KeyedAppend (Appended/Replayed) and FormRowBuildFailure.KeyConflict; appendBuiltRow unchanged (design D3)
- [x] 1.3 Look up the key under the source lock before build; stamp the three columns on the inserted row in the same transaction
- [x] 1.4 Map ONLY a 23505 on ux_dataset_rows_submit_key to KeyConflict, recovered after rollback (design D3)
- [x] 1.5 Add the submit_user_id / submit_panel_id partial indexes; add the dataset_rows row to docs/user-reference-inventory.md

## 2. Service, protocol, route

- [x] 2.1 FormSubmitRequest gains optional submitKey with strict UUID validation (design D1)
- [x] 2.2 Thread the stamp through PanelService.submitForm and DataSourceService.appendFormRow (JSON path only)
- [x] 2.3 Replayed: skip audit and triggerAutoRunAwaited, empty denials, replayed flag; KeyConflict: fixed-message 409
- [x] 2.4 completeSubmit answers 200 for a replay, 201 for a fresh append, same body shape and masking
- [x] 2.5 Update schemas/panels/form-submit-request.schema.json (submitKey, format uuid, description), protocol write
- [x] 2.6 Thread replayed via RowWriteResult.replayed, FormSubmitResult.replayed delegating to it; no FormAppendOutcome wrapper (design D4)

### Frontend

## 3. Client key and retry

- [x] 3.1 submitFormPanel JSON branch mints one crypto.randomUUID() per call and sends it as submitKey
- [x] 3.2 Re-send the same body and key on a no-response failure, at most 2 retries (300 ms, 900 ms, injectable)
- [x] 3.3 TS FormSubmitRequest gains submitKey?; retry only on isAxiosError && no response
- [x] 3.4 Confirm useCompactCounterSubmit and FormPanelView need no change beyond treating 200 like 201

## 4. Docs

- [x] 4.1 CLAUDE.md submit endpoint line: submitKey, replay 200, 409 rule

### Tests

## 5. Tests (written and run RED first, per C2)

- [x] 5.1 Backend route spec: same-key re-submit appends exactly one row and answers 200 with the original row; mutation dropping the lookup turns it red
- [x] 5.2 Backend: no-key submit unchanged (201, one row each); malformed key 400 and nothing written
- [x] 5.3 Backend: different submitter (editor vs owner) and different panel same-key -> 409, no row id/seq in body
- [x] 5.4 Backend: replay writes no audit event and no pipeline_auto_run_debounce change; non-owner replay has no seq
- [x] 5.5 RLS parity: NOBYPASSRLS spec covering keyed append, replay and conflict in the form owner's context
- [x] 5.6 Seam test: the client's submitKey reaches the server under the field name the protocol reads (shared fixture)
- [x] 5.7 Jest: one key per call, retries reuse it, max 3 requests, a response stops retries, manual calls get new keys
- [x] 5.8 Jest: counter lost-ack then replayed 200 shows one increment and no error
- [x] 5.9 Repository spec: pre-inserted keyed row + lookup bypassed -> KeyConflict; a seq 23505 is NOT mapped
- [x] 5.10 Panel delete and user (editor) delete with keyed rows: rows survive, refs NULL, same key -> 409 (NOBYPASSRLS)
- [x] 5.11 Run V119OwnerFkMigrationSpec (user-reference inventory) green
