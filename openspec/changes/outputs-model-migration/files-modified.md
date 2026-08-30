# Files modified (this cycle, cycle 20)

- `backend/src/main/resources/db/migration/V94__outputs_model.sql` — folded the
  `pipelines.output_data_type_id` nullable-relaxation (previously a separate V95 file, which
  violated design.md decision 2's single-migration-file rule) into V94 as a new numbered section
  15/16.
- `backend/src/main/resources/db/migration/V95__pipelines_output_data_type_id_nullable.sql` —
  deleted (content folded into V94 above; neither file had been applied to any persisted DB).
- `backend/src/main/scala/com/helio/infrastructure/persistence/pipelines/PipelineRepository.scala`
  — doc-comment references to "V95" corrected to "V94" now that the migration is folded.
- `backend/src/main/scala/com/helio/app/DemoData.scala` — task 3.7: reseeds a real
  Source → Pipeline → three Outputs chain instead of four placeholder unbound `OutputPanel`s; all
  four demo panels now carry a real, non-empty `outputId` (two panels share the third Output).
- `backend/src/main/scala/com/helio/app/Main.scala` — wires `OutputRepository` into
  `DemoData.seedIfEmpty`'s new signature (also passes `dataSourceRepo`/`pipelineRepo`, already
  constructed).
- `openspec/changes/outputs-model-migration/tasks.md` — corrected stale `[ ]` checkboxes for
  3.6/3.9/3.10/3.10a (verified against the live tree: all four were actually completed at commit
  `fb7593d9`) to `[x]`; marked 3.7 `[x]`; corrected the 3.5 note's "V95" reference to "V94".
