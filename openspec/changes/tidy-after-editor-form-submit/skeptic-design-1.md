## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed HEAD 68255cf79b0077b9b37ae7a35433ca7faad58bc1 (worktree = main, change dir untracked).

### What I verified (with evidence)

**(1) Dropping `triggeredByUserId` from `recordUnrunnable` loses no attribution. Sound.**
- `PipelineRunService.scala:213-229`: the parameter is only read as `Some(triggeredByUserId.getOrElse(user.id).value)`.
- Production callers (grep across `src/main/scala`): only two, and neither passes it.
  - `PipelineProposalService.scala:608` calls `recordUnrunnable(pipelineId, reason, user)`. This is proposal-apply on a pipeline the applying user just created, so the acting user is the triggerer.
  - `PipelineSchedulerService.scala:263` is the scheduled config-gate skip, called with `owner` and `TriggerSource.Scheduled`. The sibling scheduled `submit` (`:253`) also records the owner. `PipelineRunEditorPersistenceSpec` "...and a scheduled run" pins that as `Some(owner.id.value)`. Dropping the parameter keeps the skip consistent with the scheduled run.
- The only distinct-triggerer path (the V146 use case) is `PipelineAutoRunDebounceFirer.scala:122`. It goes `submit(..., owner, TriggerSource.AutoRun, triggeredByUserId = writer)`. The firer never calls `recordUnrunnable`, and it has no config gate that would route there.
- Tests: `recordUnrunnable` is only called positionally (`PipelineRunEditorPersistenceSpec.scala:411`, `PipelineRunServiceSpec.scala:924`), and nothing overrides it. Removing the parameter is compile-safe.
- D1 mutation (store `None`): the test at `PipelineRunEditorPersistenceSpec.scala:409-413` asserts `Vector(Some(owner.id.value))`, so the mutation turns it red. The guard can fail.

**(2) The new ExistenceNotLeakedRoutesSpec row: owner control holds, but mutation (a) is wrong.**
- The route exists: `PanelRoutes.scala:143`, `path(PanelIdSegment / "form-schema")` with `get`, which calls `panelService.formSchema(panelId, user)`.
- `PanelService.scala:143-158`: `findById(panelId, Some(user))`. `None` returns 404 `"Panel not found"`, and a non-form panel returns 400.
- Owner control: `seedOwned()` inserts the panel with `kind = 'text'` (spec ~line 132). The owner therefore reaches the `case Some(_)` arm and gets 400, which is neither 404 nor 403. `ownerControl = true` is correct.
- Completeness guards: `PanelService.scala` is already named in `sites` by other rows, and the row adds no new Forbidden producer. Both guards stay green.
- **Defect, see CR1.** D3(a) says the leak mutation is "look the panel up unfiltered (`panelRepo.findById(panelId, None)`)". That call is not unfiltered.
  - `PanelRepository.scala:145-183`: with `callerOpt = None`, the owner and grantee predicates are `LiteralColumn(false)`. Only `publicPred` (a public-viewer grant on the dashboard) can match.
  - `seedOwned()` inserts no `resource_permissions` row, so the foreign panel resolves to `None` and returns 404 `"Panel not found"`. That is byte-identical to the nonexistent arm, so the row stays green under this mutation. Task 1.2 requires it red, and it cannot go red.
  - The actual unfiltered lookup is `panelRepo.findByIdInternal(panelId)` (`PanelRepository.scala:130`). Under that mutation the foreign text panel returns 400 and the absent id returns 404, so the row goes red.
- D3(b) (the `None` arm returns 403) does go red: the foreign arm fails `shouldBe 404`. It also adds a `ServiceError.Forbidden(` to `PanelService.scala`, so the pinned producer count (4 to 5) goes red too. That is harmless, but the transcript should say which failure belongs to the new row.

**(3) The archived wording edit is factual.**
- Archived `design.md:237` and `tasks.md:37` name `countOwnerInFlightRealRunsInternal(owner)`; grep confirms only those two lines outside evaluation-1.md.
- `FormSubmitEditorRlsSpec.scala:205-221` ("store the editor on the debounce row and fire the run as the owner, recorded for the editor") actually asserts:
  - one run `(Some(editor), auto_run)`;
  - an owner `pipeline_run_rate_window` row count > 0;
  - an editor row count = 0.
- `evaluation-1.md:74-80` and `:134` say the same, and say why the in-flight count would read 0 after the run. The D4 rewording matches ground truth.

**AC coverage:**
- AC1 is covered by D1 and tasks 1.3/3.1.
- AC2 is covered by D2/D3 and tasks 1.1/1.2, apart from CR1.
- AC3 is covered by D4 and task 2.1.
- No scope drift. No contract or schema change is needed (behavior is unchanged), so `skip_specs` is justified.

### Verdict: REFUTE

### Change Requests

1. **design.md D3(a) and tasks.md 1.2: replace the mutation with one that actually leaks.** `panelRepo.findById(panelId, None)` is the anonymous/public-only lookup (`PanelRepository.scala:165-167, 170-178`), not an unfiltered one. Against `seedOwned()`'s non-public dashboard it returns `None`, the row stays green, and task 1.2's "show the row red (a)" cannot be satisfied. Name `panelRepo.findByIdInternal(panelId)` (`PanelRepository.scala:130`) as mutation (a): the foreign text panel then answers 400 against an absent id's 404. Fix the "unfiltered" description to match. Optionally, also have D3 say that mutation (b) additionally trips the `expectedForbiddenProducers` pin (PanelService 4 to 5), so the transcript names the new row's failure separately from the pin's.

### Non-blocking notes
- D4 could also mention, in one clause, the structurally owner-keyed cap query (`ownerInFlightRealRunsQuery`), as evaluation-1 does. Optional.
- tasks.md 3.2 has a wildcard (`PipelineSchedulerService*Spec`, `PipelineProposal*Spec`). The executor should list the concrete files it ran.
