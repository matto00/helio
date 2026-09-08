## Skeptic Report — design gate (round 3, skeptic-design-3.md)

### What I verified (with evidence)

Cold spawn; every fact below re-derived from the tree, not from the round-3 prose.

**CR1 (BLOCKING) — the chosen mechanism is the right one, and the harness for it exists; the SEQUENCE
written into task 1.3a is still wrong.**

Buildability of the *mechanism* — verified and fine:
- `frontend/src/test/renderWithStore.tsx:255` wraps in `MemoryRouter initialEntries=[initialPath]` and
  applies **no `React.StrictMode`** — "mount the app tree without StrictMode" is the default in jsdom, not
  something to be arranged. `frontend/src/app/App.test.tsx:34` already renders `<App/>` under
  `MemoryRouter` + `Provider`, so app-tree render tests have direct precedent.
- DOM-presence-only assertion in jsdom is legitimate (evidence rule 3 not engaged), and
  `SourcesPage.test.tsx:20-28` already carries the required `HTMLDialogElement.prototype.showModal/close`
  stub that makes `getByRole("dialog")` work at all. Correct that no `vite.config.ts` change is now needed.

The sequence — **broken as written.** Task 1.3a (lines 38-42) says: set `addModalOpen` from a
`/sources/:id` render, navigate to `/sources`, assert NO dialog present.
- `frontend/src/features/sources/ui/SourcesPage.tsx:154` renders
  `{addModalOpen && <AddSourceModal …>}` unconditionally on `/sources`.
- `SourcesPage.tsx:62-65`'s reset is an **unmount** cleanup, and `grep addModalOpen`/`setAddSourceModalOpen`
  over `features/sources/ui/SourceDetailPage.tsx` returns **nothing** — no cleanup on the `/sources/:id`
  side. `setAddSourceModalOpen` writers are only `SidebarBody.tsx:87`, `useAddSourceAction.tsx:27`,
  `SourcesPage.tsx:63,154`.
- Therefore, **with the fix applied and without StrictMode**, the flag is still `true` at the moment
  `/sources` mounts, `SourcesPage` renders its own `AddSourceModal`, and a dialog IS present. The guard goes
  **red post-fix**. It is not failable-by-mutation in the intended direction; it is unconditionally failing.

The missing step is one sentence: on `/sources/:id` the shell-mounted modal opens in place and **the test
must dismiss it** (the flag is cleared by the user's close, which is the real production path), and only
then navigate to `/sources` and assert no dialog. That is also exactly what the spec requires: post-fix the
antecedent of the `spec.md:48-52` scenario ("a route where the surface is not presented") is no longer
satisfiable, so the evidence path has to be request → served in place → dismissed → later arrival is clean.
Under the mutation (delete the shell mount) that sequence goes red at its first assertion — no dialog ever
appears on `/sources/:id` — which is legitimate red, but 1.3a must say *that* is the red it expects rather
than implying the negative assertion alone carries the mutation.

**CR2 (BLOCKING, cheap) — RESOLVED.** tasks.md:118-125: 5.3 now states the dev-server form is green-before-
fix and structurally incapable of failing, names `main.tsx:58` StrictMode as the reason, assigns the
non-vacuous assertion to 1.3a by name, and restricts itself to the positive reach direction. Section 5 read
alone no longer reproduces the vacuous guard.

**CR3 (non-blocking) — RESOLVED in tasks.md, the artifact that gets built.** tasks.md:14-22 says the
`PanelList.tsx:105-108` clause is NOT a reusable predicate and must be extracted or mirrored, and that
`PanelList.tsx:314-320` passes `items` RAW so there is no loading path to mirror (shell mount deliberately
stricter). Acceptance restated as parity with the post-fetch RESULT (tasks.md:23-25). design.md:98-105
matches. Both facts re-checked against the tree and correct.

**CR4 — RESOLVED.** proposal.md:44 lists `frontend/src/app/CommandBar.tsx` with its full path.

**CR5 — RESOLVED.** tasks.md:146-152 (task 6.4b) fixes the stale title in scope and requires deriving by
shortcut id. Verified in the tree: `CommandBar.tsx:280` is `title="Assistant (Ctrl/Cmd+K)"`;
`shortcuts.ts:45-49` is `id: "quick-launcher"`, `combo: {key:"j", mod:true}`. The string is genuinely wrong
and the derivation is feasible.

**Newly broken by round-3 edits:** nothing found. Proposal/design/tasks remain mutually consistent; no new
task contradicts a tree fact I checked; no visual surface changed, so the round-2 cohesion finding stands
(not re-judged, per instruction). D1/D2, cap placement, the `onDashboardView` gate and the
`CreateActionResult` framing were not reopened.

### Verdict: REFUTE

One item, and I will say it plainly as asked: after three rounds this finding is still not right. The
mechanism choice is now correct and buildable; the concrete steps written under it produce a test that fails
even when the code is correct. It is a genuine BLOCKING correctness defect in tasks.md (an implementer
following it literally hits a red test post-fix and will improvise the guard — the HEL-510 tasks.md-only
failure mode), but the repair is one sentence, not a redesign.

### Change Requests

1. **BLOCKING (one-sentence repair) — task 1.3a's guard sequence is red post-fix.** `SourcesPage.tsx:154`
   renders `AddSourceModal` whenever `addModalOpen` is true, and nothing on `/sources/:id` clears the flag
   (no writer in `SourceDetailPage.tsx`), so "navigate to `/sources`, assert NO dialog" fails *with* the fix
   applied. Rewrite the sequence as: (1) render the app tree (no StrictMode) at `/sources/:id`; (2) trigger
   the source create action; (3) assert the dialog IS present in place — this is the reach assertion and it
   is what the mutation kills; (4) dismiss it, which clears `addModalOpen` by the real production path;
   (5) navigate to `/sources` and assert no dialog. Then state in-file that the mutation (delete the shell
   mount) turns this red at step 3, that step 5 is the production-behavior assertion the spec's "outside
   development mode" scenario needs, and that the guard proves DOM presence only — nothing about focus or
   appearance.

### Non-blocking notes

- Task order in section 6 lists `6.4b` before `6.4a`; harmless, but renumber if it is touched anyway.
- 6.4b: today's title `"Assistant (Ctrl/Cmd+K)"` is a both-platforms string, while `formatCombo`
  (`shortcuts.ts:130-136`) emits a platform-specific pair (`Ctrl` vs `⌘`). Deriving by id will change the
  string's shape on macOS, not just its letter. Expected, but worth a word in the task so it isn't read as
  a regression.
