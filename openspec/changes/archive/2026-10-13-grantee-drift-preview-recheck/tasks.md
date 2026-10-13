## Standing Constraints

- [C1] (retired at design round 2, superseded by C2) Preview revoke/delete seams act after the LAST ACL read inside previewAtNode; every new test case is shown red on unchanged main and recorded in red-run.md
- [C2] Preview revoke/delete seams act after the LAST ACL read inside previewAtNode; defect cases (a),(d),(e),(f) are shown red on unchanged main, guards (b),(g) are shown failable by mutations M2/M5, (c) is a labelled pin; all recorded in red-run.md

## 1. Red first

- [x] 1.1 Write `Hel1516GranteeDriftPreviewSpec` (design D4 cases a-g) and run it on unchanged code; record red output for (a),(d),(e),(f) in red-run.md

### Backend

## 2. Drift read as the owner sees it

- [x] 2.1 Add `PipelineRepository.findLastSourceSchemaInternal(id)` (D1), doc + `withSystemContext:` justification
- [x] 2.2 `PipelineAnalyzeReads`: baseline via `findLastSourceSchemaInternal`; drift current schema via `findByIdOwnedByInternal(primaryDsId, pipeline.ownerId)` (D2); rest of the response unchanged
- [x] 2.3 Update `findLastSourceSchema`'s doc so it no longer claims analyze as its caller

## 3. Preview re-check

- [x] 3.1 Add `PipelineRepository.checkPreviewAccessInternal(id, user, requireEditor)` returning `RunAuthorization` (D3)
- [x] 3.2 `PipelineRunPreview.previewAtNode`: call it immediately before each `backend.execute` (source arm `false`, step arm `closureHasEnabledAiStep`), replacing `authorizedForAi`; map NotAuthorized -> 403, PipelineGone -> 404
- [x] 3.2a `previewAtNode` empty-roots branch: `findByIdInternal` existence check, None -> 404, Some -> existing 422 (D3, A3)
- [x] 3.2c Add `previewAtNode`'s empty-roots branch to `findByIdInternal`'s privileged-caller doc list
- [x] 3.2b Cross-reference docs between `checkPreviewAccessInternal` and `PipelineRunRepository.submitterMayRunAction`
- [x] 3.3 Update `ExistenceNotLeakedRoutesSpec.expectedForbiddenProducers` for `PipelineRunPreview.scala` to the real count and rewrite the classification comment at :519-520

### Tests

## 4. Verification

- [x] 4.1 Re-run the new spec green; run mutations M1, M2, M3, M4a, M4b, M5, each red then restored; record in red-run.md
- [x] 4.2 Run the suites listed in design D4 (targeted, foreground, nice -n 19, capped workers); record results honestly
- [x] 4.3 Run lint/format/scala quality gates via the commit hook; list full paths in files-modified.md
