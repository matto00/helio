## Skeptic Report — design gate (round 3, skeptic-design-3.md)

Reviewed cold at HEAD 95cec30cf5d1028fdc4a04d0764fb7febc4aeb1c. The planning artifacts are untracked under the change
dir. There is no code diff yet. I did not start a server, touch the DB or run tests. The spawn-cwd guard returned
`READY ambient=/home/matt/Development/helio branch=bug/public-viewer-layout-content/HEL-1587`.

### What I verified (with evidence)

**Round-2 CR1 (foreign-dataset guard provable in the harness that runs it) is resolved.** D2 and task 1.2 now commit
to both mechanisms, each with its own proof:

- **(b) Explicit owner predicate on the app-pool read.** It is proven in the ordinary BYPASSRLS harness by a
  drop-predicate mutation that turns red.
- **(a) The same case under `SET ROLE helio_app_test`.** It runs with the predicate mutated out and still returns
  `404`. A `withSystemContext` mutation turns it red.

I checked that (a) is feasible against the code:
- `DbContext(db, privilegedDb)` (`DbContext.scala:34`) takes separate app and privileged pools. A test can therefore
  give the app pool a NOBYPASSRLS role and keep the privileged pool as superuser.
- The panel lookup (`PanelRepository.findAllByDashboardId`, `withSystemContext`, around line 104) still resolves the
  panel in that setup.
- `getDeclaredSchema` (`DataSourceRepository.scala:1048-1052`, `withUserContext`) is the read that actually goes
  through RLS.
- `data_sources` has exactly one policy, `data_sources_owner` (V35:43). No later migration adds a sharing branch, so
  the owner context admits only the owner's own rows.
- The convention exists already: `PublicPathRlsSmokeSpec` and `UpsertTargetWritableRlsSpec`.

**Exposed shapes are minimal and match the driver constraints.**
- **Layout items.** They carry exactly `panelId,x,y,w,h`. That matches `DashboardLayoutItem` (`model.scala:207`) and
  `schemas/dashboards/dashboard-layout-item.schema.json` (`additionalProperties: false`). They are filtered to the
  response's panel ids, with no version, appearance, name or owner id.
- **Form schema.** It returns `name/type/required` only, with no `default`.
  - `FormFieldControl` reads `declared` only for `isFieldRequired` (line 77) and `declared?.type === "integer"`
    (line 193). Nothing beyond those three keys is needed.
  - `DatasetFieldResponse.default` is already optional (`dataSource.ts:297`), so the mapping needs no cast.
- **No source id, row cap, `seq` or rows** in either new response. The pre-existing public `config.dataSourceId`
  exposure is correctly scoped out and committed as a follow-up.

**The anonymous read path is pinned.**
- The panel lookup uses the `PublicPanelOutputResolver.resolvePanelOutput` pattern (`findAllByDashboardId(...,
  accessAlreadyGranted = true)` + `.find`) inside the same `authorizeResourceWithSharing` gate.
- The declarations are read in the form owner's context. `AuthenticatedUser(panel.ownerId)` compiles, because
  `source` and `tokenId` have defaults (`model.scala:33-37`).
- This mirrors the prod path `PanelService.formSchema` (`PanelService.scala:145-160`).

**D1's privileged layout read is justified.** `DashboardRepository.findByIdInternal` is documented "Do not use from
routes". D1 commits to an inline justification at the call site and an extended callers list, inside the
already-admitted gate, projecting only `layout`.

**The read-only grid matches signed-in placement and cannot write layout.**
- **Same compactor.** D3 uses `noCompactor` from `react-grid-layout/core`, the same compactor
  `DesktopPanelGrid.tsx:32-34,213` uses (minus `preventCollision`, which is irrelevant with nothing movable).
- **Same config.** It uses the same `resolveDashboardLayout` (`dashboardLayout.ts:142`), `createLayouts`,
  `rglBreakpoints`, `panelGridConfig.cols`, `gridMetrics(useDensity())` and `containerPadding`.
- **Same phone threshold.** The signed-in `PanelGrid.tsx:73` also branches on the container width
  `< panelGridConfig.breakpoints.sm`, so the public stack threshold is identical.
- **No write path is mounted.** It mounts none of `useLayoutSave`, `useGridLayoutInteraction`, the layout-history
  Redux hooks or the stored-layout repair (all live in `DesktopPanelGrid`). Drag and resize are disabled.
