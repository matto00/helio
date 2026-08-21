## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Cold read. I re-derived the whole plan from the tree at `3d93e82a` (`git log --oneline -3`,
`git diff main...HEAD` empty — no code yet, as expected) rather than from round 1's report or
the handoff narrative. Where a claim was checkable I opened the file, ran the command, or
queried the dev database. `skeptic-design-1.md` was read as claims, not facts.

---

### What I verified (with evidence)

#### 1. Gates

```
$ openspec validate skeleton-loaders-list-detail-panel --strict
Change 'skeleton-loaders-list-detail-panel' is valid
EXIT=0
$ node scripts/check-openspec-hygiene.mjs
openspec/ is clean
EXIT=0
```

Both re-run twice; stable.

#### 2. The plan's factual grounding is again accurate where I sampled it

Independently confirmed, not inherited: `--app-transition: 0.16s ease` / `--transition-slow:
0.28s cubic-bezier(…)` (`theme.css:70-71`); the global reduced-motion block at
`theme.css:240-248` setting only `animation-duration: 0.01ms !important` (`:244`),
`animation-iteration-count: 1 !important` (`:245`), `transition-duration` (`:246`);
`grep -riE "skeleton|shimmer" frontend/src` → **0 hits**; `usePanelData.ts:240`;
`markDataTypeRowsStale` deleting the pagination entry (`panelsSlice.ts:94-101`);
`PanelContent.tsx:80-86`'s `Spinner xl` takeover; `PipelineDetailPage.tsx:627-634`;
`SourcesPage.tsx:53`; `PipelinesPage.tsx:35`; `TypeRegistryPage.tsx:12` (selector genuinely
lacks `items`) and `:24`; `SourceDetailPanel.tsx:44`/`:281`; `SuspenseFallback.tsx:4-9`;
`EmptyState.css:16` (`min-height: 320px`); `PanelGrid.css:31` (`height: 100%`);
`.dashboard-list__items` `gap: 2px` (`DashboardList.css:185`), `.dashboard-list__button`
`height: var(--control-md)` + `--app-radius-sm` (`:424-433`), `--stacked` at `:508-513`;
exactly **5** `<SidebarItemList>` call sites at 119/148/183/221/299 and exactly **one**
`subtitle:` producer at `SidebarBody.tsx:217` (D9 is right); `panelGridConfig` `rowHeight: 52`,
`margin: [18,18]`, `breakpoints.sm: 768`; `mobilePanelHeights.ts` metric `120`, chart
`clamp(200, w×0.62, 340)`, the rest intrinsic; `MobilePanelStack.css:5-13`'s `--space-3`
gap/padding.

#### 3. CR4c's cascade claim is correct

`theme.css:240-248` sets `animation-duration` and `animation-iteration-count` with `!important`
and never sets `animation-name`. A normal `animation-duration`/`iteration-count` declaration
therefore loses; `animation: none` (or `animation-name: none`) wins because that longhand is
unopposed. With the default `animation-fill-mode: none` the element reverts to its **base**
computed style after the 0.01ms run, so the artifact is the gradient at its base position — the
delta's reworded rationale (`specs/shared-skeleton/spec.md:43-55`) is now right.

#### 4. CR4a is genuinely verbatim, and nothing else drifted

I diffed both MODIFIED deltas requirement-by-requirement against `openspec/specs/`.
"Chart panel renders normally once its chunk loads" now reads "(same requirements as
`echarts-chart-panel`), with no console errors on mount or unmount" — character-identical to
`openspec/specs/frontend-code-splitting/spec.md:25-26`. The markdown twin matches `:46-47`.
Every other divergence in both deltas is a deliberate, disclosed consequence of D5/D6
(dropping "`Spinner`-based", dropping `"loading"` from the "Non-failed states" scenario's WHEN,
rewriting the box-metrics requirement that previously anchored to the removed loading state).
No silent narrowing remains.

#### 5. D11's central claim is TRUE — and it does not save D11

The requester asked me to attack "is `selectedDashboard.layout` populated while `state.panels`
is still fetching?". It is. `selectedDashboardId` starts `null` (`dashboardsSlice.ts:34-40` —
no hydration race) and is only ever set from `fetchDashboards.fulfilled` *after*
`state.items = action.payload` (`:241-256`), from a click in `DashboardList.tsx:334`, from
`usePickerSelection.ts:107`, or after a proposal apply. `App.tsx:123-129` fires `fetchPanels`
only on a non-null `selectedDashboardId`. So whenever panels are in flight, the dashboards
slice holds the selected dashboard. ✓

But the layout the skeleton would read is **not** the layout the grid renders. See CR1.

#### 6. D8 — I concur with round 1, on my own reading

