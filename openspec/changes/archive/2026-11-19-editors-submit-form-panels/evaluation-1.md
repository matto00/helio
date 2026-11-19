## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed commit: `a775a7cfcefbff297c10fa1738a631b5377ed012` (one commit on `a1cfd19dc`, the live merge base with `origin/main` = `b2603ab79`).
Evidence directory (durable): `/home/matt/Development/helio/.concertino/runs/HEL-1784/evidence/.concertino/scratch/HEL-1784/` (the `eval-1-*` files below). All evidence here is content-based (test output, diffs, counts). None of it depends on mtimes.

### Phase 1: Spec Review — PASS
Issues: none blocking.

- AC "editor can submit; server admits; client shows control": `PanelService.submitForm` now authorizes via `authorizeEditorOnDashboard`, and `FormRenderer` gates on `useCanEditPanels()`. Proven by `FormSubmitEditorRoutesSpec`, `FormRenderer.roles.test.tsx` and e2e `hel1784…:197`/`:213`.
- AC "viewers and strangers refused; e2e covers editor, viewer and stranger": e2e `:247` (viewer: no control, direct POST 403) and `:262` (stranger: "Dashboard not found", POST 404, form-schema 404).
- AC "attribution": the audit actor is the writer, with `panelId` and `sourceOwnerId`. The debounce row stores the writer (V146). The run records `triggered_by_user_id = editor` and is admitted, rate-charged and cap-counted as the pipeline owner (`FormSubmitEditorRlsSpec`, `AutoRunDebounceWriterAttributionSpec`).
- AC "RLS checked as `helio_app`": `FormSubmitEditorRlsSpec` uses the two-role NOBYPASSRLS harness. My mutation confirms it is RLS-dependent (see (a)).
- AC "a test that fails first": `red-2.1` (15 red against the old code), `red-5.1`, and `red-6.1` (e2e, 2 red before the UI change).
- Owner rulings 1–3 (C15/C16/C17) are honoured. A non-owner counter makes no `/api/data-sources/*` request (jest plus the e2e request watcher). The form-schema route filters to the configured `sourceField`s. `seq` is omitted for a non-owner (`FormSubmitResponse.fromDomain`).
- C18: the two test-only edits to HEL-1780-scope files are declared in `files-modified.md` and justified (see (b)). C19: no stale string is left anywhere (see (h)).
- The diff matches the tasks and the design. The deviations are recorded as non-blocking suggestions 1 and 2.

### Phase 2: Code Review — PASS
Gates I ran myself on the reviewed commit:

| Gate | Result |
|---|---|
| `npm run lint` | clean (0 warnings) |
| `npm run format:check` | clean |
| `npm run typecheck` | clean |
| `npm test` (jest, 3 workers) | root 70/70 suites (617 tests); frontend 850/850 suites, **10125 passed, 0 failed** (`eval-1-jest.log`) |
| `npm --prefix frontend run build` | exit 0 |
| `nice -n 19 sbt -J-Xmx3g testFull` (single, unchunked) | **741 suites, 10047 succeeded, 0 failed, 5 canceled, 0 aborted**; hel1468 guard failed=0 aborted=0 unreadable=0; exit 0 (`eval-1-sbt-testFull.log`) |
| `check:scala-quality`, `check:schemas`, `check:openspec`, `check:spec-structure`, `check:e2e-types`, `check:e2e-user-cleanup`, `check:tokens`, `check:no-credential-leak`, `check:repo-integrity` | all clean |

I ran testFull with `run_in_background`, not as a 600 s foreground call. It took 19 minutes. One unchunked run settles the count question, and chunking is the cause of that question.

Issues: none blocking.

#### Orchestrator verification items

**(a) Red-first, stages 3 and 4: adequate. Stage 3 is a recorded process deviation, not a defect.**

- Stage 4. tasks.md 4.1 itself prescribes red-by-mutation. The executor's mutation (append in the editor's context) turned 3 tests red. I also needed to show the spec's RLS assertions are not vacuous, because `findByIdOwned` has an explicit `owner_id` filter.
  - I switched the spec's app pool from `SET ROLE helio_app_test` to `SET ROLE helio_privileged` (BYPASSRLS), in a throwaway worktree only.
  - Result: 2 red: "write nothing in the editor's own context" (the append wrote a row) and "nothing in the editor's [schema read]" (`eval-1-mutation-rls-bypass.log`).
  - `appendBuiltRowAction` and `getDeclaredSchema` filter only by `id` (`DataSourceRepository.scala:674,953`). Those assertions therefore genuinely depend on the V35/V106 policies.
