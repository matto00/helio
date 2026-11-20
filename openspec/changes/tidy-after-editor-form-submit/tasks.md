## Standing Constraints

## 1. Backend

### Backend

- [x] 1.1 Add the `GET panel form-schema` row to `ExistenceNotLeakedRoutesSpec` (design D2); run the full spec green.
- [x] 1.2 Show the row red by mutation in `PanelService.formSchema` (design D3: a = `findByIdInternal`, b = `None` -> 403), naming the failing row; revert;
  record transcripts in `.concertino/scratch/HEL-1787/` and a red summary in `.concertino/runs/HEL-1787/evidence/`;
  commit the red record before 1.3.
- [x] 1.3 Remove `triggeredByUserId` from `PipelineRunService.recordUnrunnable`; `insertRun` stores
  `Some(user.id.value)`; fix the scaladoc mention if any.

## 2. Docs

### Docs

- [x] 2.1 Reword archived HEL-1784 `design.md:237` and `tasks.md:37` per design D4.

## 3. Tests

### Tests

- [x] 3.1 Mutation for 1.3: make `recordUnrunnable` store `None`; show `PipelineRunEditorPersistenceSpec` unrunnable
  test red; revert; record.
- [x] 3.2 Run full spec files: `ExistenceNotLeakedRoutesSpec`, `PipelineRunEditorPersistenceSpec`,
  `PipelineRunServiceSpec`, `FormSubmitEditorRlsSpec`, plus every other spec file calling `recordUnrunnable` or
  `PipelineSchedulerService` (list the concrete file names run); compile clean.
