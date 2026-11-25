## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD `e4da3c8d1bf8ae4511a5250079a2f5dc43706273` against base `95cec30cf` (live-resolved). The spawn-cwd guard
returned READY. Every gate below is my own fresh run. Lane constraints were followed: lane DB `helio_hel1587`,
`ANTHROPIC_API_KEY` empty, jest 3 workers, Playwright 2 workers, `sbt -J-Xmx3g`. My servers were stopped and my
throwaway user was deleted by exact id.

Evidence directory: `/home/matt/Development/helio/.concertino/runs/HEL-1587/evidence/.concertino/scratch/HEL-1587/`.
In this report, `<ev>` stands for that directory.

### Gates (fresh)

| Gate | Result |
| --- | --- |
| `npm run lint` | exit 0 |
| `npm run format:check` | exit 0 |
| `npm run typecheck` | exit 0 |
| `npm run check:schemas` | exit 0 |
| `npm test` | root: 76 suites / 683 tests passed; frontend: 951 suites / 11,072 tests passed |
| `npm --prefix frontend run build` | exit 0 |
| sbt shard 1: `com.helio.api.routes.dashboards.*`, `PublicPathRlsSmokeSpec`, `OutputHistoryQueryCountSpec`, `PanelServiceDefaultLayoutSpec` | 275 passed, guard `failed=0 aborted=0` |
| sbt shard 2: `com.helio.api.routes.panels.*`, `com.helio.infrastructure.persistence.sources.*`, `ApiRoutesSpec` | 513 passed |
| Playwright: `e2e/hel1587-public-viewer-layout.spec.ts` + `e2e/hel1744-insight-panel.spec.ts` (dev, 2 workers) | 7/7 passed |

Shard 1 includes `SharedDashboardPanelsSeamSpec`, the new `PublicLayoutAndFormSchemaRoutesSpec` and
`PublicFormSchemaRlsSpec`, and both HEL-1248 owner-id specs. It ran after the seam fixture edit and is green. That
settles the claim "the last green sbt run predates the seam fixture edit".

### Phase 1: Spec Review — PASS (with an evidence gap; see Phase 2 CR 3)

- **AC1 (layout per breakpoint, read-only, phone stack): met.**
  - Measured live on a seeded board:
    - A 1440 px viewport gives a container of 1408 px, which resolves md.
    - 1700 px resolves lg.
    - At 768 px the container is 736 px, which renders the stack.
  - Two-column placement matches the signed-in grid at md.
  - No drag or resize handles are visible: the `react-resizable-handle` spans are `display:none`.
  - No PATCH and no `layout/repair` request went out from the owner session on the public page.
- **AC2 (content panels through the shared renderers): met.**
  - Text, markdown, image and divider panels go through `PanelContent`.
  - Form panels are branched to `PublicFormPreview` before `PanelContent`.
- **AC3 (same sanitising, tested): met.**
  - The real renderer was checked live: `<script>` renders as text, the `javascript:` link gets `href=""`, `window.__pwned` is undefined, and a `javascript:` image URL shows the shared empty state.
  - The hostile image URL is covered in jest. Hostile markdown is covered only in e2e, because jest maps `react-markdown` to `src/test/reactMarkdownMock.tsx`, so jest's hostile-markdown assertions are vacuous. That is acceptable: the e2e uses the real renderer and passed in both themes. It is a guard on pre-existing shared code, not a red.
- **AC4 (output + markdown + image, two-column, e2e/component): met.** Covered by jest and e2e, both themes, 375 px and desktop.
- **Driver addition: the public API exposes only what the renderers need.**
  - Probed anonymously:
    - `layout` items are exactly `{panelId,x,y,w,h}`, and no `ownerId` appears anywhere in the panel-list body.
    - form-schema returns `{fields:[{name,required,type}]}`.
    - A non-form panel and a bad token each give 404.
    - An anonymous `POST /api/panels/:id/submit?token=` gives 401.
  - The submit route is untouched by this diff, so the 401 is pre-existing by construction. Not recording it on the pre-change tree is not a defect.
- **D3 key change (dashboardId:breakpoint → dashboardId) made after the design CONFIRM: accepted on its merits.**
  - The HEL-1835 loop needs ONE render that changes both `layouts` and the active breakpoint of a live instance (see `DesktopPanelGridSkeleton.tsx:55-59` and its test).
  - In `PublicPanelGrid`, `layouts` is memoised on `[layout, panels]`, which are stable page state. A width or breakpoint change therefore never comes with a new `layouts` reference.
  - The signed-in `DesktopPanelGrid` also has no breakpoint key.
  - Probed live: I loaded with md and lg stored empty and sm authored, at 900 px, so the instance went from the pre-measure 1280 px (md) to sm. I then swept 900 → 1700 → 900, plus 1440 → 1100 → 768 → 900 → 1700 → 1300 → 375 → 1440. There were zero console errors and zero warnings, and no "Maximum update depth".
  - The executor's rationale (a remount strands `useProcessedWidth`) is correct: RGL calls `onWidthChange` only when the width changes.
  - The design.md edit is recorded inline, which is fine.