- **Tested.** Task 1.4 and the spec scenario assert zero `PATCH` and zero `layout/repair` requests.
- **Breakpoint arithmetic is correct.** md at a 1440 px viewport (container about 1408 px). jest covers lg, md, sm
  and the stack.

**The form preview cannot fire a submit or a counter step.**
- `PublicFormPreview` is branched before `PanelContent`, whose `isFormPanel` branch would mount the signed-in
  `FormRenderer` (`PanelContent.tsx:260-266`).
- The counter only calls `onImmediateStep` when `immediate` is true (`FormFieldControl.tsx:219-224`). The preview
  leaves `immediate` unset and makes `onChange` a no-op.
- There is no `<form>`, no submit button, no `useCompactCounterSubmit` and no `submitForm` import.
- Every control branch can actually take `disabled`:
  - `TextField` and `Textarea` are native.
  - `Select` (`Select.tsx:22`), `Toggle` (`Toggle.tsx:12`) and `FileField` (`FileField.tsx:12`) each already accept
    `disabled`.
  - `CounterControl` already accepts `disabled` and early-returns (`CounterControl.tsx:34,58`).
  - So the new prop only needs threading.
- Task 1.4 asserts no `/submit` request after every control is tried. The anonymous `POST /submit` status is pinned
  by value.

**The content panels use shared renderers.**
- `PanelContent.tsx:256-259` dispatches text, markdown, image and divider panels to the shared renderers.
- `ImageRenderer` → `ImagePanel` → `sanitizeImageUrl` (only `http:`/`https:`), so the sanitising is the same code.
- Hostile markdown and hostile image-URL tests are planned (task 1.4, spec "Hostile content is inert").
- The "reuses the authenticated rendering path" requirement allows a justified per-kind exception in design.md. D5's
  dispatch-order rationale is that justification for forms.

**Spec deltas are consistent.**
- The MODIFIED owner-id requirement reproduces the existing text and adds `layout` and `form-schema`.
- Both HEL-1248 specs exist (`PublicRouteOwnerIdLeakSpec.scala`, `PublicRouteOwnerIdLeakApiSpec.scala`), and task
  1.3 extends both.
- No panel-list schema exists today (`schemas/panels/` has none), so a new one is correct, not a missed
  modification.

**Every acceptance criterion traces to a testable task.**

| Requirement | Tasks |
| --- | --- |
| AC1 (layout per breakpoint, read-only, phone stack) | 1.4, 3.2, 4.1 |
| AC2 (content renderers) | 1.4, 3.3 |
| AC3 (same sanitising, tested, hostile cases) | 1.4 |
| AC4 (output + markdown + image, two-column) | 1.4, 4.1 |
| Driver: both themes at 375 px and desktop | 4.1 |
| Driver: no save or repair | 1.4, 4.1 |
| Driver: HEL-1248 guard | 1.3 |
| Driver: escalated widening | owner rulings Q1/Q2 recorded |

I found no placeholders, no TBDs and no contradictions between proposal, design, tasks and specs.

### Verdict: CONFIRM

### Non-blocking notes

- **Positive control under NOBYPASSRLS.** In the (a) harness, also assert that the form owner's OWN dataset returns
  `200` with its bound fields under `SET ROLE helio_app_test`. That is `PublicPathRlsSmokeSpec`'s owner-positive
  convention. It proves the app role can read `data_sources` at all, so the foreign-case `404` cannot be an artefact
  of a missing grant or a swallowed error. It also directly discharges the Risks bullet ("a local pass does not prove
  the owner-context read works under RLS").
- **`createLayouts` min rows.** The signed-in grid passes `panelMinRows(panel, h)` as `minRowsFor`
  (`DesktopPanelGrid.tsx`, the `layouts` memo), and form panels get `FORM_MIN_ROWS`. D3 calls `createLayouts`
  without it. Pass the same `minRowsFor` so a form cell's `minH` matches the signed-in grid.
- **Card visuals.** `PublicPanelGrid` builds its own card rather than `PanelCard`, which is justified because
  `PanelCard` carries edit affordances. The final gate will judge visual parity with the signed-in card in both
  themes against the running app.
- **Follow-up.** File the pre-existing public `config.dataSourceId` exposure at Delivery, as committed.
