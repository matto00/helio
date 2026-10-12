## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD `797b418e94dcc7c41147c5c6ad1adc8a049199c7`. The base was resolved live with `resolve-review-base.sh`: `41db49cee08f358a491253a1021e594b74d9dd6a` (merge-base with origin/main, after the HEL-1504/HEL-1490 merge). Diff: 20 files, +884/-49.
The evaluator's own evidence is in `/home/matt/Development/helio/.concertino/runs/HEL-1476/evidence/` (files prefixed `eval-c1-`, plus `eval-c1-playwright/`).

### Phase 1: Spec Review — PASS
- AC1: PASS. `PipelineStepWrites.duplicateStep` (PipelineStepWrites.scala:254-256) now calls `PipelineStep.rawConfigProblem(existing.kind, encode(existing))`. It runs after the editor/ACL check, so 404/403 masking is unchanged, and on rejection it returns the same `UnprocessableEntity(msg)` that update returns (line 71-73). `DuplicateStepWriteValidationSpec` covers 9 kinds through the real route. The per-kind enumeration (`hel1476-per-kind-enumeration.txt`) lists the 17 non-reachable kinds and the reason for each. I checked the reasoning and it holds: the default `validateRawConfig` is type-only, and a typed re-encode only emits well-typed values.
- AC2: PASS. Route tests show cast `{}`, convertformat `{"field":""}`, pivot, fillnull and window drafts each returning 201. `DraftRoundTripWriteSafetySpec` pins every registered kind (`drafts.keySet shouldBe Registry.keySet`).
- AC3: PASS. The guard reads `CastStep.SupportedTargets` and fails loudly when it extracts nothing. The executor's mutation runs on both sides are recorded (`hel1476-guard-mutation-*-side.txt`). I verified the running app myself (Phase 3).
- AC4: PASS. The `pipeline-cast-op` Purpose is filled in, and the file has no "TBD".
- AC5: PASS. The `CastPipelineRunSpec` GUARD runs a stored `binary-ref`/`string-body` cast through `PipelineRunService.submit`, and its mutation red is recorded. The test is green in my fresh `sbt testFull` on the merged HEAD, so it survived HEL-1504's run-gate change. I also confirmed it live: a real run of a pipeline with a stored `binary-ref` target succeeded and preview passed `doc` through unchanged.
- Tasks 1.0-4.7 are all marked done and match the diff. Spec deltas were archived into `pipeline-cast-op` and `pipeline-step-lifecycle`.
- Scope: the convertformat writer change (D2) is design-mandated and in scope. The duplicate change only adds a rejection before the existing clone path. It is strictly more restrictive and does not widen the secondary-source/lane/upsert-ownership gap the skeptic noted in rounds 1 and 2; that gap is out of scope and unchanged.
- CONSTRAINTS C1-C4: honoured. C2: `[hel1468-guard] ScalaTest summary: failed=0 aborted=0 unreadable=0` is in my run, and the new DB spec uses `VerifiedEmbeddedPostgres.start`. C3: no inline FQNs, no new eslint-disable, and lint/scala-quality are clean.

### Phase 2: Code Review — PASS
Gates, run fresh in WORKTREE_PATH on HEAD 797b418e9:
- `npm run lint`: rc=0 (`eval-c1-lint.txt`)
- `npm run format:check`: rc=0 (`eval-c1-format.txt`)
- `npm run typecheck`: rc=0 (`eval-c1-typecheck.txt`)
- `npm --prefix frontend run build`: rc=0 (`eval-c1-build.txt`)
- `npm test`: helio-mcp 454/454, frontend 562 suites / 6157 tests, all passed, rc=0 (`eval-c1-jest.txt`)
- `cd backend && nice -n 19 sbt testFull`: 7304 succeeded, 0 failed, 4 canceled (HELIO_MEASURE-gated measurement tests), `[hel1468-guard]` present, rc=0 (`eval-c1-sbt-testfull.txt`)