- **CLAUDE.md edit: in scope.** CLAUDE.md is the repo's API-contract index, so documenting the widened route and the new one matches repo convention.
- **hel1744 e2e selector change: in scope and necessary.** At desktop width the public viewer now renders grid `section` cards instead of list rows. The spec passed in my run.
- **Phone stack in API order, not layout order: accepted.** The AC says "Phones keep the existing phone stack", and this is the existing order. Non-blocking follow-up candidate.
- **Scope creep: none.** Tasks.md is all ticked and matches the diff. `workflow-state.md` CONSTRAINTS is empty. Lane constraints C1-C14 were honoured as far as I can observe.

### Phase 2: Code Review — FAIL

Issues:

1. **Phone cold load mounts every panel body twice (measured regression).**
   - `PublicDashboardViewerPage.tsx` `PublicDashboardContent` calls `useContainerWidth()` with no options. react-grid-layout 2.2.4 starts at `initialWidth` 1280 and `measureBeforeMount: false`, and it measures in a passive effect. `mounted` is never read.
   - On a phone, the first commit therefore renders `PublicPanelGrid` at 1280 px (md). That mounts every `PublicPanelBody`, which fires the output rows and output-meta reads and the form-schema read. The next render swaps to the stack, which mounts every body again.
   - Measured on the same board and token (dev server, so StrictMode doubles everything; StrictMode is constant across both loads):
     - At 375 px: 4x each of rows, output-meta and form-schema.
     - At 1440 px: 2x each.
     - In production that means 2 data requests per panel body on every phone cold load, where the pre-change page made 1. There is also a one-commit md-grid frame on a phone.
   - Evidence: `<ev>/eval-1-phone-double-mount.txt`.
   - The jest harness mocks `useContainerWidth` to start at the target width, so nothing covers this path. The e2e reaches 375 px only by resizing from 1440, never by a cold load at 375.
2. **Dead CSS.** `frontend/src/features/dashboards/ui/PublicDashboardViewerPage.css:36` keeps `.public-dashboard-viewer__panel-kind`. After this diff no component renders that class (grep: CSS only).
3. **Red-first evidence is weaker than C12 and design D2 require.**
   - Both committed reds (`red-run-frontend.txt`, `red-run-backend.txt`) are compile/type reds. They show the new API shape did not exist; they do not show any new assertion failing for the right reason.
   - The recorded mutations (`mutation-evidence.txt`) cover noCompactor, disabled controls, the counter, the no-submit guard, backend mutation (b) (drop the owner predicate, ordinary harness → red), and "predicate dropped AND `withSystemContext`" under NOBYPASSRLS → red.
   - Missing:
     - (a) **The design-committed "RLS alone" proof** (design D2 / task 1.2): `PublicFormSchemaRlsSpec` run with ONLY the owner predicate removed (`withUserContext` kept), which must stay GREEN (404 from RLS alone). That run is not recorded. The only NOBYPASSRLS mutation recorded combined both changes.
     - (b) **Assertion-level reds for the core new behaviours**, each a one-line mutation of the shipped code:
       - Grid placement: force the stack branch in `PublicDashboardContent`, then run the grid-layout tests.
       - Content rendering: make `PublicPanelBody` return the old title+type for non-output kinds, then run the content test.
       - Backend layout filter: drop the `panelIds.contains` filter in `PublicPanelListResolver.storedLayoutFor`, then run the stale-ids case.
       - Form-schema projection: drop the bound-field filter in `PublicFormSchemaResolver`.
     - By inspection, each of these tests would fail on the pre-change tree once it compiled (no `[data-panel-id]` cells; the literal type name instead of `markdown-content`), so I do not doubt the tests. What is missing is the evidence that C12 asks for.
4. Imports in `PublicDashboardRoutes.scala:11-21` were added as a separate, unsorted group after the `scala.concurrent` block, between `com.helio.infrastructure...` and `scala...`. This is not a CONTRIBUTING [mechanical] violation (no inline FQN), only untidy. Non-blocking.

Checked and clean:
- No inline FQNs.
- New files are within the ~250-line budget (`PublicPanelBody` 152, `PublicPanelGrid` 108, `PublicFormPreview` 101).
- No `any` or casts beyond the documented `getBreakpointFromWidth` narrowing.
- No TODO/FIXME.
- `findByIdInternal` call site carries the DbContext justification, and its callers list is updated.
- `getDeclaredSchemaOwnedBy` runs on the app pool in the owner's context with an explicit `owner_id` predicate.
- The no-model-client and no-submit imports hold in the public form preview.
- `FormFieldControl.disabled` is threaded to every control branch, including `CounterControl`.

