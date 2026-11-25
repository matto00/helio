## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed at HEAD 95cec30cf5d1028fdc4a04d0764fb7febc4aeb1c. Only the planning artifacts exist; there is no code diff yet. I did not start a server, touch the DB or run tests.

### What I verified (with evidence)

**Round-1 CR1 (compaction) is resolved.**
- D3 now names `compactor={noCompactor}` from `react-grid-layout/core`.
- `DesktopPanelGrid.tsx:32` imports `noCompactor` from `react-grid-layout/core`, and line 213 uses `noCompactorPreventCollision`. The design matches the signed-in placement.
- Task 1.4 adds the vertical-gap test.
- `useProcessedWidth` exists at `frontend/src/features/panels/ui/grid/useProcessedWidth.ts:15`.

**Round-1 CR2 (breakpoint) is resolved, and the numbers check out.**
- `panelGridConfig.breakpoints` is lg 1440, md 1100, sm 768, xs 0 (`panelGridConfig.ts:35-41`).
- `rglBreakpoints` subtracts 0.001 to make each boundary inclusive.
- A 1440 px viewport minus 2 x `--space-4` gives a container of about 1408 px, which resolves to md. The spec scenario and task 4.1 now assert md at 1440 px and the stack at 375 px. The fixture is two-column at both lg and md.

**Round-1 CR3 (read path) is pinned, but its guard test is not runnable as designed (see CR1 below).**
- D2 now names the panel lookup (`findAllByDashboardId(..., accessAlreadyGranted = true)` plus `.find`).
- It also names the declaration read (`getDeclaredSchema(dataSourceId, AuthenticatedUser(panel.ownerId))`).
- `DataSourceRepository.scala:1048-1052`: `getDeclaredSchema` filters ONLY on `_.id === id.value` and runs `ctx.withUserContext`. It has no owner predicate, so the foreign-dataset denial rests entirely on the RLS policy `data_sources_owner` (`V35__rls_owner_only_tables.sql:43`, `owner_id = current_setting('app.current_user_id')`).
- `MISTAKES.md` ("RLS policies never run in dev or CI") says dev and CI connect as a superuser with BYPASSRLS.
- So in the default route-spec harness, the planned task 1.2 case ("dataset the form owner does not own → 404") returns the stranger's declaration even with a correct implementation of D2 as written.
- The repo has a NOBYPASSRLS harness (`UpsertTargetWritableRlsSpec.scala:26,60-61` and `Hel1661GranteeAnalyzeVerdictSpec.scala:75`: a `helio_app_test` role through `SET ROLE`).
- The existing `public-dashboards` requirement "RLS enforces tenant isolation on the public read path" demands exactly this kind of non-BYPASSRLS proof, including a "proves itself red" scenario.
- Neither design nor tasks say which harness the guard runs in, or whether an explicit owner predicate is added.

**The prod owner-context read already exists.**
- `PanelService.formSchema` (`PanelService.scala:145-160`) uses `getDeclaredSchema(..., DataSourceService.ownerContext(panel.ownerId, user))` and filters to the bound `sourceField`s.
- D2's projection (`name`/`type`/`required`, no `default`) is narrower than that route.
- `FormFieldControl.tsx` reads `declared` only for `isFieldRequired` (line 77) and `declared?.type === "integer"` (line 193). The exposed shape is what the preview needs and no more, which matches the driver's constraint list.

**The D1 layout read is now justified.**
- `DashboardRepository.findByIdInternal` (line 141) is documented "Do not use from routes or services".
- D1 now commits to an inline justification at the call site and to extending the method's documented-callers list, inside the existing `authorizeResourceWithSharing` block. Items are restricted to `panelId,x,y,w,h` and filtered to the response's ids. No owner id, version or appearance is exposed. This is acceptable.
- `PublicPanelListResolver.panelList` currently returns `PagedResult[PanelResponse]`, so a new top-level response type is needed (task 2.1). This is additive for the authenticated `fetchPanels`.

**The read-only grid cannot write layout.**
- D3 builds a standalone `Responsive`. It does not mount `DesktopPanelGrid`, which carries `useLayoutSave`, `useGridLayoutInteraction` and the Redux layout-history and repair hooks (`DesktopPanelGrid.tsx:165-192`).
- Drag and resize are disabled.
- A spec scenario and task 1.4 assert zero `PATCH` and zero `layout/repair` requests for an owner session.