Convertformat writer (D2) consumer check:
- Frontend `ConvertFormatConfig.tsx` `pairKey` maps `undefined` to `""`.
- `stepNarrowing`/`stepCardOpHandlers` treat `from`/`to` as optional.
- No JSON schema or openspec spec asserts a present `"from":""`.
- `decode` reads an absent key as `""`, so the typed value is identical.
- A half-set stored draft (`from` set, `to` empty) now also round-trips without a spurious `pairError`, which is an improvement.
- Runtime and `requiredConfigProblems` work from the typed config, so behaviour is unchanged apart from the analyze wording difference the executor disclosed.
No regression found.

Red-first evidence: the executor's `hel1476-dup-route-red-unfixed.txt` was captured with earlier fixture values (aggregate `median`, upsertsource `target.kind:'existing'`), which were later corrected. The final fixtures were therefore never literally shown red on the unfixed tree. On the unfixed tree, though, duplicate never returns 422 for any stored config: it was either 201, or 500 on decode failure. Every final RED row is therefore red by construction, so this is non-blocking.

Issues: none blocking.

### Phase 3: UI Review — PASS
I stopped the stale dev servers by exact PID (they were started before the origin/main merge) and restarted them on HEAD 797b418e9 via `start-servers.sh` (6908/9815); `assert-phase servers` PASSed. The probes used a throwaway user, `hel1476-eval-c1-1791772009193@example.test` (id `5a6a424b-0131-48aa-9d82-64cbc55b8c35`), verified via `/api/auth/me` before every action.
- Picker: the `when` dropdown offers keep-as-is plus string, integer, long, float, double, number, boolean, date, timestamp. Evidence: `eval-c1-playwright/hel1476-eval-c1-picker-nine-options.png`, sha256 7419f5a4...
- Selecting `timestamp` persisted: `GET .../steps` returned `{"casts":{"when":"timestamp"}}`, and it still shows after a reload.
- Legacy target: I set `{"doc":"binary-ref","when":"timestamp"}` by exact step id via SQL, then reloaded. The `doc` trigger reads "binary-ref (unsupported)", not keep-as-is. The option is `aria-disabled`, and the `when` row has no unsupported option. Evidence: `hel1476-eval-c1-legacy-unsupported.png`, sha256 95a1cc39...
- Duplicating that step shows a visible error toast: "Failed to duplicate step: cast: unsupported target type 'binary-ref' for field 'doc'. Supported: string, ..., timestamp". The step count stayed at 1. Evidence: `hel1476-eval-c1-duplicate-422-toast.png`, sha256 1f1ca6c6...
- Run pipeline with the stored legacy target: status `succeeded`, rowCount 2. `doc` passed through and `when` cast (`tomorrow` became null).
- Breakpoints: at 1440, 768 and 375 there is no document overflow and no clipped trigger text (`-768.png`, `-375.png`).
- Console: only the pre-existing `/schedule` 404 (no schedule set) and the expected network-level 422 log for the duplicate request. There are no unhandled exceptions.

The claims above rest on DOM/API readouts and content hashes, not file mtimes.

Environment note: the shared Playwright browser was used concurrently by another lane (HEL-1506, port 6938). Because localhost cookies are not port-scoped, that lane's login replaced my session once. I caught it via `/api/auth/me` before acting. I deleted the one screenshot taken while the page belonged to the other lane, then re-logged in as my own user and redid the checks. No action was taken under another identity. My re-login will have logged the other lane out of the shared browser.

Residue: I deleted the probe pipeline `d2eabec5-4c84-406b-bc03-df9f005b13e1` and data source `ddedcbee-50c7-4fe6-80e5-a1a2d7cb2d88` via the API by exact id, then deleted the `pipeline_run_rate_window` row and the user row by exact id. The owner-scoped pipeline, source and dashboard counts were 0 first. The dev servers are left running on HEAD for the skeptic.

### Overall: PASS

### Change Requests
None.

### Non-blocking Suggestions
- `PipelineStepWrites.scala` is now 300 lines, over the ~250 informational budget. A future split of duplicate into its own collaborator would help, but it is out of scope here.
- The `isDefined`/`.get` pair at PipelineStepWrites.scala:256 mirrors the update path (line 72-73). A `match` would be more idiomatic if both are touched later.
- The unsupported option sits at the bottom of a long, scrolling list. That is acceptable because the trigger shows the stored value, but the skeptic may want to judge the placement.
