# HEL-1722 mutation proofs

Each mutation edits ONE resolver-side call in `backend/src/main/scala/com/helio/services/patchsets/`, then
`sbt "testOnly com.helio.services.patchsets.PatchSetPreviewWriteParitySpec"` runs the full file (57 tests; 57 green unmutated).
The file is restored (`git checkout -- src/main`) after each run. Script: `.concertino/scratch/HEL-1722/mutate.py` (main checkout).

| # | Mutation | Result | Entries that turned red |
|---|---|---|---|
| M1 | `PatchSetPipelineStepResolvers.resolvePipelineStepCreate`: `checkAdd(...)` replaced by a constant `Right` | 19 red | every [step create] rejection entry (unknown type, raw config, decode, unknown pipeline, stranger, viewer, secondary source, three lane entries, two upsert entries, five placement entries, rejectIfReparents) and the same-set "DIFFERENT pipeline" entry |
| M2 | `resolvePipelineStepUpdate`: `checkUpdate(...)` replaced by a bare step lookup | 11 red | every [step update] rejection entry (unknown step, stranger, viewer, type change, raw config, secondary source, lane missing/self/ancestor/dependent, upsert) |
| M3 | `resolveDataSourceCreate`: `validateStatic(...)` replaced by `Right` | 6 red | [dataSource create] blank name, row cap, bad column type, bad default, invalid row, required column null |
| M4 | `resolveDataSourceUpdate`: `validateUpdate(...)` replaced by `Right` | 2 red | [dataSource update] blank name, blank name on an unowned source |
| M5 | `resolvePipelineCreate`: the roots-only `rootSchemas()` call (D5) replaced by `Right(())` | 5 red | [pipeline create (roots only)] static bad row, static over row cap, static bad column type, sql not a read, rest connectorId+url |
| M6 | `resolveAll`: the same-pipeline guard dropped (`touched` never grows, so every step edit runs the graph checks) | 2 red | same-set "two creates at position N then N+1" and "drop D's lane then give T a lane to D" (apply now refuses sets it accepted) |
| M7 | `resolvePipelineStepCreate`: graph checks always `Skip` (the graph-dependent half removed) | 10 red | the three step-create lane entries, five placement entries, rejectIfReparents, and the "DIFFERENT pipeline" same-set entry |

Logs: `.concertino/scratch/HEL-1722/mut-M*.log` (main checkout).
