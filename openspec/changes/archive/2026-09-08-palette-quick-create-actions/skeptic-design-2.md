## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence)

Cold spawn; every fact below was re-derived from the tree or the running app, not from the round-2 prose.

**Round-1 CRs that ARE genuinely resolved, in tasks.md (the file that gets built) as well as design.md:**

- **CR1 → D3b + task 1.2a.** `OutputPicker.tsx:36-39` does declare `dashboardId: string` and
  `currentDashboardPanels: Panel[]` as required. The mechanism 1.2a prescribes is implementable: `fetchPanels`
  is a real thunk (`panelsSlice.ts:117-133`, dispatched by `PanelList.tsx:329`) and `selectedDashboardId`
  gating has the `RefinementChatDrawer` precedent at `App.tsx:211-219`. Two factual defects in the wording —
  item 3 below, non-blocking.
- **CR2 → D3 extended.** `SourcesPage.tsx:50-65` is exactly the cleanup described (HEL-554 D4, comment
  explicitly mirroring `PanelList.tsx:193-197`). Task 1.3 now names BOTH cleanups and browser Back. Resolved.
- **CR4 → task 1.1 + D3.** `AppRoutes.tsx:100-102` confirms `/`, `/sources`, `/sources/:id` are three flat
  siblings; the exact-path skip and the "`/sources/:id` is the reach-test route" statement are both correct.
  Resolved.
- **CR5 → D6 + task 6.4a.** `app/CommandBar.tsx:283-290` carries verbatim the comment quoted, and 6.4a's
  keep-the-gate/fix-the-comment split matches the owner ruling. Resolved (path nit, item 4).
- **CR6 → D7 + task 1.5.** `CreatePipelineModal.tsx:226` and `AddRootModal.tsx:124` nested-local
  `AddSourceModal`s confirmed. I additionally checked the symmetric case for the OTHER new shell mount:
  `PanelDetailModal` (swap-mode `OutputPicker`) is rendered only by `DesktopPanelGrid.tsx:331` and
  `MobilePanelStack.tsx:126`, i.e. only under `/` where the shell mount is skipped — so no equivalent
  nested-doubling path exists there. No new hole.
- **CR7 → D4.** `grep -rln 'export interface CreateActionResult'` returns 5; `usePickerSelection.ts` is cited
  as prior art in both D4 and task 2.1. Resolved.
- **CR8 → task 4.3.** Literal tokens now required and the derive-both-sides form explicitly forbidden.
  `shortcuts.ts:45-49` confirms `quick-launcher` is `{key:"j", mod:true}` and `formatCombo`
  (`shortcuts.ts:130-136`) emits `["Ctrl","J"]` / `["⌘","J"]` — the literals in the task are correct.
- **CR9 → D5 + task 4.2.** Escalated and ruled by the owner; inline-after-title with a STOP-and-escalate if
  `KeyCap` needs restyling. Not reopened.

**Cohesion gate (running app, dev 5948, logged in as matt@helio.dev).** I judged the one visual consequence I
was asked to: a shell-mounted modal opening in place on an unrelated route. Evidence:
`.concertino/runs/HEL-516/evidence/skeptic2-addsource-on-sources.png` — `AddSourceModal` is a centered
overlay dialog over a full-viewport scrim, and `OutputPicker.tsx:209-215` renders through the same shared
`Modal`. Both are therefore route-independent by construction: what changes off-route is only what the scrim
dims. I found no new UI/UX gap created by shell-mounting, and no cohesion call that needs escalating.
`/sources` sidebar + page render correctly around it in the current theme; light/dark, hover and focus for
the NEW palette rows remain execution-gate work (task 5.4), which is correctly specified.

### Verdict: REFUTE

Seven of nine round-1 CRs are closed cleanly. The one I was told to scrutinize hardest — CR3 — is not: the
guard the plan makes MANDATORY has no achievable mechanism as written, and the vacuous test CR3 refused is
still sitting unannotated in tasks.md, which is the artifact the implementer builds from.

### Change Requests

