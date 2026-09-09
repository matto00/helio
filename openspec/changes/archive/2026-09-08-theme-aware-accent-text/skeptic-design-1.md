## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Artifacts at `216331ca`; base `main` @ `a6bde0d3`. All numbers below were computed by me from
`frontend/src/theme/theme.css` + `frontend/src/theme/theme.ts` literals, not inherited from the plan.
Scripts and raw output: `.concertino/runs/HEL-1048/evidence/skeptic-rederivation.{js,-output.txt}`,
`skeptic-accent-strong-{contrast.js,output.txt}`.

### What I verified (with evidence)

**D3 — re-derived independently, and it holds.** I re-implemented the derivation from scratch
(`darkenTowardBlack` semantics for light: `Math.round(c*(1-p/100))`; lighten-toward-white for dark;
`--app-accent-surface`/`--app-accent-dim` alpha-composited over each of the five neutral surfaces per theme,
tint percentages re-parsed from `theme.css:172-173` dark 15/10 and `:223-224` light 11/8). My output
**reproduces design.md's two tables exactly**, cell for cell, both themes, all eight presets — including the
light-neutral row 16/19/20/21/31/36/38/43 and the dark `+tinted` row Purple **22%**, Red **22%**, Blue
**17%**, Pink **18%**. Every preset terminates at an integer percent with a real solution, so **D3's
"one token per theme suffices" is correct for the surface set D2 names** and neither a fixed neutral tint nor
a second token is required. D3 does not collapse.

**D5 — producibility verified.** `darkenTowardBlack(#f97316, 30)` = `#ae510f` (g: `Math.round(115*0.7)` =
`Math.round(80.5)` = 81 = `0x51`), contrast **4.4711 vs `#efece6` (light `--app-surface-soft`) — fails**.
`#ae500f` is emitted at no integer percent. The true minimum is **31% `#ac4f0f` at 4.5911**, which is what my
independent search returns for Orange/light. D5 is correct and the guard as specified in task 5.2 (assert
some integer percent yields exactly the proposed hex) would catch it.

**Tint percentages, surface hexes, preset list, `buildAccentTokens` at `appearance.ts:419`,
`ThemeProvider.tsx:89-92` keyed on `[accentColor]` alone (D6)** — all confirmed against the files.

**AC-3 / D1 separation (your question 6) — sound.** D1 states the asymmetry and its reason, task 2.4 keeps
`--app-focus-ring-color` unchanged, task 5.3 asserts theme-independence mechanically, and task 8.1 records
the rationale in `DESIGN.md`. A future "unifier" hits a red guard, not a code review. Minor note below.

**`--app-bg-accent` / `--app-bg-secondary` are dead as backgrounds** — zero `background: var(--app-bg-accent…)`
declarations exist. Their omission from D2's scored set is correct and could be said so explicitly.

### Verdict: REFUTE

Four of the six findings below are the *same failure mode the ticket exists to fix*: a class of
accent-derived rendering that the derivation and its guard will not see, so the change ships green while
still failing 4.5:1.

### Change Requests

1. **`color: var(--app-accent-strong)` is accent-as-text, it is not in the inventory, and it fails 4.5:1 in
   the light theme for the shipped default accent.** Eight declarations, six files:
   `features/panels/ui/detailModal/PanelDetailModal.appearance.css:102`, `…sections.css:35`,
   `…binding.css:235`, `…binding.css:310`, `shared/chrome/SidebarBody.css:55`,
   `features/sources/ui/AddSourceModal.css:85` and `:95`,
   `features/pipelines/ui/PipelineDetailPage.css:646`.
   `--app-accent-strong` is `color-mix(in srgb, var(--app-accent) 76%, black)` in light (`theme.css:222`),
   i.e. derived from the *unchanged* `--app-accent`, so `text-only-token` leaves it exactly where it is.
   Measured min contrast against the five light neutral surfaces (binding surface `--app-surface-soft`
   `#efece6` in every case): **Orange 3.93, Cyan 3.45, Green 3.24, Yellow 2.78 — all FAIL**; Red 5.05,
   Pink 4.79, Purple 5.24, Blue 4.93 pass. Dark passes for all eight (5.37-9.40).
   This directly violates **AC-1** ("every surface it renders on, both themes, all 8 presets") and the spec
   scenario *"The shipped default is not an exception"* — the shipped light default accent is Orange. The
   design must either bring `--app-accent-strong`-as-text into the derivation/repointing scope, or name each
   of the eight sites as knowingly unfixed with a reason and an owning ticket (AC-4). It currently does
   neither: the word `accent-strong` does not appear in proposal.md, design.md, tasks.md or the spec, and the
   guard predicate as specified (task 5.1/5.4, written around `color: var(--app-accent)`) will not see them.

2. **`color: var(--app-info)` is `var(--app-accent)` by definition and is missed by the anchored grep.**
   `theme.css:181` and `:232` both declare `--app-info: var(--app-accent)`;
   `features/dashboards/ui/DashboardList.css:648` renders text as `color: var(--app-info)`. Task 1.1's
   pattern cannot match it, so it is neither counted, classified, repointed, nor guarded. Add
   `--app-info` (and any future accent alias) to the inventory pattern and to the guard's corpus scan, or
   remove the alias.