### Phase 3: UI Review — FAIL (one objective defect: CR 1; everything else observed passing)

Setup:
- Lane servers were started by me via `start-servers.sh` after the commit (backend PID started 12:58, commit 12:40). They were not reused.
- I seeded a board through the API with the following panels, plus a stored two-column layout, a share token and the owner session:
  - an output (table)
  - markdown with hostile parts
  - an image (`/orbit-mark.svg`, with caption)
  - an image with a `javascript:` URL
  - text
  - a divider
  - a form (text + required integer)

Results:
- **Happy path.** Every kind renders, at 375 / 768 / 1100 / 1300 / 1440 / 1700 px.
- **Form preview.** Inputs are disabled. There is no `<form>` and no submit control, and the "Read-only preview" caption is present.
- **Unhappy paths.** A hostile image URL shows the shared empty state. A non-form panel and a bad token on the form-schema route each give 404. The "Form preview unavailable" state is jest-covered.
- **Loading states.** The `PanelBodySkeleton` loading state was observed.
- **Console.** No console errors or warnings in any flow, including the breakpoint sweeps above.
- **Accessibility.** Grid cells are `section` elements with `aria-label` and an `h2` title. Form controls are labelled. Nothing new is focusable except the existing provenance trigger and table controls.
- **Breakpoints.** No layout breakage at 1440 / 1100 / 768 / 375.
- **Visual comparison against the running signed-in grid, both themes, 1440 px.**
  - Card surface, border, radius, title typography, two-column md geometry and table/markdown/image rendering match.
  - The public card has no footer, and the output's provenance trigger sits in its own row between the title and the table. The signed-in card has it in the footer with the kind/updated labels.
  - Whether that is cohesive is a [judgment] call I leave to the skeptic.
  - Screenshots:
    - `<ev>/eval-public-1440-dark.png`
    - `<ev>/eval-public-1440-light.png`
    - `<ev>/eval-signedin-1440-dark.png`
    - `<ev>/eval-signedin-1440-light.png`
    - `<ev>/eval-public-768-dark.png`
    - `<ev>/eval-public-375-light.png` (misnamed: it was captured while the theme was dark; 375 px light is covered by the e2e's own screenshots)
- **Phone cold load: FAIL.** See Phase 2 issue 1.

### Overall: FAIL

### Change Requests

1. **`frontend/src/features/dashboards/ui/PublicDashboardViewerPage.tsx` (`PublicDashboardContent`): render no panel bodies until the container has been measured.**
   - For example, use `useContainerWidth({ measureBeforeMount: true })` and render the stack or grid only when `mounted` is true. A `PageSuspenseFallback` or nothing is fine before that.
   - Alternatively, initialise from the wrapper's measured width in a layout effect. Either way, a phone cold load must never mount `PublicPanelGrid` at the 1280 px default.
   - Add a jest test whose `useContainerWidth` mock reproduces the real contract: first render at 1280 with `mounted: false` (when `measureBeforeMount` is set), then the measured width. Assert that a 375 px load calls `fetchPublicPanelRows` and `fetchPublicFormSchema` exactly once per panel. It must be red on the current code.
2. **`frontend/src/features/dashboards/ui/PublicDashboardViewerPage.css:36`: delete the now-unused `.public-dashboard-viewer__panel-kind` rule.**
3. **Record the missing mutation evidence in `mutation-evidence.txt`, with exact output, as C12 and design D2 require.**
   - (a) `PublicFormSchemaRlsSpec` with ONLY the `owner_id` predicate removed from `getDeclaredSchemaOwnedBy` (keep `withUserContext`). The expected result is GREEN, because RLS alone yields 404. If it goes red, that is a real finding to report, not to paper over.
   - (b) An assertion-level red for each of the following, each with the mutation named:
     - the grid branch (force the stack)
     - content rendering (revert non-output bodies to title+type)
     - `PublicPanelListResolver.storedLayoutFor`'s panel-id filter
     - `PublicFormSchemaResolver`'s bound-field filter
   - Restore the code after each mutation.

### Non-blocking Suggestions

- Phone stack order follows API order, not the xs layout order. Raise it through follow-up triage if the owner wants it to match the signed-in mobile stack.
- The shared `ImagePanel` empty state tells an anonymous viewer "Open panel settings to configure." Consider a read-only variant of that copy for the public viewer, as a follow-up.
- Label the jest hostile-markdown assertions as a guard. They run against the `react-markdown` mock and prove nothing about sanitising; the e2e is the real check.
- Tidy the import grouping in `PublicDashboardRoutes.scala`.
- Still owed from the design: file the pre-existing public `config.dataSourceId` exposure at Delivery, as committed.
