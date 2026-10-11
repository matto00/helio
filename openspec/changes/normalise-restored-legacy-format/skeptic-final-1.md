## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed commit: 54dc271fccd5e95a4cc7d7f5af72fcdc58eab0c6. Diff base 6ac99447d07fd5bf5ee065b1141c1a31d0ea08a8, resolved live with
`resolve-review-base.sh` (main/origin, exit 0). origin/main has since moved to e56d94b10 (HEL-1459). Its files do not overlap this
diff, and the branch is re-synced at Delivery.

### What I verified (with evidence)

- **Spawn-cwd guard:** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=bug/normalise-restored-legacy-format/hel-1441`.

- **The V118 mirror matches the SQL.** I read `LegacyOutputFormat.scala` line by line against V118 section 3 (the DO block).
  - Scope: metric/collection with an object `format`.
  - decimals: valid only as a non-negative integral JSON number. `BigDecimal` equality treats 2 and 2.0 as equal. Invalid decimals count as absent, so they can still produce currency.
  - Trimming: `btrim` covers exactly space, tab, CR and LF. Text is a string only, and empty text counts as absent.
  - Format precedence: integer, then currency (trimmed prefix == "$" and decimals absent or 2), then number. The prefix is consumed only for currency.
  - Unit text: the parts [prefix unless consumed, unit, suffix] joined by single spaces. It is written only for metric, only when non-empty, and only when the live `unit` is absent or JSON null.
  - Composition: `normaliseRestored` applies V117 then V118, matching the order the migrations ran on stored data.
  - Every branch matches.

- **Only two restore sites exist.** I grepped `RestorePriorStored|insertInternal|LegacyOutputConfigKeys.|LegacyOutputFormat.` under `backend/src/main/scala` myself. The captured-config writes are:
  - `PatchSetUndoService.scala:301-303` (`restoreBoundOutputs`).
  - `OutputService.scala:203` (`RestorePriorStored` only). `PatchSetApplyRollback.scala:186` reaches this site.

  The other hits are not restore paths:
  - `OutputService.scala:148`: user-input create.
  - `PipelineCreateTransaction.scala:271`: request-driven create.
  - `PatchSetApplyForward`: forward writes that go through `ValidateWrite`.
  - Layout `RestorePriorStored`: dashboards, not Outputs.

  AC2's "nowhere under ValidateWrite" holds: the normalise sits inside an `if (policy == RestorePriorStored)` branch.

- **Gates at HEAD.** I ran this from the worktree's own `backend/` (both project-path lines name the worktree):
  `nice -n 19 sbt -batch -Dsbt.server.autostart=false -J-Xmx3g testOnly LegacyOutputFormatParitySpec LegacyOutputFormatSpec LegacyOutputConfigKeysParitySpec PatchSetUndoDeadOutputKeysSpec`.
  - Result: `Tests: succeeded 19, failed 0` and `[hel1468-guard] ScalaTest summary: failed=0 aborted=0 unreadable=0`.
  - Transcript: `.concertino/runs/HEL-1441/evidence/skeptic-final-1-sk-green.txt`.
  - For the full suite I rely on the evaluator's pasted `eval1-testFull.txt` (guard failed=0). I did not run a second `testFull` because four lanes are running.

- **My own mutations, chosen to differ from the executor's and evaluator's, all go red.**
  - Mutation A, run 1 (`skeptic-final-1-sk-mutA.txt`, exit 1, guard failed=3):
    - **Mirror:** I dropped `n.isWhole` from `validDecimals`. The parity spec went RED on the `decimals:1.5` + `$` rows (sql=currency, scala=number).
    - **Restore site:** I made `restoreBoundOutputs` call V118 only, without V117 first. Both end-to-end undo tests went RED:
      - `{"format":"number","metricUnit":"USD","unit":"/mo"}` instead of `{"format":"number","unit":"USD"}`.
      - The HEL-1409 dead-key row also failed.
  - Mutation B, run 2 (`skeptic-final-1-sk-mutB.txt`, exit 1, guard failed=3):
    - **Mirror:** I changed the live-unit check so that a JSON-null `unit` shadows. The parity spec went RED on `Some(null)` rows (sql wrote unit, scala kept null).
    - **Composition:** I swapped the order to V118 then V117 in `normaliseRestored`. Both the end-to-end undo test and the `RestorePriorStored` update test went RED (`unit:"/mo"` vs `"USD"`).
  - Both mutations were restored with `git checkout --` on the exact paths. `git status --short` afterwards shows only the evaluator's untracked `evaluation-1.md`.

- **Executor and evaluator transcripts I spot-checked.** All show the worktree project path and the `[hel1468-guard]` line.
  - `hel1441-1.1-red-unfixed.txt`: red first, failed=2. These are the two new restore tests, on unfixed call sites.
  - `hel1441-3.2-mutation-a2-strip.txt`: RED.
  - `hel1441-3.3-before-unhardened-mut{A,B}`: green (the mutations SURVIVED the old spec).
  - `hel1441-3.3-after-hardened-mut{A,B}`: RED.

  So the V117 hardening is what kills both mutation classes (AC4).

- **AC6 / item 3.**
  - `PipelineCreatePreflight.scala:205-206`: `validateOutputConfig` is exactly `OutputConfigValidation.validate(kind, config, JsObject.empty)`. It is called from `checkOutput` at :198, and `PipelineCreateTransaction` shares it.
  - `hel1441-1.2-item3-mutation-red.txt` (the executor's run) and the evaluator's independent run both show `OutputConfigKeyValidationSpec` "400 an unknown key and persist no pipeline" going RED with the link removed.
  - The diff contains no product change for item 3. The "already satisfied" conclusion holds.

- **ACs:**
  - **AC1 met.** The end-to-end test uses a real step-delete apply and undo (`PatchSetUndoDeadOutputKeysSpec`). It seeds through `insertInternal` and asserts beforehand that the object format is actually stored. It reads STORED configs, and it was red before the fix.
  - **AC2 met.** The update test passes under `RestorePriorStored`. The ValidateWrite control is a succeeding config patch that leaves the object `format` stored; the evaluator's mutation turned it red.
  - **AC3 met.** The parity spec has these properties:
    - It extracts the block verbatim from the classpath. The marker must occur exactly once, there must be exactly one `DO $$`, and the guard string must be present.
    - Its TEMP tables carry V118's CHECKs, and the spec asserts the tables resolve to `pg_temp`.
    - It enumerates decimals x prefix fully for both kinds, and adds 2400 seeded samples.
    - It requires every `unit_action`, approximation code and `new_format` to appear.
    - The Scala side is fed the jsonb round-trip text, and mutations turn it red.
  - **AC4 met.** The corpus gained the cross-enum nested values and non-string live values (number, true, {}, []). All JDBC resources now go through `Using.resource`.
  - **AC5 met.** The `collectionOptions.layout` and `chartAnnotation` rows are present.
  - **AC6 met** (above).
  - **No migration** in the diff.

- **Constraints:**
  - **C1 honoured.** The test uses a real apply and undo and checks stored configs.
  - **C2 honoured.** There are no migration files in the diff, and the change is read-time normalisation at the two sites.
  - **C3 honoured.** Every cited run carries `[hel1468-guard]`, and the new embedded-PG spec uses `VerifiedEmbeddedPostgres.start`. I found no inline FQNs in the diff.

- **UI:** none. The diff is backend plus openspec only, so step 4 is N/A.

- **Mtime evidence:** none of my conclusions rely on mtime or directory ordering. Every claim rests on transcript content.

### Verdict: CONFIRM

### Non-blocking notes
- `LegacyOutputFormatParitySpec.scala`, pg_temp loop: add `ns should have size 1` before `ns.head`, as the V117 spec does.
- `LegacyOutputFormatParitySpec.scala`: the `cfg(kind, ...)` parameter `kind` is unused.
- An equivalent-mutation note for future reviewers: swapping the integer/currency precedence is a no-op, because currency already requires decimals absent or 2. Do not use it as a discrimination probe.
