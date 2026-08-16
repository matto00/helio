# Tasks: insert-step-at-position

## 1. Backend — optional position on create

- [x] 1.1 `PipelineStepProtocol.scala`: add `position: Option[Int]` to `CreatePipelineStepRequest`, bump to `jsonFormat3`
- [x] 1.2 `PipelineStepRepository.scala`: add `insertAtInternal(pipelineId, kind, config, index)` — single transactional DBIO: read sorted steps, insert new row at index, renumber ALL positions 0..n (the `reorderInternal` idiom); leave `insertInternal` (append) untouched
- [x] 1.3 `PipelineService.addStep`: keep the entire existing validation/ACL chain verbatim; branch the final persist on `req.position` (None → `insertInternal`; Some(i) → validate `0 ≤ i ≤ count` else 422 → `insertAtInternal`)
- [x] 1.4 Add `schemas/create-pipeline-step-request.schema.json` (optional integer `position`, min 0; model on the reorder request schema) — keep `npm run check:schemas` green
- [x] 1.5 Backend tests in `PipelineStepRoutesSpec.scala`: insert at 0 / middle / count(=append-equivalent); absent position appends exactly as before; -1 and count+1 → 422 with nothing persisted; gap-healing (0,2,5 → contiguous after insert); positions persist across a re-GET; existing 400/404/ACL scenarios unaffected

## 2. Frontend — insert affordance + handler

- [x] 2.1 `pipelineService.ts`: `createPipelineStep` gains optional `position?: number` (omit from the payload when undefined — wire byte-identical for append)
- [x] 2.2 `PipelineDetailPage.tsx`: add `handleInsertStep(opType, index)` (optimistic splice at index → create with position → reconcile temp in place on success → keep temp + toast on failure); make `handleAddStep` delegate to it with `steps.length` (behavior-preserving consolidation); thread `onInsertStep` into `PipelineRiverView`
- [x] 2.3 `PipelineRiverView.tsx`: compact insert button per gap (before first card + between each pair; after-last stays the existing add row), `insertDropdownAt` local state, existing `OpDropdown` anchored at the gap button (one dropdown open at a time)
- [x] 2.4 Gap-button CSS in `PipelineDetailPage.css`, token-only per `DESIGN.md`; must not disturb the HEL-407 drop-indicator positioning

## 3. Tests

- [x] 3.1 Page tests: insert at 0 / middle renders optimistically at the right slot; service called with the right index; append path calls without position; failure keeps temp + toast
- [x] 3.2 RiverView tests: gap buttons render (count = steps; before-first included); clicking opens the dropdown at that gap; selection invokes `onInsertStep(op, index)`
- [x] 3.3 Refresh assertions: insert changes `stepsFingerprint` → debounced analyze dispatch; a step after the insert point gets a new `stepIndex` (open-preview refresh path, HEL-407 fingerprint)
- [x] 3.4 Record file growth + notes in `files-modified.md` (626/228 pre-change per the orchestrator's corrected line counts; HEL-682 owns splits)
- [x] 3.5 Run gates: backend `sbt test`; frontend `npm run lint` + `npm run format:check` + `npm test`; `npm run check:schemas` — all clean
