## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD `797b418e94dcc7c41147c5c6ad1adc8a049199c7`. Base resolved live with `resolve-review-base.sh`: `41db49cee08f358a491253a1021e594b74d9dd6a`. Diff: 20 files, +884/-49.
Evidence dir: `/home/matt/Development/helio/.concertino/runs/HEL-1476/evidence/` (files `skeptic-final-1-*`, plus `skeptic-final-1-playwright/`). That directory is the durable run dir, outside the worktree.

### What I verified (with evidence)

**AC1: duplicate runs the write-path check (red first, final fixtures).** `PipelineStepWrites.scala:254-256` calls `rawConfigProblem(existing.kind, encode(existing))` after the editor/ACL check and returns the same `UnprocessableEntity` as update.
- The evaluator's open question (a) was whether the FINAL route-spec fixtures were ever shown red. I settled it myself:
  - I created a scratch detached worktree at HEAD and reverted ONLY `PipelineStepWrites.scala` to the base version.
  - I ran `testOnly DuplicateStepWriteValidationSpec`: `failed=9`, `[hel1468-guard]` present (`skeptic-final-1-dup-route-red-unfixed.txt`).
- All 9 stored-invalid kinds (cast, compute, aggregate `bogus`, pivot, fillnull, window, upsertsource `existingSource`, generatetext, analyzewithai) returned **201 with a written clone** on the unfixed tree. That is the real bug, not a 500 on decode.
  - This is stronger than the executor's earlier log, where upsertsource returned 500 with the old fixture.
- The draft and rename rows stayed green on the unfixed tree, as expected.
- On the restored HEAD, DuplicateStep, DraftRoundTrip and CastPipelineRun all pass: 50 passed, 0 failed, `[hel1468-guard] failed=0` (`skeptic-final-1-fixed-green.txt`).
- The scratch worktree is removed and its sbt server shut down.
- The per-kind enumeration of non-reachable kinds holds. Of the 11 `validateRawConfig` overrides, rename's extra rule fails at decode (already a 500), and the other non-listed kinds only check types, which a typed re-encode cannot violate.

**AC2: drafts stay duplicable.**
- Route tests return 201 for cast `{}`, convertformat `{"field":""}`, pivot, fillnull and window.
- GUARD mutation: I reverted the `ConvertFormatConfig` writer (with the D1 check still in place). Three tests went red: convertformat duplicate (422), the stored-shape guard, and the `DraftRoundTripWriteSafetySpec` convertformat row (`skeptic-final-1-mutation-writer-reverted.txt`). The guard is failable by mutation.

**AC3: picker list.**
- GUARD mutation on the backend side: I removed `"date"` from `CastStep.SupportedTargets`, and the jest guard went red (1 failed). The file is restored and `git status` is clean (`skeptic-final-1-guard-mutation-backend.txt`). The frontend-side mutation is recorded by the executor.
- The component and 422-toast tests are green (`skeptic-final-1-jest-green.txt`).
- Running app on 6908/9815, with a throwaway user `hel1476-skeptic-final-1791773206591@example.test` (id `29c4ab21-27c7-488f-9a5e-86fc3d9507b6`), checked via `/api/auth/me` before each action:
  - The picker offers keep-as-is plus the nine backend targets in backend order (DOM readout).
  - Selecting `timestamp` persisted: `GET .../steps` returned `{"casts":{"when":"timestamp"}}`.
  - I set a stored `doc: binary-ref` by exact step id via SQL and reloaded. The trigger reads "binary-ref (unsupported)", and the option is `aria-disabled=true`, dimmed, and last in the list.
  - Duplicate shows the error toast "Failed to duplicate step: cast: unsupported target type 'binary-ref' ...", and the step count stayed 1.
  - Screenshots (sha256 prefixes): `skeptic-final-1-legacy-open-dark.png` (7b1849ef...), `skeptic-final-1-legacy-open-light.png` (fdd86a12...), `skeptic-final-1-duplicate-422-toast-dark.png` (79ea1f33...). `skeptic-final-1-picker-open-light.png` is a mislabelled 375px dark capture taken before I resized the shared browser; I do not cite it.
- Console: only the pre-existing `/schedule` 404 and the expected 422 network log.

**Design judgment.**
- Uses the shared `Select` with its `disabled` option support. No new CSS and no hardcoded values.
- The "(unsupported)" label matches the existing sibling pattern in `ConvertFormatConfig.tsx:64`.
- Light and dark render the same way: the disabled option is dimmed in both themes, and the trigger text is legible in both.
- No off-pattern UI.

**AC4.** `openspec/specs/pipeline-cast-op/spec.md` has a real Purpose, and `grep -c TBD` returns 0.

**AC5.** The `CastPipelineRunSpec` GUARD drives `PipelineRunService.submit` with a stored `binary-ref`/`string-body` cast, and values pass through unchanged. It was green in my run. The executor's mutation red shows `Vector(null,null,null)`.

**(d) Impact of the convertformat writer change.**
- `decode` reads an absent `from`/`to` as `""`, so the typed value is unchanged.
- Runnable configs have non-empty `from`/`to`, so the writer output is byte-identical for them. Only drafts change shape.
- The frontend `pairKey` maps `undefined` to `""`, and its types treat `from`/`to` as optional.
- No JSON schema or openspec spec asserts that a `"from":""` is present.
- No consumer impact found.

**(e) Hygiene.**
- No inline FQNs in the diff (`java.util.UUID` is an import).
- No new `eslint-disable`.
- Commit bodies carry only the `Co-Authored-By` trailer: no claude.ai link and no `Claude-Session` trailer.
- No PR exists yet.

**Residue.** I deleted the probe pipeline `5471957c-2a24-4e87-89bc-f4c75d5933aa` and source `4f8501bc-d3b0-40de-84bf-5067f5da38e7` via the API (204). With 0 owned pipelines, sources and dashboards confirmed, I deleted user `29c4ab21-...` by exact id. I moved my `.playwright-mcp` files into `skeptic-final-1-playwright/`.

### Verdict: CONFIRM

### Non-blocking notes
- The disabled "(unsupported)" option sits at the bottom of a 10-item scrolling list. That is acceptable, because the trigger shows the stored value.
- The Purpose could mention that stored legacy targets pass through at run time. It is optional.
- `persist-evidence.sh` given an absolute path created a nested duplicate copy under `evidence/.concertino/runs/...`. The originals are cited above.
