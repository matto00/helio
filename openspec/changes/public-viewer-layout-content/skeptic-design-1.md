## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed at HEAD 95cec30cf5d1028fdc4a04d0764fb7febc4aeb1c (planning artifacts only, no code diff yet).

### What I verified (with evidence)

- **Owner rulings are real.** The main checkout's `.concertino/runs/HEL-1587/events.jsonl` line 5 is `escalation.answered`
  with `answer_source: human`: Q1 `widen-panel-list`, Q2 `fold-in-read-only-form`. The Q2 question text said that rendering
  form fields publicly "would widen the API again", so the owner accepted a widening. The driver's list (label, type,
  control, required, options) matches D2 plus the already-public config.
- **D2's shape is not a material widening. I agree with it.** `PanelService.formSchema` (PanelService.scala:145) filters the
  declaration to `config.fields[].sourceField`. Those field names, labels, controls, options, `required` and `initialValue`
  already reach anonymous callers through `PanelResponse.fromDomain` on the panel list (PublicPanelListResolver). D2 adds only
  the declared `type` and dataset-level `required` for those names, and leaves out `default`. `FormFieldControl.tsx` reads
  `declared` for exactly two things: `isFieldRequired(field, declared)` and `declared?.type === "integer"` (step/inputMode).
  So D2 exposes what the preview needs and nothing more.
- **The RLS context exists but is under-specified for an anonymous caller.** Two facts:
  - `DataSourceService.ownerContext(sourceOwner, writer: AuthenticatedUser)` (DataSourceService.scala:1412) needs a
    `writer`, and an anonymous request has none.
  - `getDeclaredSchema` (DataSourceRepository.scala:1048) runs `ctx.withUserContext(user.id.value)`, which uses the app pool
    with RLS on (DbContext.scala:50).

  D2 says "or its anonymous-caller equivalent" and "the executor confirms which pool". That leaves the decision open on the
  one security-relevant read this change adds (see CR3).
- **D1 reads the dashboard on the privileged pool.** `DashboardRepository.findByIdInternal` (line 141) runs
  `withSystemContext`, which bypasses RLS. Its doc comment says "Do not use from routes or services", and DbContext requires an
  inline justification at every `withSystemContext` call site. D1 does not acknowledge either (see the non-blocking notes).
