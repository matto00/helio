## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

Every claim below is derived from files I read in this worktree, not from the planning
narrative. Read: `ticket.md`, `proposal.md`, `design.md`, `tasks.md`,
`specs/mobile-dashboard-sheet/spec.md`, plus the ground truth each artifact depends on.

**Artifact mechanics**
- `openspec validate top-anchored-mobile-nav-sheet --strict` → `Change 'top-anchored-mobile-nav-sheet' is valid`.
  (Ran the main-repo copy of `next-report-number.sh`/`openspec`; the worktree's
  `scripts/concertino/` predates `next-report-number.sh` — see Non-blocking notes.)
- Line/word budgets vs `openspec/config.yaml`: design 112/150 OK, tasks 47/80 OK,
  proposal 49 lines OK but **385 words vs the "under 300 words" rule**.

**HEL-772 seam (D1) — CONFIRMED CORRECT**
- `frontend/src/theme/theme.css:118-134` — read the seam comment in full. It names HEL-773,
  forbids re-deriving `env(safe-area-inset-top)`, and forbids deriving from
  `--bottom-nav-height`. D1/D9 reproduce both prohibitions accurately.
- `theme.css:137-143` — the `max-width: 768px` override targets `:root` (56px), so
  `--app-top-chrome-height` genuinely recomputes at phone width.
- `frontend/src/app/App.css:60-75` — `.app-command-bar { height: var(--app-top-chrome-height);
  padding-top: var(--app-safe-top); border-bottom: 1px; z-index: 2 }` with global
  `box-sizing: border-box` (`theme.css:242`). So the bar's border-box bottom edge lands at
  exactly `--app-top-chrome-height` from the viewport top, and `App.tsx:154-156` makes
  `.app-command-bar` the first child of `.app-shell`. **D1's "anchoring at that token places
  the sheet's top edge exactly at the bar's bottom edge" is true.** AC2 is satisfiable by
  construction and task 6.2's forced-`--app-safe-top` probe will work (inline override on
  `documentElement` re-substitutes into the `calc()` declared on the same element).

**D5 — hooks called unconditionally: CONFIRMED SAFE (this was the specific question asked)**
- `useCreateDashboardAction.tsx:29-44` — `useAppDispatch` + two `useState`. No `useEffect`.
- `useAddSourceAction.tsx:20-31` — `useAppDispatch` only. No effect.
- `useCreatePipelineAction.tsx:21-33` — `useAppDispatch` only. No effect.
- **No mount side effects in any of the three.** Calling all three at the top of
  `usePickerSelection` and selecting by picker id is legal and inert.

**D6 / AC9 — fold-in mount hazard: CONFIRMED CORRECTLY BOUNDED**
This was the fold-in question. D6's structural argument holds under probing:
- `sections.ts:163-181` prefix-matches, so *any* `/sources*` path resolves `pickerId: "sources"`.
  But `AppRoutes.tsx:89` registers only `/sources`; every other `/sources*` path falls to
  `AppRoutes.tsx:127`'s `*` → `NotFoundPage`, which sits **outside** `AppShell`, so
  `MobileShell`/the sheet is not even mounted there. `SourcesPage.tsx:116` mounts
  `AddSourceModal`. Sheet reachable with `pickerId==="sources"` ⇒ `SourcesPage` mounted.
- Pipelines: `App.tsx:207` mounts `CreatePipelineModal` for every path **except exactly
  `"/pipelines"`**, and `PipelinesPage.tsx:105` mounts it there — so `/pipelines/:id`
  (also `pickerId: "pipelines"`) is covered. D6's "safe on both branches" is accurate.
- Dashboards: `dashboardsSlice.ts:281-284` — `createDashboard.fulfilled` sets
  `selectedDashboardId`, so the quick-create is not a silent no-op either.
- **HEL-782's D4b hazard is genuinely excluded by section scoping.** The fold-in is bounded.

**D7 — existing guard: CONFIRMED HONEST**
- `MobileNavSheet.test.tsx:84` is verbatim `it("renders no CRUD affordances — no add, delete,
  or actions-menu controls", …)`. Its matchers are `/add/i`, `/delete/i`, `/actions/i` — note
  "New dashboard" and "New pipeline" would pass it today; only "Add source" trips it.
  Narrowing rather than deleting is the right call and D7 states it accurately.

