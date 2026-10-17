# 3.2 Mutations re-applied on the FINAL tree (new fixture), all three race specs per run

Each run: mutation applied to production source under the sbtfull flock, `testOnly DraftSaveDeadlockSpec DraftSaveRaceSpec DraftSaveSetRaceSpec`
(168 tests), same load profile as the 50/50 runs (nice 19, taskset 0,1, group concurrency 2, 4g), tree restored afterwards with `git checkout`
(`git status` afterwards shows only the fixture and docs). `*.diff` = the applied mutation, `*.log.txt` = filtered log, full logs in
`.concertino/runs/HEL-1654/evidence/mutations/`. Original recordings: HEL-1629 `evidence/mutations`, `evidence/cycle3`, and
`.concertino/runs/HEL-1629/evidence/.../skeptic-final*`.

| Mutation | What | Expected red | Observed on the new fixture | Original recording |
| --- | --- | --- | --- | --- |
| M4 | fingerprint read moved above `lockDefinition` (DraftSaveTransaction) | DraftSaveRaceSpec "writer-first: be excluded..." (lost update; needs the writer-first oracle) | 19 of 168 red, all "writer-first: be excluded from the save's window" | 19 red |
| M5 | step delete uses the pre-lock place of the promoted head child (PipelineStepRepository:1092) | DraftSaveRaceSpec "save-first" of the moved-step writer | 1 red: "save-first: be excluded from the save's window" | 1 red |
| M6 | step delete retries once only (`MaxDeleteAttempts = 1`) | DraftSaveRaceSpec "save-first" of the grown-subtree writer | 1 red: "save-first: be excluded from the save's window" | 1 red |
| M7 | step delete AND root remove take the pipeline row before the panels (`StepDeletePanelsFirst`/`RootRemovePanelsFirst` branches inverted) | DraftSaveDeadlockSpec: the protected and control cases of both pairs | 4 red: step delete protected+control, root remove protected+control | 4 red |
| SK1 | V137 `hel1629_lock_pipelines`: `FOR NO KEY UPDATE` -> `FOR KEY SHARE` | DraftSaveRaceSpec writer-first/save-first (pipeline-row writers) + a Deadlock case + the mix | 39 red: 17 writer-first, 17 save-first, "Output delete ... takes the pipeline row first", "never raise 40P01", ... | 39 (count in log) |
| SK3 | step delete takes the pipeline row before the panels (current-tree form: operands of the active branch swapped; the HEL-1629 form no longer applies, the code was restructured by F2) | DraftSaveDeadlockSpec "step delete: not deadlock: the delete locks the panels before the pipeline row" | 1 red: exactly that case | green when first recorded, before F2's new cases; M7 is its follow-up |
| SK5 | `lockRules`: `FOR UPDATE` -> `FOR KEY SHARE` | DraftSaveRaceSpec writer-first+save-first of the alert-rule writer; DraftSaveDeadlockSpec alert evaluator protected+control | 4 red: race writer-first, race save-first, evaluator protected, evaluator control | 4 red |
| (SK3 first attempt) | the HEL-1629-era text replacement did not apply to the restructured code; the run was therefore UNMUTATED | n/a | 168/168 green: kept as `SK3-noop-attempt.*` in the durable dir, NOT counted as evidence | |

M1-M3 (DraftSaveFaultSpec, DraftSaveApiSpec, DraftSaveRlsSpec) do not use `DraftRaceFixture`; they are not affected by this change and were not re-run
individually (they run in the full `testFull`). SK2 was a one-off probe spec (`SkepticProbeStaleStepDeleteSpec`), not part of the tree.
The in-spec LockSite controls (the "control" / "deadlock when ..." cases in all three specs: panel-first, Output delete, step delete, root remove, evaluator,
snapshot position, rewrite advisory, teardown, and the per-writer `protectedBy` removals in DraftSaveRaceSpec/DraftSaveSetRaceSpec) each remove ONE lock and
must be red by design; they are green, i.e. red-as-expected, in every one of the 50 + 15 runs above.