- Stage 3. tasks.md 3.1/3.2 ordered "red, then implement", and the executor wrote the route first. That breaks C12's letter ("write tests before code in every stage"). For a brand-new route, a pre-implementation run is also weak evidence: an unmatched path already answers 404, so the stranger cases would have passed vacuously.
  - The executor's mutation (unfiltered schema, `red-3.1`) covers the C16 filtering and the fixture assertions only.
  - I covered the admission assertions myself. I replaced `formSchema`'s `authorizeEditorOnDashboard` with an unconditional `Right(())` in a throwaway worktree.
  - Result: 3 red: viewer 403, public-dashboard stranger 404, re-check after downgrade (`eval-1-mutation-formschema-noauth.log`).
  - So every FormSchemaRouteSpec assertion except the 400/404-deleted-source ones is shown failable. Those two are structurally obvious arms.
  - I am recording the ordering deviation as a non-blocking suggestion, not a change request. Re-running it now cannot reproduce a pre-code red, and the substance C12 protects (failable tests) is now demonstrated.

**(b) The C18 fixture edits: cause confirmed exactly, and nothing broader.**

- In a throwaway worktree at the reviewed commit, I reverted only those two files to `a1cfd19dc`. That revert removes just the `auth.currentUser` seeding.
- Result: 4 failures, exactly the 4 form-rendering tests (`eval-1-c18-reverted.log`).
  - `PanelContent.test.tsx` fails because the network guard catches `GET /api/panels/panel-1/form-schema`.
  - All three `PanelDetailModal — form panel` tests throw `fetchFormSchema is not a function` at `FormPanelView.tsx:122` (`panelService` is jest-mocked there).
- Both failures are the non-owner branch: no signed-in user, so `isFormOwner === false`. The edits only seed `currentUser.id = panel.ownerId` in the form-render helpers, so they are scoped to the form renders.
- Merge check: `git merge-tree` of this branch with current `main` (which includes HEL-1780, b2603ab79) is conflict-free. On the merged tree, `features/panels|features/dashboards` jest passed 329/329 suites, 3646 tests (`eval-1-jest-merged-main.log`).

**(c) Playwright, rerun on my own fresh servers.**

- Setup: backend and frontend started fresh by `start-servers.sh` at 03:05, after the 02:39 commit, so they were not reused. Lane DB `helio_hel1784`. `DATABASE_URL` and `DB_USER` exported for both the servers and Playwright, `ANTHROPIC_API_KEY` empty, 2 workers.
- The seven requested files (hel1784, hel1087, hel1088, hel1090, hel1095, hel1169, hel1773): **32 passed, 0 failed/flaky** (`eval-1-playwright.log`).
- The rest of task 7.1's glob (hel1080, hel1085, hel1094, hel1096): **8 passed** (`eval-1-playwright-extra.log`).
- Servers were stopped with `stop-servers.sh`; afterwards nothing was listening on 7216 or 10123.

**(d) sbt testFull.**

- My single run: 10047 succeeded, 0 failed, 5 canceled.
- The executor's single run was 10046 succeeded plus 1 failed. That is the same 10047 total, and the one failure was the pre-fix ExistenceNotLeaked pin.
- Its chunked total was 10032 succeeded plus 5 canceled, so the chunks missed about 15 tests (the four package patterns did not cover every suite).
- Superseded: the full, unchunked run is green.

**(e) The auto-run "counts against the owner" proof: adequate.**

- The concurrency cap and the in-flight count key on `pipelines.owner_id`, never on `triggered_by_user_id` (`PipelineRunRepository.ownerInFlightRealRunsQuery`, `:172-176`). The change cannot move that count to the editor.
- `countOwnerInFlightRealRunsInternal` would read 0 once the fired run is terminal, so asserting it after `tick()` would prove nothing.
- What the spec asserts instead:
  - one run with `triggered_by_user_id = editor`;
  - a rate-window row for the owner;
  - zero rate-window rows for the editor.
- Those three facts are the observable charge. They also catch the realistic regression: a firer that submits as the writer would be Forbidden (no pipeline grant, so no run), or, with a grant, would charge the editor's window.
- tasks.md 4.1 and design D7 still name `countOwnerInFlightRealRunsInternal`. Updating that wording is non-blocking suggestion 2.

**(f) files-modified.md: the premise is wrong; it is complete.**

- It lists `backend/src/test/scala/com/helio/api/http/ExistenceNotLeakedRoutesSpec.scala` at line 19 of its list.
- `comm` of its paths against `git diff --name-only a1cfd19dc...HEAD` is empty in both directions: 56 files in each, an exact match.

**(g) ExistenceNotLeakedRoutesSpec pin, PanelService Forbidden producers 5 -> 4: legitimate.**