1. **BLOCKING — Decision 3a's mandatory guard offers two mechanisms and NEITHER is achievable in this tree.**
   Task 1.3a: "must be red-first, or run against a production build (`npm run build` + preview)".
   (a) *Production build is not reachable.* `frontend/vite.config.ts:59-66` defines `server.proxy` for
   `/api` and `/health` and has **no `preview` block at all** — `vite preview` serves the built bundle with
   no backend proxy. `playwright.config.ts` pins `baseURL` to `http://localhost:${DEV_PORT}`, so pointing it
   at a preview server yields a session that cannot log in. Making this option real requires a
   `preview.proxy` addition to `vite.config.ts`, which appears in no task and in no Impact list.
   (b) *Red-first is unachievable for this assertion by construction.* The negative "no unbidden modal on a
   later `/sources` visit" assertion is green pre-fix in dev **because** `main.tsx:58`'s StrictMode clears
   the flag — that is the finding itself, so "make it red first in dev" asks for the impossible.
   With both options closed, the task's own escape hatch ("If you cannot make it fail before the fix, say so
   and do not add it") fires — and directly contradicts "The guard is MANDATORY" three lines above. An
   implementer cannot satisfy both.
   Also note this leaves the newly-added spec scenario "**The behavior holds outside development mode**"
   (`specs/palette-quick-create/spec.md`) as an acceptance criterion with **no achievable evidence path**.
   Name a mechanism that actually works. Three exist; pick one and write it into 1.3a explicitly:
   (i) add a task (and `frontend/vite.config.ts` to Impact) giving `vite.config.ts` a `preview.proxy`
   mirroring `server.proxy`, then run the guard against `build` + `preview` with `DEV_PORT` pointed there;
   (ii) a render-level guard that mounts the app tree **without** `React.StrictMode`, sets `addModalOpen`
   from a `/sources/:id` render, navigates to `/sources`, and asserts no dialog is present — this is DOM
   presence only, not focus/visibility/computed style, so jsdom is legitimate here (evidence rule 3 is not
   engaged), and it IS failable by mutation: delete the shell mount and it goes red;
   (iii) drop to the positive reach assertion (modal opens in place on `/sources/:id`, which is failable in
   dev) and state plainly, per task 6.2, that the negative direction is dev-vacuous and therefore NOT added
   — in which case the spec's "outside development mode" scenario must be reworded or removed rather than
   left unverifiable.

2. **BLOCKING (cheap) — task 5.3 still carries the exact vacuous form CR3 refused, unannotated.** 5.3 reads
   "run the source action from an unrelated route, then navigate to `/sources`, and assert no unrequested
   modal appears" with no mention of StrictMode, no production-build qualifier, and no cross-reference to
   1.3a. Section 5 is a self-contained block; an implementer working it will write this against the dev
   server and get a green test that is structurally incapable of failing (remove the shell mount and it
   still passes, because StrictMode clears the flag at `SourcesPage` mount). This is precisely the "defect
   that lived only in tasks.md" failure mode. Annotate 5.3 in place: point at 1.3a, state that the
   dev-server form is not failable by mutation, and say which of the two tasks owns the non-vacuous
   assertion.

3. **Non-blocking (factual, but will send the implementer looking for something that does not exist).**
   Two claims in D3b/task 1.2a are wrong against the tree:
   - "the picker renders once they resolve, **mirroring the loading path the `/` flow already has**" — there
     is no such loading path. `PanelList.tsx:314-320` renders `<OutputPicker currentDashboardPanels={items}>`
     with `items` passed **raw**, gated only on `panelCreationModalOpen && selectedDashboardId`. The shell
     mount will be *stricter* than `/`, not a mirror of it.
   - "REUSE `PanelList`'s own staleness predicate (`PanelList.tsx:100-108`) **rather than re-deriving one**"
     — that is not a predicate, it is an inline clause of the compound `showPanelGridSkeleton` expression
     (`PanelList.tsx:105-108`). It cannot be reused without first extracting it. Say "extract to a shared
     selector/helper, or mirror the same condition", and restate the 1.2a acceptance as parity with the
     `/` flow's **post-fetch result** (correct "already on this board" marking), not parity with `/`'s
     implementation.

4. **Non-blocking — `CommandBar.tsx` is still missing from proposal.md's Impact**, even though Decision 6
   asserts "`CommandBar.tsx` is added to Impact for the comment fix". Add it, and give the path: it is
   `frontend/src/app/CommandBar.tsx`, not under `features/commandPalette/` as the bare filename in D6/6.4a
   implies.

5. **Non-blocking — a round-1 note was dropped without a task or a ticket.** `app/CommandBar.tsx:280` renders
   `title="Assistant (Ctrl/Cmd+K)"`, but the quick-launcher binding is `{key:"j", mod:true}`
   (`shortcuts.ts:45-49`). That is a live, user-visible, wrong shortcut string — exactly the drift D5 exists
   to prevent — and this change edits lines 283-290 of the same file. Round 2 addresses it nowhere: no task,
   no ticket. Per evidence rule 4 a deferral must name one. Fold it into 6.4a or file it.

### Non-blocking notes

- The `AddSourceModal` dialog is ~800px tall at 1600x1000 (screenshot above) and already scrolls on short
  viewports today. Shell-mounting does not change that; not this ticket's problem, just don't be surprised
  by it in task 5.4's off-route screenshots.
- I re-checked the two settled items and found no regression: D1's F-045 precedent is verbatim at
  `App.tsx:199-209`, and D2's immediate-create reasoning is unchanged. Not reopened.
