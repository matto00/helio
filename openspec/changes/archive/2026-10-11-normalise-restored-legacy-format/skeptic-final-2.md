## Skeptic Report — final gate (round 2, skeptic-final-2.md)

Reviewed head: 59e89435f6bee2d7f8a6954afe115bd6ed7f9b0d (PR #949). Spawn-cwd guard: READY.

### What I verified (with evidence)
- **Base resolved live**: `resolve-review-base.sh` -> 5a0701f0a (merge-base, the merge commit's second parent). `git diff 5a0701f0a...HEAD` = 18 files, only HEL-1441's (3 main, 4 test, archive dir, synced spec). origin/main has since moved one commit (ec5139b56, HEL-1489: WindowStep + window specs); `git merge-tree HEAD origin/main` merges clean and touches none of these files.
- **Squash fidelity**: `git diff 54dc271fc c15aae8f7` = only evaluation-1.md + skeptic-final-1.md added; code byte-identical to what final r1 confirmed.
- **Archive**: `git diff c15aae8f7 88e5873b7` = pure renames into archive/, files-modified.md dropped (no other archive keeps one), `openspec/specs/patch-set-undo/spec.md` +27 lines. The synced requirement text equals the archived delta (only the `## ADDED Requirements` header differs).
- **HEL-1459 interaction**: e56d94b10 backend changes are PatchSetTargetKinds (new), PatchSetProtocol, AssistantProposalToolSchemas, RefinementEditShape — none touch `restoreBoundOutputs` or `OutputService.update`; the target-kind set is unchanged in value. HEL-1477 is retention/scheduler only. No interaction.
- **Mirror vs V118 SQL (read side by side)**: decimals validity (number, >=0, whole), btrim set (space/tab/CR/LF), first-match integer -> currency (`pre='$'` and dec NULL-or-2, invalid decimals treated as NULL) -> number, prefix consumed only for currency, parts order prefix/unit/suffix joined by one space, unit written only for metric with non-empty text and live unit absent/JSON null. All match.
- **Gates, fresh** (`nice -n 19 sbt -batch -J-Xmx3g`, MemAvailable ~51 GB): LegacyOutputFormatSpec, LegacyOutputFormatParitySpec, LegacyOutputConfigKeysParitySpec, PatchSetUndoDeadOutputKeysSpec, OutputConfigKeyValidationSpec -> 5 suites, 28 passed, 0 failed; `[hel1468-guard] ScalaTest summary: failed=0 aborted=0 unreadable=0`. Evidence: `.concertino/runs/HEL-1441/evidence/skeptic-final-2-green.txt`.
- **My own red (C1, AC1, AC3)**: mutated (a) the undo restore site back to V117-only normalisation and (b) the currency condition to `decimals.contains(2)`. Result: 3 failed — end-to-end undo test `{"format":{"decimals":2,"prefix":"$"}} was not equal to {"format":"currency"}` (STORED config after a real step-delete apply + undo), parity spec `metric-{"prefix":"$"}: sql=currency scala=number`, unit spec. Evidence: `skeptic-final-2-mut-undo-site-and-currency.txt`. Both files restored by exact path with `git checkout --`; worktree status afterwards shows only the untracked evaluation-2.md.
- **AC2**: OutputService.update normalises the merged config only under `RestorePriorStored`; the ValidateWrite control test asserts the object format survives untouched.
- **AC4**: V117 corpus gains `{"layout":"asc"|"desc"}`, `{"sort":"grid"|"list"}` and non-string live values (7, true, {}, []); all Statement/ResultSet/PreparedStatement go through `Using.resource`. The recorded mutation evidence (hel1441-3.3-*) shows red after hardening and green-survival before.
- **AC5**: `collectionOptions.layout` and `chartAnnotation` rows are in the end-to-end test, asserted as `layout`/`annotation`.
- **AC6**: `PipelineCreatePreflight.scala:206` calls `OutputConfigValidation.validate`; recorded mutation (hel1441-1.2-item3-mutation-red.txt) turns two OutputConfigKeyValidationSpec tests red (`expected BadRequest, got Right(PipelineSummaryResponse...)`). No product change, as the ticket states.
- **C2**: no migration file or stored-data change in the diff; normalisation happens at the two restore sites only.
- **C3**: the new parity spec uses `VerifiedEmbeddedPostgres.start`; there are no inline FQNs in added lines; the guard line is present in my run.
- **Session links**: there is no `claude.ai` URL or `Claude-Session` trailer in the commit messages for 5a0701f0a..HEAD or in the PR #949 body. The only grep hit is the phrase "session TEMP tables".

### Verdict: CONFIRM

### Non-blocking notes
- `LegacyOutputFormatParitySpec` checks `ns.head` for the pg_temp schema without the `should have size 1` that the hardened V117 spec has. This is cosmetic.
- The branch is one main commit behind (HEL-1489) and merges clean. This is not a blocker for review.
