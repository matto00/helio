# HEL-1734: writers of source rows against a root-adding save (task 3.2)

Checked against `DataSourceRepository` (every `lockSource` call site: `appendRowsAction`, `replaceRows`, the refresh and
form-submit paths, the schema update), by reading each chain: none touches `pipelines`, `pipeline_roots`, `pipeline_steps`,
`outputs`, `panels` or `alert_rules` after taking the source row, so none takes any of (1)-(5) after (0).

| # | Writer | pool | lock sequence | Excluded vs the root-adding save by | race / deadlock spec |
|---|--------|------|---------------|--------------------------------------|----------------------|
| W40 | `DataSourceRepository.appendRows` / `replaceRows` / refresh / form submit / `updateSchema` (all through `lockSource`) | app (source owner) | source row `FOR UPDATE`, dataset rows write | the save's lock (0): `FOR KEY SHARE` on the same row | `DraftSaveRootsRaceSpec` "a dataset append racing a root-adding save": waits (both orders), no `40P01`; control without `SaveRootSources` observes no wait |
| W34 (amended) | `DataSourceRepository.delete` of a source the save adds | app | source row `FOR UPDATE`, then (1), (3) over rooted pipelines | (0) | `DraftSaveRootsRaceSpec` "a source delete racing a save that adds that source"; `DraftSaveDeadlockSpec` "a root-adding save against a source delete of a source the pipeline already roots" |
| W29 (amended) | `PipelineRootRepository.add` vs a root-removing save | app | source key-share, advisory, (3) | (3) | `DraftSaveRootsRaceSpec` "root add (standalone) vs a root-REMOVING save" |
| W30 (amended) | `removeRoot` vs a root-adding save | app | (1), (3), cascade | (3) | `DraftSaveRootsRaceSpec` "root remove (standalone) vs a root-ADDING save" |

A standalone root add against a root-ADDING save has no recordable violation control: both take the cycle advisory lock
before (3), so removing the writer's (3) leaves the advisory lock as the exclusion. It is covered by the protected run only.

Mutation record: `evidence/mutation-insert-at-final-position.log.txt` (the apply order of design D5 reverted to
insert-at-final-position: replace-the-only-root, remove-first-and-add and the undo restore of position 0 are red);
`evidence/race-and-deadlock-controls.log.txt` (every control in `DraftSaveRootsRaceSpec` and `DraftSaveDeadlockSpec` is a
test that passes only because the removed lock makes the race red).
