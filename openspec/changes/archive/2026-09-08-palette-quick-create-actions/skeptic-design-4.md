## Skeptic Report — design gate (round 4, skeptic-design-4.md)

Scope kept narrow as instructed: the round-3 CR1 repair only, plus a check for collateral damage.
Everything ruled out of scope (D1/D2, cap placement, `onDashboardView`, the `CreateActionResult`
observation framing, CR2–CR5, UI cohesion) was not reopened.

### What I verified (with evidence)

**The repair is present in both artifacts.** `tasks.md` task 1.3a now writes the four steps in order
and marks step 3 REQUIRED, stating in-task that omitting it leaves the flag set, makes
`SourcesPage.tsx:154` render correctly on arrival, and turns the assertion red POST-fix.
`design.md` Decision 3a (the "The sequence must include dismissing…" paragraph, lines 141-145) carries
the identical correction. No divergence between the two.

**(a) Buildable with the cited infrastructure — yes, re-derived from the tree.**
- `frontend/src/test/renderWithStore.tsx:253-264`: `MemoryRouter initialEntries=[initialPath]`, no
  `React.StrictMode` anywhere in the wrapper — the no-StrictMode mount is the default, not something to
  arrange. `App.test.tsx:34` is direct precedent for rendering the app tree.
- `SourcesPage.test.tsx:20-28` supplies the `HTMLDialogElement.prototype.showModal/close` stub without
  which `getByRole("dialog")` cannot work.
- Step 3's dismissal has a concrete affordance: `AddSourceModal` renders through `shared/ui/Modal`
  (`AddSourceModal.tsx:363-369`), and `Modal.tsx:201` renders a header button with `aria-label="Close"`
  routed to `onClose`; `AddSourceModal.tsx:323` is a secondary Cancel with the same target.
- Step 3 only clears the flag if the SHELL mount's `onClose` dispatches `setAddSourceModalOpen(false)`.
  That is guaranteed by task 1.1's "follow the F-045 `CreatePipelineModal` precedent verbatim" —
  `App.tsx:208` is `onClose={() => dispatch(setCreatePipelineModalOpen(false))}`, and `SourcesPage.tsx:154`
  uses exactly that shape for the sources flag. The two tasks are consistent.

**(b) GREEN post-fix following the stated sequence — yes.** Step 1 at `/sources/:id`: `location.pathname
!== "/sources"` so the shell mount reads the flag and the dialog is present (step 2 passes; no competing
`AddSourceModal` exists on that route — `grep setAddSourceModalOpen|addModalOpen` over non-test sources
shows writers only at `SidebarBody.tsx:87`, `useAddSourceAction.tsx:27`, `SourcesPage.tsx:63,154`, none
in `SourceDetailPage.tsx`). Step 3 dispatches `false`. Step 4 arrives at `/sources` with
`addModalOpen === false`, so `SourcesPage.tsx:154` renders nothing and the negative assertion holds.
This is precisely the failure round 3 identified, and it is now closed.

**(c) RED under the named mutation — yes.** Deleting the shell mount removes the only reader of the flag
on `/sources/:id`, so step 2 ("assert the modal opens IN PLACE there") finds no dialog and fails. The task
names step 2/the reach assertion as the mutation-killed one and requires the mutation be RUN, not
asserted. (Note step 4 would still pass under the mutation — the task correctly does not claim otherwise.)

**Labelling / evidence discipline.** 1.3a states what the guard proves (production behavior absent
StrictMode) and what it cannot (nothing about focus, visibility, computed style) — consistent with
evidence rule 3; jsdom DOM-presence is legitimate here. Task 5.3 still labels the dev-server form as
green-before-fix and structurally incapable of failing, so the vacuous-gate hazard is not reintroduced.

**Newly broken by this edit — nothing found.** The change touches only the guard-sequence prose in
tasks.md 1.3a and design.md Decision 3a; no other task, no decision, and no spec delta depends on the old
wording. Tasks 1.1/1.3/1.3b remain consistent with the new sequence. No visual surface changed, so the
round-2 cohesion finding stands unre-judged, per instruction.

### Verdict: CONFIRM

### Non-blocking notes

- Step 4's "navigate to `/sources`" leaves the mechanism unstated. It is achievable (sidebar links via
  `SidebarBody`/`SidebarItemList`, or a re-render at a new `initialPath`), so it does not block, but naming
  one mechanism would remove a small judgement call at implementation time.
- Carried forward from round 3, still open and still non-blocking: section 6 lists `6.4b` before `6.4a`;
  and 6.4b's derived title will become platform-specific (`formatCombo`, `shortcuts.ts:130-136`) rather
  than today's both-platforms `"Assistant (Ctrl/Cmd+K)"` string — worth a word so it isn't read later as a
  regression.
