## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

**Setup's two "discoveries" — both CONFIRMED, independently.**

1. The four HEL-548 seams exist with the claimed shape. `features/dashboards/hooks/useCreateDashboardAction.tsx`,
   `features/sources/hooks/useAddSourceAction.tsx`, `features/pipelines/hooks/useCreatePipelineAction.tsx`,
   `features/panels/hooks/useCreatePanelAction.tsx` — each exports `CreateActionResult { cta: EmptyStateCta;
   error: string | null; isPending: boolean }`; the panel seam computes `disabled = selectedDashboardId === null`
   and no-ops `onClick` when disabled (read in full). Consuming them as-is is viable — see CR7 for the prior art
   the plan missed.
2. REACH claim CONFIRMED. `App.tsx:208-210` shell-mounts `CreatePipelineModal` route-skipped on `/pipelines`;
   `AddSourceModal` is rendered only by `SourcesPage.tsx:154`; `OutputPicker` only by `PanelList.tsx:315-320`
   (plus `PanelDetailModal.tsx:119` in `mode="swap"`, local state, not the Redux flag).

**Smaller corrections — CONFIRMED.** No `PanelCreationModal` component exists (grep: the name survives only in the
Redux field and in comments). `DashboardList.tsx:38` is `const [isCreateMode, setIsCreateMode] = useState(false)`
— an inline form, not a modal. `CommandAction` (`model/types.ts`) has no combo field. `ShortcutCombo`,
`formatCombo`, and `shared/ui/KeyCap` all exist as D5 describes.

**Decision 1 precedent — GENUINELY APPLIES.** I read `App.tsx:200-207`. The comment says verbatim what design.md
quotes: "previously it only set `createModalOpen` in Redux with nothing mounted to read it outside `/pipelines`,
so the modal silently opened later, on whatever route the user next visited `/pipelines` from." Same mechanism,
same two flags, same fix. D1's rejection of navigate-then-act is sound and I do not contest it.

**Live probe (reproduced twice), running app, dev 5948, logged in as matt@helio.dev.** On
`/sources/d9e095bf-.../` the sidebar's "Add source" `+` (`SidebarBody.tsx:87`) dispatches
`setAddSourceModalOpen(true)`; `document.querySelectorAll('dialog[open]').length === 0` — nothing mounted, as
predicted. I then navigated to `/sources`: still `0`. That non-appearance is NOT correct behavior; see CR3.

**Visual state (screenshots in `.concertino/runs/HEL-516/evidence/`).** `palette-dark.png`,
`palette-light-hover.png`, `help-dark.png`, `help-light.png`. The palette today is a ~680px dialog of
icon+title rows with **no right-hand column at all**, sections as uppercase eyebrows (NAVIGATION / GENERAL).
The help overlay is a ~420px dialog whose rows are label + right-aligned caps. KeyCaps render cleanly and
consistently in both themes; hover is a filled row; I found no token or light/dark defects in the existing
primitives. The cohesion problem is placement, not styling — see CR9.

### Verdict: REFUTE

The design is directionally right — D1 and D2 are correct and well-grounded, and the seam-consumption story
holds. But D3's route-transition analysis is incomplete in a way that hides a prod-only defect, task 1.2 omits a
required prop, and two files the change must touch are absent from the plan entirely.

### Change Requests

1. **`OutputPicker` has a second REQUIRED prop the plan never mentions: `currentDashboardPanels: Panel[]`**
   (`OutputPicker.tsx:38`). Task 1.2 enumerates only the flag and `dashboardId`. Off `/`, `state.panels.items` is
   PanelList-owned and may be empty or hold *another dashboard's* panels — `PanelList.tsx:108` guards for exactly
   that (`items[0].dashboardId !== selectedDashboardId`). Feeding `[]` or stale items silently breaks
   `useOutputPickerData`'s "already on this board" marking, which violates the `palette-quick-create` scenario
   "the resulting creation flow … the same as if the user had activated that section's own create control". Add a
   decision recording how the shell mount obtains the current dashboard's panels (select with a staleness check,
   fetch, or extend the seam) and a task for it. Do not cite `PanelDetailModal.tsx:119`'s `[]` as precedent — it
   is a swap-mode call site with different semantics.

2. **Decision 3 is incomplete: `SourcesPage` has the SAME unmount cleanup.** `SourcesPage.tsx:60-64` (HEL-554 D4)
   resets `addModalOpen` on unmount, explicitly mirroring the D5a pattern. D3 reasons only about `PanelList`.
   Repeat the three-case analysis for sources and cover it in tasks 1.1/1.3, or the sources mount inherits an
   unanalyzed interaction.