- **D3 does not match the signed-in grid as written (see CR1).**
  - `DesktopPanelGrid.tsx:213` passes `compactor={noCompactorPreventCollision}`.
  - The pattern D3 cites, `DesktopPanelGridSkeleton.tsx`, passes no compactor.
  - react-grid-layout 2.2.4 defaults to `verticalCompactor` (`frontend/node_modules/react-grid-layout/dist/chunk-LY5GT7Q2.mjs`:
    `compactor = verticalCompactor`).
  - `resolveDashboardLayout` step (c) deliberately returns stored layouts with their gaps intact ("gaps kept, never
    compacted", dashboardLayout.ts:131). The default compactor would push panels up on the public page, so they would not sit
    at their stored positions.
- **D3 cannot write a layout as the owner.** D3 builds a standalone `Responsive` grid and does not mount
  `PanelGrid`/`DesktopPanelGrid`. That keeps out `useLayoutSave`, `useGridLayoutInteraction`, the Redux layout-history
  dispatches and `useStoredLayoutRepair`. The renderers D4 reuses (`TextRenderer`, `MarkdownRenderer`, `ImageRenderer`,
  `DividerRenderer`) take only content props (PanelContent.tsx:256-259) and have no write path. This part is sound.
- **D3's acceptance signal is ambiguous at 1440 px (see CR2).** `PublicDashboardViewerPage.css` puts
  `padding: ... var(--space-4)` (16 px) on each side, and the breakpoints are container widths (`rglBreakpoints`, lg = 1440).
  A 1440 px viewport therefore gives a container of about 1408 px, which is **md**, not lg. Removing `max-width` does not
  change that. The spec scenario "lg layout ... at 1440 px" cannot pass as written.
- **D4 sanitising is shared code, not a copy.**
  - `ImagePanel.sanitizeImageUrl` (ImagePanel.tsx:20) rejects anything that is not http(s), including `data:`, so the planned
    hostile-URL expectation (empty state) matches existing behaviour.
  - Markdown goes through the lazy `MarkdownPanel`.
  - Uploaded images are served without auth, per the design's premise.
- **D5's disabled preview cannot fire a submit or a counter step.**
  - `Select`, `Toggle`, `FileField`, `TextField` and `Textarea` already accept `disabled`.
  - `CounterControl` already has `disabled`: it disables both `IconButton`s, guards `onKeyDown`, sets `tabIndex=-1` and
    `aria-disabled`.
  - `FormFieldControl` does not currently pass `disabled` to any of them. D5 adds and threads that prop.
  - With `immediate` unset, the counter's `handleStep` calls `onChange`, which D5 makes a no-op, never `onImmediateStep`.
  - D5 also rules out `submitForm`, `useCompactCounterSubmit` and a submit button, and plans a test that issues no `/submit`
    request. Sound.
- **Spec consistency is fine.** The existing `public-dashboard-panel-content` requirement "Public panel content is read-only"
  (it forbids form submit and layout affordances, including for an owner session) agrees with the ADDED requirements. There
  is no contradiction that would need a MODIFIED delta.
- **Pre-existing `config.dataSourceId` exposure:** I confirmed it is pre-existing. The panel list sends the full form config
  to anonymous callers today. Deferring it to follow-up triage is acceptable: D2 does not add the id, and the exposure is a
  UUID, not data. It should still be filed as a follow-up rather than only mentioned.
- **Coverage.** Every AC has tasks:
  - AC1 → 3.2 and 4.1
  - AC2 → 3.3
  - AC3 → 1.4 (hostile cases)
  - AC4 → 4.1
  - The driver's additions (no layout save or repair, hostile case, both themes, 375 px and desktop, HEL-1248 guard) → 1.3,
    1.4 and 4.1.

  I found no placeholders or TODOs, apart from the D2 "or equivalent" in CR3.

### Verdict: REFUTE

### Change Requests

1. **D3 (and tasks 3.2/4.1): match the signed-in grid's compaction.** State that `PublicPanelGrid` passes
   `compactor={noCompactor}`, imported from `react-grid-layout/core` exactly as `DesktopPanelGrid.tsx:32-34` does.
   `preventCollision` is optional because nothing moves. Do not copy the `DesktopPanelGridSkeleton` defaults, because
   react-grid-layout's default `verticalCompactor` removes the vertical gaps that `resolveDashboardLayout` keeps on purpose.
   Add a test with a stored layout that has a vertical gap (a panel at `y` greater than the bottom of the item above it) and
   assert it renders at its stored `y`, not pulled up. Optionally mirror `useProcessedWidth`, so the HEL-1413
   `--panel-grid-processed-width` wait works in the public e2e as well.
2. **Spec scenario "Two-column desktop layout" and task 4.1: make the breakpoint explicit.** Breakpoints are container
   widths. With the viewer's 16 px side padding, a 1440 px viewport resolves to md (container about 1408 px). Do one of the
   following, and keep the "matching the signed-in grid" claim about the active breakpoint's stored items, not the viewport:
   - name the breakpoint the e2e asserts (for example md at a 1440 px viewport, with the fixture's md layout two-column); or
   - choose a viewport whose container is at least 1440 px for an lg assertion; or
   - make the fixture two-column at both lg and md and assert the resolved breakpoint.

   Do not "fix" this by removing the page padding.
3. **D2: pin the anonymous read path. "Or its anonymous-caller equivalent" and "the executor confirms which pool" are open
   decisions on a security-relevant read.** Specify all three:
   - **Panel lookup:** the existing `findAllByDashboardId(DashboardId(dashboardId), userOpt, Page(0, Page.MaxLimit),
     accessAlreadyGranted = true)` and `.find(_.id.value == panelId)` pattern from
     `PublicPanelOutputResolver.resolvePanelOutput`. Not `PanelRepository.findByIdInternal`, which is privileged and
     documented as not for routes.
   - **Declaration read:** `dataSourceRepo.getDeclaredSchema(panel.config.dataSourceId, AuthenticatedUser(panel.ownerId))`,
     or `DataSourceService.ownerContext` with a named synthetic writer. That is the app pool via `withUserContext`; never
     `withSystemContext` or a `*Internal` read.
   - **Guard test:** add a spec case to task 1.2. A form panel whose `config.dataSourceId` names a dataset the form owner
     does NOT own returns the same `404`, and nothing of that dataset's declaration appears. That is the one way an anonymous
     caller of this route could read a stranger's schema.

### Non-blocking notes

- **D1 privileged dashboard read.** Using `DashboardRepository.findByIdInternal` from a route resolver goes against its own
  "Do not use from routes or services" doc and DbContext's rule that every `withSystemContext` caller carries an inline
  justification. Either add that justification at the call site and extend the method's documented-callers list (the bypass
  is defensible: the caller is already admitted by `authorizeResourceWithSharing`, and only `layout` is projected), or read
  the dashboard on the owner's context. The evaluator should check whichever is chosen.
- **D2 rate limiting.** "Nested in the general `/api` limiter" is literally true but misleading. Per CLAUDE.md (HEL-495 /
  HEL-837), the general limiter does not limit a request with no credential, so anonymous token viewers of this route are
  unlimited, like every other public panel route. Reword it, so nobody later believes the route is rate-limited.
- **D5 details to pin during execution:**
  - Render the preview without a `<form>` element, or with `onSubmit` doing `preventDefault`.
  - Decide what a bound field missing from the public declaration (orphaned) shows. `FormFieldControl` with
    `declared=undefined` renders a control with `required=false`. Mirroring the signed-in `issue` text is fine, as long as
    it is deliberate.
- **D3 card chrome.** "A card with the panel title and the panel body" should reuse the signed-in card's token set
  (`PanelCard` surface, border, radius, title typography) so the cells look like sibling screens. The final-gate visual
  review will compare against the running signed-in grid in both themes. Output panels inside fixed-height cells need the
  same overflow and flex behaviour `PanelCard` gives them.
- **Follow-up.** File the pre-existing public `config.dataSourceId` exposure as a real follow-up ticket at Delivery, not
  only a Risks bullet.
- **"Submit stays closed" scenario.** Pin the exact expected status (the unauthenticated response of the authenticated
  tree) so the assertion cannot pass on any non-2xx.