The spinner D8 replaces is `PanelContent`'s *initial-load* branch: `usePanelData.ts:240` is
`isLoadingMore === true && rows.length === 0`. There is **no** refresh spinner today —
`isLoadingMore && rows.length > 0` renders nothing at all. So "don't replace refresh spinners
with skeletons" is honored in substance, the carve-out in
`specs/loading-state-pattern/spec.md:50-56` is narrow (one named path, one mechanism, one
scenario at `:66-70`, one test at task 6.5b), and it does not swallow the rule: the rule's own
scenarios at `:58-64` still bind every list surface. Honest, not a loophole.

---

### Verdict: REFUTE

Round 1's four CRs are, on their own terms, addressed — D11 exists, the D8 carve-out is honest
and narrow, task 1.2 exists, and the CR4 spec fixes are correct (CR4b excepted, see CR5 below,
where the fix is inert rather than wrong). The plan remains unusually well-grounded and its
self-approved calls remain defensible.

It fails this gate on a fresh read for a different reason: **D11 draws its geometry from the
wrong source.** The dashboard grid renders `resolveDashboardLayout(panels, layout)`, not
`layout`, and `layout` is empty on the majority of real dashboards — so as specified, the
flagship skeleton renders **zero cards** on most dashboards, which is simultaneously the
ticket's "never render nothing" violation and the worst possible outcome for the headline
no-layout-shift AC. Four smaller but individually actionable defects follow.

---

### Change Requests

**1. D11 reads the *saved* layout; both grids render the *resolved* layout — and the saved
   layout is empty on most dashboards, so the skeleton would render nothing.
   (`design.md` D11:111-134, `tasks.md` 2.6/2.8, `specs/loading-state-pattern/spec.md:110-141`)**

Three facts, each verified independently:

  a. **The real cards do not come from `layout`.** `DesktopPanelGrid.tsx:115` is
     `resolveDashboardLayout(panels, layout)` and `MobilePanelStack.tsx:46` is the same call.
     That function (`dashboardLayout.ts:168-252`) fills a fallback position for every panel
     missing from the saved array, projects entries between breakpoints when one is shorter
     than the panel set (`:152-166`, `:177-189`), and de-overlaps the result (`:113-132`).
     D11 never mentions it; it says the placeholders come from `selectedDashboard?.layout ??
     defaultDashboardLayout` positioned "through the same `panelGridConfig` the real grid
     uses". `panelGridConfig` supplies `rowHeight`/`margin` only — the *items* come from
     `resolveDashboardLayout`. Wherever `layout[bp]` does not already cover every panel
     exactly, skeleton and grid disagree on count and position.

  b. **`defaultDashboardLayout` is four empty arrays** (`dashboardLayout.ts:19-24`). So the
     fallback path D11 names by name yields **zero placeholder cards**.

  c. **Empty saved layouts are the common case, not an edge case.** `useLayoutSave.ts:51-52`
     seeds `persistedLayoutRef` with the client-*resolved* layout, and `persistLayout` early-
     returns when the latest layout equals it (`:76-78`). RGL's mount-time `onLayoutChange`
     therefore reports the same geometry it was handed, nothing is dispatched, and a
     client-generated fallback layout is **never written back** — a dashboard's saved layout
     stays empty until a real drag/resize changes geometry. The dev database confirms it:

     ```
     $ psql helio -c "select jsonb_array_length(layout->'lg') as lg, count(*)
                      from dashboards group by 1 order by 1;"
      lg | count
     ----+-------
       0 |    79      <-- {"lg": [], "md": [], "sm": [], "xs": []}
       1 |    12
       2 |     2
       3 |     8
       4 |     3
       6 |     1
     $ ... restricted to dashboards that actually have panels:
      with_panels=71  zero_layout_entries=45  fewer_entries_than_panels=9  fully_covered=17
     ```

     45 of the 71 dashboards that have panels would render **no placeholder at all**; 9 more
     would render too few.