- The pin counts lines with `ServiceError.Forbidden(` per file.
- At `a1cfd19dc`, `PanelService.scala:123` held the fifth producer, `Forbidden("Only this form's owner can submit to its data source")`. This change deletes it by design. The remaining four (`:175,252,309,347`) are the pre-existing ViewOnly producers.
- No new Forbidden producer was added. The new view-only refusal reuses `authorizeEditorOnDashboard:347`, which was already counted. The pin is not weakened.
- The archived `forbidden-classification.md` row for "`PanelService.submitForm` non-owner" is now historical. It sits in an archived change, so it is left as is.

**(h) Selectors and strings.**

- `grep` over `e2e/`, `frontend/src`, `backend/src`, `docs`, `CLAUDE.md` and `openspec/specs` finds no `Only the owner can submit` and no `Only this form's owner`.
- `Only editors can submit this form` appears only in the new spec, its jest test and the renderer.
- No e2e or client code reads `seq` from the submit response (grep `.seq` in `frontend/src` non-test: none; the form e2e specs: none).
- `form-schema` is referenced only by the new e2e spec.

#### Checklist
- Code quality (CONTRIBUTING [mechanical]): `check:scala-quality` is clean, with no inline FQNs. New files are within budget. `PanelService.scala` is at 350 lines and was already over the ~250 soft budget; this change adds about 26. `DataSourceService.scala` (1487) was already far over the budget. Both are soft warnings only.
- Design [mechanical]: there are no CSS or token changes. The viewer state reuses the existing `panel-content--state` and `panel-content__state-label` classes.
- DRY / modular: the masking lives in one function (`FormSubmitErrorMasking`), and it wraps both submit branches. The counter-shape rule reuses `FormSchemaConsistency`. `authorizeEditorOnDashboard` is reused.
- Security:
  - The non-owner error mapping depends only on the configured names; a byte-equal probe test proves this.
  - The row-limit number is withheld.
  - The owner-context write runs on the app pool (RLS evaluated), not the privileged pool.
  - A mismatched binding gets 404 and writes nothing.
- Error handling: `FormSubmitError.reason` is typed, never string-matched.
- Tests: they are meaningful and shown failable (see (a)).

### Phase 3: UI Review — PASS
Triggers matched (`frontend/**`, `schemas/**`). The checks were done through the live e2e runs on fresh servers:

- Happy path: an editor submits a form and a counter; both rows land on the owner's source.
- Unhappy paths:
  - a viewer gets the status text and no control, and a direct submit is 403;
  - a stranger gets "Dashboard not found";
  - an indeterminate failure or a definite rejection is announced or rolled back, covered by the jest non-owner suite.
- The editor page made no console errors and no `/api/data-sources/*` request (asserted by the hel1784 spec's watcher).
- Accessible names: the counter's spinbutton and its increase button, and the form landmark named by the panel title, are all used by role in the e2e.
- Breakpoints: I did not re-measure them separately. The diff changes no CSS, layout or markup structure. Editors get the same `FormPanelView` the owner already had, and the viewer status reuses the existing state markup. The hel1090 and hel1095 a11y specs that exercise this view passed.

### Overall: PASS

### Change Requests
None.

### Non-blocking Suggestions
1. C12 ordering. Stage 3's spec was written after the route (`red-3.1` is mutation-only). The admission assertions are now shown failable by my mutation, but the deviation should be named in the PR body so the audit trail is honest.
2. `tasks.md` 4.1 and `design.md` D7 (RLS bullet) say the run "is counted by `countOwnerInFlightRealRunsInternal(owner)`". The spec actually proves this through the owner's `pipeline_run_rate_window` row, plus the structurally owner-keyed cap query. Reword those lines to match the delivered proof.
3. `PipelineRunService.recordUnrunnable` gained `triggeredByUserId: Option[UserId] = None` (`PipelineRunService.scala:233`), but no caller passes it: the only production callers are `PipelineProposalService:608` and `PipelineSchedulerService:263`, and neither is an auto-run path. It is a design-mandated but currently dead parameter. Either drop it or note why it is kept.
4. Add a `GET /api/panels/{id}/form-schema` row to `ExistenceNotLeakedRoutesSpec`'s table, so the new route gets the same foreign-vs-absent byte-equality check as the submit row. Today only file-level coverage includes it.
5. Within a non-owner counter burst, "Couldn't confirm…" is announced only when the indeterminate click is the settle that empties the burst. An indeterminate click followed by a successful sibling is silent. This matches the owner path's settle semantics, and the spec scenario is single-click, so it is acceptable. It may be worth a line in the spec.