**DESIGN.md — read the current file, not recalled**
- HEL-774 opacity carve-out exists: `DESIGN.md:35-43` and `104-130` (bottom tab bar only,
  replaced by a measured contrast floor).
- Sanctioned `::after` hit-expander clause exists: `DESIGN.md:204-208`, and it is scoped to
  "a painted chrome control that must not visually grow". **D4's citation of it is accurate.**
- 44px floor: `DESIGN.md:198-203` — literal `44px` min-height/min-width for phone-reachable
  buttons/select triggers/CTAs. D4's "literal `44px`" is correct, not drift.
- Inline-style allowance (`DESIGN.md:63`) exists — the existing `panelStyle` drag transform
  in `MobileNavSheet.tsx:171-174` stays legitimate.
- §5 button recipes `DESIGN.md:~275-290`; §6 primitives `DESIGN.md:310-331`; §7 UI states
  `DESIGN.md:355-363` ("**Empty:** render `EmptyState` — never render nothing"; "**Error:**
  visible, human-readable, intent-error styled").

**Sibling surface (the consistency premise)**
- `SidebarItemList.tsx:260-289` renders `EmptyState variant="sidebar"` with
  `emptyIcon`/`emptyText`/`emptyDescription` and **arbitrates** `emptyCta ?? onAdd` so the
  header "+" and the empty-state CTA never both appear (HEL-548 D4a, comment at :261-263).
- `SidebarBody.tsx:128-130, 160-162, 197-199, 239-249, 333-335` supplies per-section
  empty-state copy and icons for all six sections.

### Verdict: REFUTE

The safe-area seam consumption (D1), the hook-call legality (D5), and the fold-in bounding
(D6/AC9) all survive adversarial checking — those are the parts I expected to break and they
don't. What fails is the create-action/empty-state interaction, which contradicts itself and
the spec, plus four smaller specific gaps. All six are cheap to fix in the artifacts.

### Change Requests

**1. D4 and D8 render the create action twice, contradicting the spec's "exactly one".**
D4 puts the create action in the sheet header unconditionally ("always visible without
scrolling a long list"); D8 renders the *same* action again as the `EmptyState` CTA when the
list is empty. Nothing in design.md or tasks.md arbitrates between them. On an empty section
that has a create action (e.g. a new account on `/pipelines`) the sheet renders two identical
"New pipeline" buttons — and two DESIGN.md §5 Primary-recipe buttons in one view, against
"One primary per view/section", since `EmptyState.tsx:102-110`'s `ui-empty-state__cta` is the
Primary recipe. This directly violates the delta's own text:
- `specs/mobile-dashboard-sheet/spec.md` MODIFIED "Bottom sheet dashboard picker": "it SHALL
  contain **exactly one** create affordance";
- scenario "Create is the only mutation affordance": "**WHEN** the sheet is open … exactly one
  create action is present" — no items-present qualifier;
- and the tasks self-collide: 5.2 asserts "exactly one create action" while 5.6 asserts the
  empty branch renders a CTA.

The desktop twin already solved this exact problem: `SidebarItemList.tsx:260-282` resolves
`emptyCta ?? onAdd` precisely so the persistent header "+" and the empty-state CTA are never
both rendered (HEL-548 D4a). Required: add an explicit arbitration decision to design.md
(suppress the header action while the empty branch renders its CTA, or the reverse), mirroring
`SidebarItemList`'s precedent; then make the spec scenarios and tasks 5.2/5.6 consistent with it.

**2. `EmptyState`'s three required props are unspecified, and the plan ignores the existing
per-section source of truth for them.**
`EmptyState.tsx:24-46` requires `icon`, `title`, and `description` — none optional. The sheet
today has only `emptyMessage?: string` (`MobileNavSheet.tsx:23-25`), fed from
`usePickerSelection`'s single-string `emptyMessage` ("No dashboards yet.", "No data sources
yet." — `usePickerSelection.ts:105,121,136,159,173,191`). Neither D8 nor task 4.1 says where
the icon, title, and description come from. That is a hole a competent implementer will fill
three different ways, and every way except one produces a visible inconsistency: the desktop
sidebar already renders **the identical primitive and variant** for the same six sections with
specific copy — `SidebarBody.tsx:128-130` ("Connect a data source" / `<Database/>` / "Pull in
data from PostgreSQL, MySQL, CSV, or static input."), `:160-162`, `:197-199`, `:239-241`,
`:333-335`. Shipping the phone sheet with "No data sources yet." and no description next to a
desktop sidebar reading "Connect a data source" + description is exactly the sibling-surface
divergence DESIGN.md §6/§7 exist to prevent. Required: design.md must name the source of all
three props per section (reuse `SidebarBody`'s strings/icons via a shared per-section table, or
`sections.ts`'s `SectionEntry.icon`), and the delta needs a scenario pinning phone/desktop
parity of the empty-state copy so it can't drift later.

**3. D2's clip wrapper invalidates D2's own z-index premise, and the stated fallback does not
work on a fixed panel.**
D2's entire argument is a z-index one, and I verified its inputs (`theme.css:81-82`
`--z-popover-scrim: 99` / `--z-popover: 100`; `App.css:74` `.app-command-bar { z-index: 2 }`).
But a computed `clip-path` other than `none` **creates a stacking context** on the wrapper, so
the panel's `z-index: var(--z-popover)` (`MobileNavSheet.css:30`) is re-scoped inside it and no
longer competes with anything outside. If the wrapper is left at `z-index: auto`, the sheet's
own backdrop at `--z-popover-scrim: 99` (`MobileNavSheet.css:5-8`) paints **over** the sheet.
Separately, the stated fallback — "an `overflow: hidden` wrapper with the shadow moved onto the
panel's inner edge" — silently does not clip at all: `overflow` clipping does not apply to a
`position: fixed` descendant, whose containing block is the viewport, and `overflow` alone
establishes no containing block. Required: design.md must state (a) that the wrapper carries
`--z-popover` and the panel's own z-index drops to a non-competing value, and (b) a fallback
that actually clips a fixed panel (e.g. make the panel non-fixed inside a fixed
`overflow: hidden` wrapper) — otherwise the escape hatch is illusory. Also state explicitly
that the panel's `top` still resolves against the viewport, so wrapper and panel must both
carry `top: var(--app-top-chrome-height)` (D2 implies this but doesn't say why it's required).

**4. AC5 (`prefers-reduced-motion`) has no runtime verification, and the wrapper introduces
exactly the cascade hazard the plan cites elsewhere.**
The only planned proof for AC5 is task 1.6 ("Confirm … `animation: none`") and task 5.3's
static text lock — both are "reading the CSS", which design.md's own Risks section forbids for
the tap floor and which HEL-535's inert-`@media` bug is cited for. Task group 6 has no
reduced-motion step at all. The hazard is concrete: the reduced-motion block sits at
`MobileNavSheet.css:54-59`, **before** the rules it must override, so a wrapper `animation`
declared later in the file at equal specificity wins and reduced motion silently stops working.
Required: add a §6 task that emulates `prefers-reduced-motion: reduce` on the running app and
asserts computed `animation-name: none` for **both** the panel and the new wrapper (or measures
the panel at its final rect on the first frame), and make task 1.6 explicitly require adding the
wrapper selector to the existing reduced-motion block rather than declaring a new one after it.

**5. The MODIFIED requirement keeps a name the change makes false.**
"Bottom sheet dashboard picker" will sit two requirements away from the ADDED "Sheet is
anchored to the top-chrome seam and descends from its trigger" in the same spec file, and its
own body no longer describes a bottom sheet. The capability Purpose is stale too:
`openspec/specs/mobile-dashboard-sheet/spec.md:4-7` still reads "bottom-sheet picker", and the
delta doesn't touch it. `openspec validate --strict` passes either way, so this is a semantic
call, not a tooling one — and the repo already has the rename convention with Reason/Migration
(`openspec/changes/archive/2026-08-15-single-assistant-entry-point-foldin/specs/nl-authoring-chat-surface/spec.md:1-40`).
Required: REMOVED "Bottom sheet dashboard picker" (with Reason/Migration) + ADDED under a
truthful name, and correct the stale "bottom-sheet" wording in the capability Purpose.

**6. D3 shrinks the drag target and specifies no minimum size.**
Today the pointer-tracked region is `.mobile-nav-sheet__drag-handle`, which wraps the grabber
*and* the title (`MobileNavSheet.tsx:193-202`; `MobileNavSheet.css:61-67` — `--space-2`
padding + 4px grabber + `--space-3` margin + the title line ≈ 44px of draggable strip). D3
narrows it to "wraps the grabber only", and the grabber is a 36×4px bar
(`MobileNavSheet.css:69-76`). Neither design.md nor tasks.md gives the new bottom strip a
minimum height, so the plan permits a ~12–24px drag target while AC4 requires drag-to-dismiss
to still work. Given this repo's six documented tap-target regressions, that must not be left
implicit. Required: specify a minimum height for the bottom drag strip in D3, and add it to
task 6.3's computed-measurement sweep alongside the rows and the create action.

### Non-blocking notes

- **D4's placement is the right call, but for a different reason than stated.** Header
  placement matches the desktop twin (`SidebarItemList` renders the "+" in its header —
  `SidebarItemList.tsx:48-49`), which is the real consistency argument. D4's stated rationale
  ("a control inside a `touch-action: none` region would have its tap swallowed") is circular:
  task 2.3 already requires excluding the action from that region, so it doesn't rule bottom
  placement out. Worth acknowledging the genuine cost — the top of a top-anchored sheet is the
  hardest place to reach one-handed on a 430px phone — and keeping header placement anyway.
- **D4 doesn't name a button recipe.** "the app's action treatment" is not one of DESIGN.md
  §5's four recipes (Primary / Secondary / Ghost / Danger, "match metrics exactly"). Name it —
  and note that whichever is chosen interacts with CR1 (the `EmptyState` CTA is Primary).
- **Task 3.5's "surface the hook's `error`/`isPending`" has no design counterpart.** design.md
  never says how. DESIGN.md §7 requires errors be "visible, human-readable, intent-error
  styled", and §6 lists `InlineError` as the shared primitive. Only `useCreateDashboardAction`
  can ever produce a non-null error (the other two are pure flag flips), so this is one
  treatment, not three — but it should be named.
- **`usePickerSelection` has three call sites**, not one: `CommandBar.tsx:72`,
  `MobileShell.tsx:18`, `App.tsx:62`. D5's three unconditional hook calls therefore run 3× per
  render at every viewport including desktop. Harmless (verified: no effects), but D5 reads as
  though it's a mobile-only, single-instance cost — worth a clarifying sentence so a later
  reader doesn't "optimize" it wrongly.
- **D9's blanket "no BottomNav token anywhere in the stylesheet", locked by task 5.3**, is
  wider than HEL-772's comment requires (that comment forbids deriving the *top-chrome seam*
  from bottom-nav geometry). It also forbids the natural way to keep the sheet clear of
  HEL-774's floating capsule. The 70dvh math happens to leave enough room, so this is fine as
  shipped — but consider scoping the lock to the sheet's anchor/offset geometry, or restating
  the constraint as deliberate so a future maintainer doesn't read it as an accident.
- **Phone/desktop create-action asymmetry is ticket-sanctioned but real.** The desktop sidebar
  offers a create action on six sections (`SidebarBody.tsx:131, 163, 200, 249, 336`); the sheet
  will offer one on three. `ticket.md`'s out-of-scope section explicitly authorizes this and
  D5's reasoning ("no hook exists, inventing one is scope") is sound — so not a change request.
  Worth a spinoff so the gap is tracked rather than forgotten.
- **Proposal is 385 words** against `openspec/config.yaml`'s "Keep under 300 words"; `tasks.md`
  uses `## N. Frontend — …` headings where the config asks for `### Frontend`. Cosmetic.
- **Environment note (not a blocker):** the worktree's `scripts/concertino/` contains only
  `assert-phase.sh`, `cleanup.sh`, `setup-worktree.sh`, `start-servers.sh` — it has no
  `next-report-number.sh`, `persist-evidence.sh`, or `emit-event.sh`. I used the main repo's
  copies (`/home/matt/Development/helio/scripts/concertino/`) against this worktree's change
  directory. The final gate will hit the same gap.
- Per instructions, I did **not** start dev servers and did **not** touch the shared MCP
  Playwright session. No code was modified; this report is the only file I wrote.