Consequences: `specs/loading-state-pattern/spec.md:14-16` ("**THEN** panel-card-shaped skeleton
placeholders occupy the grid area") and `:119-121` ("one placeholder is rendered per layout
entry") are unsatisfiable on most dashboards; the ticket's "Never render nothing during load"
is violated on the one surface it was written for; and `:139-141` ("the number of cards … are
unchanged" on the phone stack) is false for the same reason.

Required: state in D11 (and mirror in the two spec requirements and tasks 2.6/2.8) what the
skeleton renders when `layout[activeBreakpoint]` is empty or shorter than the eventual panel
set — the count *cannot* be derived pre-fetch, so this needs the same bounded, stated
concession D11 already makes for the phone stack, not silence. Name `resolveDashboardLayout`
as the function whose output the skeleton is matching, so the executor does not match `layout`
and call it done.

**2. The pre-dispatch `"idle"` frame still flashes an empty state *before* the skeleton — the
   exact thing the ticket forbids. (`design.md` D4:66-71, `tasks.md` 2.2/2.4/4.1/4.2)**

Every gate in the plan is `status === "loading" && items.length === 0`. But these surfaces mount
at `status === "idle"` and dispatch their fetch from a mount `useEffect`, which React runs after
paint — so the first painted frame is the *empty* branch, and the skeleton arrives one commit
later:

- `SourcesPage.tsx:77` — `(sourcesStatus === "succeeded" || sourcesStatus === "idle")` renders
  the full `EmptyState variant="main"` "Connect a data source" hero. That is a ~331px hero
  flashing before the loading state on the very page whose inverse collapse this ticket
  inherited from HEL-539.
- `DashboardList.tsx:269` and `SidebarItemList.tsx:290` render their empty states at idle.
- `PanelList.tsx:224` renders "No dashboards yet" / "Select a dashboard" at idle with
  `selectedDashboardId === null`, i.e. on every cold boot of the main content pane.

Ticket, verbatim: "never flash empty content before the skeleton"; relay item 6: "Both are
findings." Decide it explicitly — either widen the initial-load predicate to "not yet resolved"
(`(status === "idle" || status === "loading") && items.length === 0`) or record why the idle
frame is acceptable. If you widen it, note the hazard that forces a per-surface decision rather
than a blanket one: `SidebarBody.tsx:78-101` dispatches only the *active* section's fetch, and
the chat section is skipped entirely on the free tier (`:87`), so an idle-inclusive gate would
park a permanent skeleton there.

**3. A dashboard switch — the flagship surface's main in-session load path — never shows the
   skeleton. (`design.md` D4, `tasks.md` 2.7)**

`fetchPanels.pending` (`panelsSlice.ts:102-106`) sets only `status`/`error`/`loadedDashboardId`;
`items` keeps the **previous dashboard's** panels. So on a switch the gate is false, no skeleton
renders, and the old panels keep rendering under the new dashboard's layout until the fetch
resolves (`resolveDashboardLayout` explicitly defends against exactly this disjoint-ids window,
`dashboardLayout.ts:218-226`). D4's rationale — "with items present a refetch keeps rendering
them" — conflates a refetch of the *same* list with a fetch of a *different* dashboard's list.
The practical effect is that the ticket's headline skeleton is only reachable on a cold app
boot, which also makes task 7.2's manual verification awkward to even trigger.

Decide and record: either widen the predicate (each `Panel` carries `dashboardId`,
`panel.ts:321`, so `items[0].dashboardId !== selectedDashboardId` is a clean, state-free
discriminator) or state that the stale-grid window is deliberately out of scope. Do not leave
it unaddressed — as written, the executor will ship a skeleton that almost never appears.

**4. `PanelSuspenseFallback` cannot render "the same panel skeleton", so D6's own invariant
   breaks. (`design.md` D6:79-86, `tasks.md` 3.2/3.3,
   `specs/frontend-code-splitting/spec.md:33-35`)**

Task 3.2 makes `PanelContent`'s skeleton "shaped to the panel's renderer type" — implementable,
since `PanelContent` receives `panel: Panel` (`PanelContent.tsx:29`). Task 3.3 then points
`PanelSuspenseFallback` at "the same panel skeleton", but that component takes **no props**
(`SuspenseFallback.tsx:10-17`) and has no way to learn the kind. Worse, the two fallbacks do not
occupy the same box: `ChartRenderer.tsx:41-55` renders it *nested inside*
`.panel-content--chart > .chart-panel__canvas` (with the annotation line still below it), while
`PanelContent`'s loading branch *replaces the entire body* with `.panel-content--state`.
Today the invariant holds only because both render the identical `Spinner xl` + "Loading…". A
kind-shaped body skeleton versus a generic nested one is visibly different — which is precisely
what D6 says it is preventing, and what the new scenario at `specs/frontend-code-splitting/
spec.md:33-35` ("**THEN** they present the same loading treatment") asserts.

Specify the mechanism: either `PanelSuspenseFallback` takes a kind/variant prop passed from
`ChartRenderer.tsx:44` and `MarkdownRenderer.tsx:27`, or the panel skeleton is kind-agnostic and
task 3.2's "shaped to the panel's renderer type" is dropped. Also say which box each fills.

**5. The `## Purpose` sections added to the two MODIFIED deltas are inert — round 1's CR4b is
   not actually resolved. (`specs/shared-status-message/spec.md:1-4`,
   `specs/frontend-code-splitting/spec.md:1-6`, `tasks.md`)**

I read the installed CLI (`/usr/lib/node_modules/@fission-ai/openspec/dist/core/specs-apply.js`).
`buildUpdatedSpec` runs `parseDeltaSpec`, which extracts only ADDED/MODIFIED/REMOVED/RENAMED
requirement blocks, and rebuilds the target as `[parts.before, parts.headerLine, reqBody,
parts.after]` where `parts` comes from **the existing base spec**. A delta's `## Purpose` is
never read. The four in-repo precedents round 1 cited (`archive/2026-08-17-add-totp-mfa`) are
all ADDED-only deltas for *new* capabilities — and even there the tool writes
`TBD - created by archiving change …` (`specs-apply.js:281`); those real Purpose lines were
hand-written afterwards.

So after archive, `openspec/specs/shared-status-message/spec.md:2` will still say the component
renders "a loading or failed status block" (false after D5) and
`openspec/specs/frontend-code-splitting/spec.md:4` will still say "behind a shared
`Spinner`-based `Suspense` fallback" (false after D6) — the exact defect CR4b was raised to fix.
Add an explicit task: at archive, rewrite both base specs' `## Purpose` to the delta's text.
(Keeping the Purpose in the deltas is fine as the source of that text; it just isn't self-
executing.)

**6. `DESIGN.md` §6's canonical-primitives list must gain `Skeleton`. (`tasks.md` 1.2)**

`DESIGN.md:227-248` enumerates every `shared/ui/` primitive — including "**Spinner** (the
border-spinner loading indicator)" — and closes with "Use these; do not hand-roll equivalents."
Task 1.2 updates §3's Motion bullet only. Shipping a new shared primitive that the binding list
does not mention is how the next ticket hand-rolls a second skeleton, which is precisely what
relay item 3 ("Extend, don't compete") exists to prevent. Extend task 1.2 (or add 1.2a) to add
`Skeleton` to §6 alongside `Spinner`, with the one-line skeleton-vs-spinner division.

---

### Non-blocking notes

1. **Round 1's note 2 was *not* folded in, contrary to the handoff.** `design.md:31-33` and
   `proposal.md:45` still say "the **three** … **classless** `aria-busy` divs". Ground truth:
   there are **four** — `features/dashboards/ui/ProposalReviewPage.tsx:204` (note the path is
   `dashboards/`, not `proposals/`), `features/pipelines/ui/PipelineProposalReviewPage.tsx:85`,
   `features/patchSets/ui/PatchSetReviewPage.tsx:171`,
   `features/proposals/ui/CombinedProposalReviewPage.tsx:83` — and all four carry class names
   (`proposal-review__loading`, `pipeline-proposal-review__loading`,
   `patch-set-review__loading`, `combined-proposal-review__loading`) with **zero** matching
   rules in any stylesheet (grepped repo-wide). The conclusion (they render nothing) holds; the
   stated reason does not. Excluding them is still defensible — but if this list seeds a
   follow-up, make it correct. Round 1's notes 1, 3, 4 and 5 *were* folded in correctly
   (verified: task 2.3's "five call sites", 7.1's "measure `/registry` … FIRST", 4.2's `items`
   addition, 4.3's `isRetryingPanels`).

2. **Decision numbering jumps D9 → D11.** `grep -n "D10"` over the whole change dir returns
   nothing. Either a D10 was dropped or it is a typo; a reader chasing the reference finds a
   hole.

3. **On the 158-line `design.md` (you asked):** I would not cut D11 — it is the most
   load-bearing decision in the document and CR1 above shows it needs *more* precision, not
   less. If you want the count back under 150, cut D2 instead: its cascade rationale is now
   restated nearly verbatim in `specs/shared-skeleton/spec.md:43-55`, so design.md can carry a
   one-line pointer. The cap is advisory; grounding is not.

4. **`SourceDetailPanel`'s preview has D11's problem in miniature.**
   `.ui-data-grid--preview` caps at `max-height: 320px` (`DataGrid.css:34-39`), so the resolved
   height is a predictable 320px only for a preview long enough to hit the cap — a 2-row REST
   preview is far shorter, and `loading-state-pattern`'s "the container's measured geometry is
   unchanged by the swap" (`:31-33`) is unqualified. Pick a documented skeleton height or state
   a bounded delta, as D11 does for the phone stack.

5. **`fetchPanels.rejected` sets `items = []` (`panelsSlice.ts:112-115`)**, so a retry after a
   failed panel load correctly reads as a first load and will render the skeleton. No action —
   noting it because it interacts with CR3's predicate if you change it.

6. **`findMediaBlock` will be copy-pasted into a seventh CSS test file** by task 6.2. Pre-
   existing, out of scope, still overdue as a shared helper.

7. **Environment note:** `scripts/concertino/` is partly gitignored, so this worktree carries
   only `assert-phase.sh`, `cleanup.sh`, `setup-worktree.sh`, `start-servers.sh` and the README.
   I ran the canonical `next-report-number.sh` / `persist-evidence.sh` from the main checkout
   against this worktree's change dir; they are path-parameterised, so the result is identical.