3. **StrictMode masks the exact defect tasks 5.3 and 1.3 exist to prove — the plan's largest measurement
   hazard.** My probe above shows no unbidden modal on arriving at `/sources`. That is not the code being correct:
   `main.tsx:58` wraps the app in `React.StrictMode`, so `SourcesPage`'s cleanup fires **once at mount** in dev and
   clears the flag before render. `SourcesPage.tsx:56-58` asserts this is "safe … because `addModalOpen` starts
   `false` at every mount now that nothing sets it before this page itself does" — **that premise is false**:
   `SidebarBody.tsx:87` sets it from `/sources/:id`. In a production build (no StrictMode) the modal *would* open
   unbidden. Three consequences the plan must absorb:
   (a) a 5.3 guard driven against the dev server passes **vacuously today, before any fix** — structurally
   incapable of failing, precisely HEL-510's refusal case. Require it to be **red first**, or run against a
   production build (`npm run build` + preview), and say in-file which it is;
   (b) shell-mounted behavior will diverge dev-vs-prod for any modal open across a navigation *into* `/` or
   `/sources` (dev closes it at mount, prod does not). D3's "desired behavior" conclusion is only established for
   dev as written;
   (c) this is a real pre-existing bug found by this ticket. Either fix it here or file a ticket — per evidence
   rule 4 a deferral must name one.

4. **State the route-skip predicate for sources precisely.** Task 1.1 skips "the exact route `/sources`" — correct,
   but the design must say explicitly that `/sources/:id` **does** shell-mount (`AppRoutes.tsx:101-102`:
   `SourceDetailPage` is a sibling route, not a child of `SourcesPage`). That is where the live defect lives and
   is the natural reach-test route.

5. **`CommandBar.tsx` is missing from Impact and from tasks, and 1.2 falsifies its comment.** `CommandBar.tsx:73,82`
   already consumes `useCreatePanelAction`, and lines 285-289 gate the "Add panel" kebab item on `onDashboardView`
   with the rationale "`PanelCreationModal` is mounted by `PanelList` alone (route `/`), so neither item may
   outlive the surface that responds to it." Shell-mounting makes that false. Add the file to Impact, add a task to
   correct the comment, and record a decision on whether the header's route gate stays — a palette that offers
   "Add panel" everywhere while the header's kebab is `/`-only is an inconsistency the cohesion gate should rule on.

6. **The "never presented twice" analysis covers only route-doubling.** `CreatePipelineModal.tsx:226` and
   `AddRootModal.tsx:124` render nested `AddSourceModal`s from **local** state, independent of `addModalOpen`.
   Since `CreatePipelineModal` is shell-mounted on every non-`/pipelines` route, a user can have the nested
   AddSourceModal open and run the palette's "Add source", yielding two. Add an explicit decision and a check;
   task 1.1's "exactly one modal" as written does not catch it.

7. **Fix D4's factual count and cite the prior art it missed.** `CreateActionResult` is declared in **five** files,
   not four (`features/assistant/hooks/useCreateConversationAction.tsx:7` is the fifth). More importantly,
   `shared/chrome/usePickerSelection.ts:3-9,41-46` **already calls all four seams at top level** and hands out a
   `CreateActionResult` per section — that is the working proof of D4's "seams are hooks, so build a component
   that calls them all" claim (which I judge sound), and a reuse candidate rather than a fifth independent call
   site. Cite it in D4 and task 2.1. With the count corrected, I accept "observation, not deferral" for the dedup
   itself — no behavior is owed and no ticket is required.

8. **Task 4.3's guard risks being a tautology.** "A test that changing the declaration changes the rendered cap"
   is usually written as `expect(caps).toEqual(formatCombo(shortcuts.find(s => s.id === "quick-launcher").combo, …))`
   — both sides derived from one source, so it cannot fail. Require the assertion to use **literal tokens**
   (`["Ctrl","J"]` / `["⌘","J"]`) so editing the declaration turns it red, and label what it proves per task 6.2.

9. **Cap placement in the palette is an undecided visual call — escalate it, do not settle it.** Evidence
   (screenshots above): palette rows are ~680px with no right-hand column; the help overlay's rows are ~420px with
   right-aligned caps. Exactly one palette action ("Open assistant") will carry a cap, so a right-aligned cap sits
   alone roughly 500px from its title, in a list where every other row ends at its label. design.md says nothing
   about placement; task 4.4 only forbids reserved empty space, which does not answer it. Add a placement decision
   to D5 and, per the owner-mandated cohesion gate, put both options (right-aligned vs. inline-after-title) to the
   owner with screenshots rather than resolving by agent judgment.

### Non-blocking notes

- `CommandBar.tsx:281` renders `title="Assistant (Ctrl/Cmd+K)"` — stale since the quick-launcher moved to
  Cmd/Ctrl+J. A live, wrong, user-visible shortcut string, and precisely the drift D5 exists to prevent. Worth
  folding in with CR5's comment fix; if not, file a ticket.
- The `KeyCap` primitive itself is cohesive: correct in both themes, no token or HEL-866-style hover collision
  observed in the help overlay. My concern is placement only.
- Task 5.4's screenshot destination (`.concertino/runs/HEL-516/evidence/`) is correct; my evidence is there.