**Content panels go through the shared renderers.**
- `PanelContent.tsx:256-259` dispatches text, markdown, image and divider panels to `TextRenderer`, `MarkdownRenderer`, `ImageRenderer` and `DividerRenderer`. These take content props only. The sanitising is the shared code.
- Hostile markdown and image-URL tests are planned (task 1.4, spec "Hostile content is inert").

**The form preview cannot submit.**
- `FormFieldControl` has no `disabled` prop today. Its issue branch renders a disabled `TextField` (lines 91-94). The counter calls `onImmediateStep` only when `immediate` is true (lines 220-221).
- D5 adds and threads `disabled` (the counter included), leaves `immediate` unset and makes `onChange` a no-op.
- D5 also rules out a `<form>` element, a submit button, `useCompactCounterSubmit` and any `submitForm` import.
- Task 1.4 and the spec assert that no `/submit` request is sent. The "Submit stays closed" status is pinned by value.

**Spec deltas are consistent.**
- The MODIFIED "Every public route response is free of the owner's user id" requirement reproduces the full existing text (`openspec/specs/public-dashboards/spec.md:198-215`), adding `layout` and `form-schema`. Both scenarios are kept.
- The ADDED requirements do not contradict "Public panel content is read-only" or "reuses the authenticated rendering path".

**Every AC traces to a task.**
- AC1 (layout per breakpoint, read-only, phone stack) → 1.4, 3.2, 4.1.
- AC2 (content renderers) → 1.4, 3.3.
- AC3 (same sanitising, tested) → 1.4 hostile cases, D4.
- AC4 (output + markdown + image two-column test) → 4.1.
- Driver additions (no save or repair, hostile case, both themes at 375 px and desktop, HEL-1248 guard, escalated widening) → 1.3, 1.4, 4.1, plus the recorded owner rulings.

**No placeholders.** No `TBD` or "or equivalent" wording remains.

### Verdict: REFUTE

### Change Requests

1. **D2 and task 1.2: make the foreign-dataset guard provable in the harness it will run in.** D2 says the form owner's RLS context "admits only a dataset the form owner can read". But `getDeclaredSchema` has no owner predicate (`DataSourceRepository.scala:1049`), and the default test harness is BYPASSRLS. So the task 1.2 case "dataset the form owner does not own → 404" can only behave one of two ways:
   - it is red against a correct implementation of D2 as written, which invites a weakened test or fixture; or
   - it is green only because of an owner filter the design never planned.

   Pick one of these and write it into D2 and task 1.2:
   - **(a)** Run that guard case under a NOBYPASSRLS app pool (`SET ROLE helio_app_test`, as `UpsertTargetWritableRlsSpec` does). Record a mutation that proves it red, such as reading with `withSystemContext` or with the wrong user id. This is the convention the existing "RLS enforces tenant isolation on the public read path" requirement sets.
   - **(b)** Add an explicit `owner_id = panel.ownerId` predicate to the public resolver's read, as defence in depth that holds under any role. Keep the app-pool read, and prove the predicate with a mutation in the ordinary harness.

   Either is acceptable, and both are better. What is not acceptable is leaving unstated which mechanism the test observes.

### Non-blocking notes

- **D4/D5 dispatch order.** `PanelContent` sends `form` panels to the signed-in `FormRenderer` (`PanelContent.tsx:260-265`), which has a submit path and fetches the authenticated `/api/panels/:id/form-schema`. The public viewer must branch to `PublicFormPreview` before it reaches `PanelContent`. The task 1.4 "no submit button / no `/submit`" assertion catches a slip, but state the branch order in the code comment.
- **Type for `declared`.** `FormFieldControl` takes `declared: DatasetFieldResponse`. The public shape has no `default`, so either confirm `default` is optional on that type or map the public type explicitly. Do not cast.
- **Card rhythm.** The signed-in grid sets `data-short-card` on min-height cells so chart canvas floors hold (`DesktopPanelGrid.tsx:143-151`). Mirror it in `PublicPanelGrid`, or accept a visible difference at the final gate.
- **lg coverage.** No e2e viewport reaches lg (1440 px resolves to md). A jest case in 1.4 that asserts lg placement at a container of at least 1440 px, and sm at 768-1099, would cover AC1's "each breakpoint" claim directly.
- **`useDensity` on the public route.** Confirm the density provider is mounted for anonymous viewers. Otherwise a token viewer gets the default density.
- **Follow-up.** File the pre-existing `config.dataSourceId` public exposure at Delivery, as the design already commits to.
