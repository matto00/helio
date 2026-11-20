# Red record: GET panel form-schema row (ExistenceNotLeakedRoutesSpec)

Run: `nice -n 19 sbt -J-Xmx3g -batch -Dsbt.server.autostart=false "testOnly com.helio.api.http.ExistenceNotLeakedRoutesSpec"`
from this worktree's `backend/` (project-path lines name this worktree). Transcripts: `.concertino/scratch/HEL-1787/{1-green,2a-red,2b-red}.log`.

- Baseline with the new row, no mutation: `Tests: succeeded 67, failed 0` (exit 0).
- Mutation (a), `PanelService.formSchema` line 144 `panelRepo.findById(panelId, Some(user))` -> `panelRepo.findByIdInternal(panelId)`:
  exit 1, `Tests: succeeded 66, failed 1`. Failing: `should get an identical 404 for a foreign and a nonexistent id: GET panel form-schema`. Nothing else.
- Mutation (b), the `None` branch `NotFound("Panel not found")` -> `ServiceError.Forbidden("nope")`:
  exit 1, `Tests: succeeded 65, failed 2`. Failing: the same new row, AND separately
  `should pin the per-file count of ServiceError.Forbidden producers so none ships unclassified` (the producer pin, 4 -> 5).
- Both mutations reverted (`git checkout`); the diff holds only the spec row.