3. **The inventory count is 42, not 41 — and the tinted enumeration is not exhaustive.** Running task 1.1's
   own anchored pattern (`^\s*color:\s*var\(--app-accent\)\s*;`, POSIX form) over `frontend/src` returns
   **42 declarations across 24 files**, not 41/24. Per task 1.2's own rule, a third number is a finding, so:
   fix the number in ticket.md / proposal.md / design.md / tasks.md rather than reconciling to 41.
   Separately, an independent rule-body scan (every rule that sets *both* `color: var(--app-accent)` and a
   `background` of `--app-accent-surface`/`--app-accent-dim` in the same block) returns **12 rules across 6
   files**, and two of them are **absent from design.md's 16-item enumeration**:
   `features/pipelines/ui/PipelineDetailPage.css:115` `.pipeline-detail-page__gap-insert-btn:hover/:focus…`
   and `:241` `.pipeline-detail-page__op-dropdown-item:hover`. My 12 is *narrower* than 16 by construction
   (it cannot see inherited tinted containers such as `.dashboard-list__pinned-badge`), so 12 does not
   contradict 16 — but a mechanical same-rule scan finding two selectors the hand list omits means the
   enumeration behind AC-4 is not complete. Re-derive it mechanically and drop the trailing
   "plus `:hover`/`:focus-visible` variants", which is not an enumeration.

4. **The deferral to HEL-1051 does not hold — HEL-1051 does not own accent *text* on user-chosen surfaces.**
   I read HEL-1051. Its title is *"Focus indicators on panel-scoped surfaces cannot be guaranteed at 3:1"*;
   its scope is "any focused control whose binding surface is `--panel-surface-override`…"; its single AC is
   "a focused control … presents an **indicator** clearing **3:1**". Nothing in it covers accent-coloured
   **text** at **4.5:1** on a user-chosen panel surface. Yet that case is live and rendered:
   `features/panels/ui/MarkdownPanel.css:112` `.markdown-panel a { color: var(--app-accent) }` sits on
   `--panel-surface-override` (`MarkdownPanel.css:16-17`) — and design.md itself calls `.markdown-panel a`
   "the most text-like consumer of all". So the plan's one out-of-scope class is deferred to a ticket that
   does not accept it. Either file/extend a ticket that actually owns accent-text-on-user-chosen-surfaces and
   cite that, or bring it in scope. Note in passing that `resolvePanelTextColor` (`appearance.ts:245`)
   already derives panel *text* from the resolved panel surface — an in-tree precedent the design never
   mentions, and which may make this cheaper to fix here than to defer.

5. **A third accent-derived background class exists and is unclassified: `::selection`.**
   `theme.css:296` sets `::selection { background: var(--app-accent-mid) }` — `color-mix(… var(--app-accent)
   26%…)` light / `30%` dark (`theme.css:174`, `:225`) — and sets no `color`, so **accent text keeps its
   accent colour while its background becomes a 26%/30% accent tint** whenever a user selects it. That is a
   strictly heavier tint than either background D2 scores. My derivation extended to the 26%/30% tint needs
   light Yellow **48%** and dark Yellow **12%**, Cyan **23%**, Green **22%** — i.e. presets D3 currently
   reports as 0% adjustment in dark. AC-4 requires every surface accent text can land on to be enumerated
   and classified, so this must be explicitly classified and either scored or excepted **with its reason
   stated** (a defensible exception exists — transient, user-initiated, and arguably a UA-highlight case —
   but the design must say so rather than be silent). It is currently silent.

6. **D2's stated rationale is wrong, and it is the sentence a future implementer will act on.** D2 says
   "because `--app-accent-surface` … are mixed **from the accent**, darkening the accent darkens the
   background with it and the change largely cancels". Under D1 (`text-only-token`) `--app-accent` is
   *unchanged*, so the tinted background does **not** move with the text; nothing cancels. The tinted
   backgrounds are simply darker/lighter *fixed* surfaces that the neutral-only scoring never looked at —
   which is exactly what my computation assumed, and why it reproduces D2/D3's tables. Correct the prose so
   it matches the arithmetic; as written it describes the rejected "change `--app-accent`" shape and invites
   an implementer to model the background as tracking the text.

### Your question 4 — D4 escalation timing: your handling is right in principle, wrong in placement

Deferring perceptibility to a **rendered** check is correct — the owner's ruling was a policy ("accept the
hue shift"), and whether +22% on dark Purple is perceptible is not answerable from a contrast table. Do not
escalate on the numbers alone. Two corrections:

- **Move it before the repointing work, not after.** Task 7.1 currently sits behind tasks 1-6, so a
  re-escalation that changes the answer invalidates ~42 repointed declarations plus the guard. Rendering four
  dark swatches (Red `#f36d6d`, Pink `#ef69ab`, Purple `#bb7af9`, Blue `#5c97f8` — my values, matching yours)
  costs one screenshot and gates everything downstream. Make it task 2.0.
- **State the escalation trigger objectively.** "If perceptible" is not a threshold a fresh agent can apply.
  Use something checkable, e.g. escalate if the rendered pair is distinguishable side-by-side at 1× in the
  running app, and attach the before/after pair either way.

I would also re-run 7.1 *after* findings 1 and 5 are resolved: if `--app-accent-strong` text or `::selection`
enters the scored set, the dark deltas move again and the ruling would be reviewed against numbers that had
already changed a second time.

### Non-blocking notes

- **`.concertino/runs/HEL-1048/evidence/premise-validation.md` does not exist.** ticket.md cites it as the
  "Full record" of the premise corrections; the evidence directory contains only the 34 contact-sheet PNGs.
  The premise corrections all check out against the files independently, so this is a dangling reference, not
  a wrong claim — but it is the kind of citation that reads as verified and is not.
- D8/task 4.3 says "correct or remove" the dead per-theme defaults. `theme.css:161-168` and `:216-221` argue
  at length that they are the deliberate pre-hydration static fallback and "must not be edited to look right
  here, only kept parseable". Removing them would delete that fallback. Pick one explicitly.
- AC-3 is guarded in `appearance.ts` (task 5.3) but the trap you name is a reader of `theme.css`. A one-line
  comment beside the new token in `theme.css` pointing at the empty-window proof would close it.
