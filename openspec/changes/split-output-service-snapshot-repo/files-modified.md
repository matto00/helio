- `backend/src/main/scala/com/helio/infrastructure/persistence/pipelines/NodeSnapshotFilterSql.scala` — NEW (D4): the 8 pure SQL-fragment builders moved verbatim from `NodeSnapshotRepository`
- `backend/src/main/scala/com/helio/infrastructure/persistence/pipelines/NodeSnapshotRepository.scala` — builders removed (458 -> 352 lines); one member import; public API and `nodeFilterFragment` untouched
- `backend/src/main/scala/com/helio/infrastructure/persistence/pipelines/README.md` — Holds line mentions `NodeSnapshotFilterSql`
- `backend/src/main/scala/com/helio/services/pipelines/OutputRowReads.scala` — NEW (D1): `rows`/`filterCapabilities`/`distinctValues`/`materializedFor` moved verbatim
- `backend/src/main/scala/com/helio/services/pipelines/OutputRootResolution.scala` — NEW (D2): create-time root anchoring moved verbatim
- `backend/src/main/scala/com/helio/services/pipelines/OutputConfigValidation.scala` — receives `validateFieldMapping`/`validateConfig`/`mergeConfig` (D3) + 2-line header amendment + imports
- `backend/src/main/scala/com/helio/services/pipelines/OutputService.scala` — 503 -> 330 lines; delegations to the two new classes, companion reduced to same-signature forwarders
- `backend/src/main/scala/com/helio/services/pipelines/README.md` — paragraph after line 11 (line 5 `Holds:` untouched, C5)
- `scripts/check-node-root-encoding.mjs` — `NodeSnapshotFilterSql.scala` added to `TARGET_FILES` (no exemption change)

Zero diff under `backend/src/test`. Evidence: `move-evidence.md`, `api-evidence.md`, `mutation-evidence.md`, `test-count-evidence.md`, tools/raw data under `move-check/`.

## Follow-up candidates (found during the move; NOT fixed — C3)

1. Sizes: `OutputService.scala` ends at 330 lines and `NodeSnapshotRepository.scala` at 352 (still over the 250 soft budget; accepted in the design — remainder is pinned constructor docs, the `create` Forbidden producer, `update`/`delete`/`assertionStatus`, and the repo's persistence methods + companion types that cannot leave the file).
2. `OutputConfigValidation.validateFieldMapping` throws `IllegalStateException("OutputService: no OutputBindingSpec for kind ...")` — message still names `OutputService` though thrown from `OutputConfigValidation` (kept verbatim, C3).
3. Moved docs keep now-cross-file references verbatim: `OutputRootResolution.resolveExplicitRootId`'s doc says "`requireUnambiguousRootWhenNeither` runs BEFORE this (see `create`)" — `create` is now on `OutputService`.
4. `NodeSnapshotRepository.overwriteRows` carries two stacked scaladoc blocks (the first, "Atomically replace the snapshot…", is detached by the second) — pre-existing; and `listRows`'s inline comment says `explicitRootId` is "Defaulted to `None`" but it has no default (pre-existing, stale since HEL-913 5.8b-iv-a).
5. `OutputService.scala` imports `NodeRef` and never uses it (pre-existing; left alone because the move did not make it unused).
6. Compiler anonymous-class renames from the byte-identical move (`OutputService$$anonfun$1/2` -> `OutputConfigValidation$$anonfun$3/4`; `NodeSnapshotRepository$$anonfun$1` gone) — see api-evidence.md §2: the design's "no `$$` added" wording needed a disclosed carve-out for anonymous-function CLASSES.
7. Design/process note: design D5b(d) lists per-suite counts to record; a baseline run from a copy of the sources outside the repo tree fails ~12 tests that read `../schemas` / `shared-test-fixtures` (first attempt, discarded); the valid baseline is from a `git archive` of the full base tree.
8. Pre-existing wrong doc statements (moved verbatim, C3; all contradict `resolveExplicitRootId`'s actual 400 for an explicit `rootId` when `pipelineRootRepo == null`): "degrades identically" in the `resolveExplicitRootId` doc, "matching ... degrade contract" in the `requireUnambiguousRootWhenNeither` doc, and `OutputService.scala`'s constructor comment on `pipelineRootRepo` ("falls back to the pipeline's auto-resolved first root").
9. Test gap (evaluator M1): the HEL-1027 D6 LIKE-escape test at `OutputRoutesSpec.scala:931-942` stays green when the `%` escape is removed from `escapeLikeTerm`.
