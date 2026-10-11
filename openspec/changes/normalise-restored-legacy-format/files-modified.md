- `backend/src/main/scala/com/helio/services/pipelines/LegacyOutputFormat.scala` — new pure Scala mirror of V118's mapping plus `normaliseRestored` (V117 then V118)
- `backend/src/main/scala/com/helio/services/patchsets/PatchSetUndoService.scala` — `restoreBoundOutputs` calls the composition (one call-site line + comment + import)
- `backend/src/main/scala/com/helio/services/pipelines/OutputService.scala` — `update` under `RestorePriorStored` calls the composition (one line + comment)
- `backend/src/test/scala/com/helio/services/pipelines/LegacyOutputFormatSpec.scala` — unit tests for the mirror
- `backend/src/test/scala/com/helio/services/pipelines/LegacyOutputFormatParitySpec.scala` — runs V118's section-3 DO block verbatim on TEMP tables, compares to the mirror
- `backend/src/test/scala/com/helio/services/pipelines/LegacyOutputConfigKeysParitySpec.scala` — V117 hardening: cross-enum nested values, non-string live values, closed JDBC resources
- `backend/src/test/scala/com/helio/services/patchsets/PatchSetUndoDeadOutputKeysSpec.scala` — real step-delete apply/undo over object-format Outputs (+ collection layout, chart annotation), RestorePriorStored update test, succeeding ValidateWrite control
- `openspec/changes/normalise-restored-legacy-format/**` — planning artifacts and this handoff

Captured-Output-config write-site re-grep (`LegacyOutputConfigKeys.normalise`, `insertInternal`, `RestorePriorStored` under backend/src/main/scala/com/helio/services): exactly two restore sites, both now covered: `PatchSetUndoService.restoreBoundOutputs` (insertInternal) and `OutputService.update` under `RestorePriorStored` (also reached by `PatchSetApplyRollback.scala:186`). `OutputService.scala:148` insertInternal is the user-input create path (not a captured config). The other `RestorePriorStored` hits are the layout policy. No third site.

Item 3: no product change; evidence `hel1441-1.2-item3-mutation-red.txt`.
