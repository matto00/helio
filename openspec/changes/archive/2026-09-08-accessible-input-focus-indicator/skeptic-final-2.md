## Skeptic Report — final gate (round 2, skeptic-final-2.md)

Cold spawn. Scope per the orchestrator's brief: audit the **new factual claims this
documentation-only commit adds**, since two of this ticket's three confirmed
false-support instances were introduced while fixing a previous one. Round 1's
substantive code findings were not re-derived.

### Scope confirmation — the commit really is documentation-only

`git diff fb92b81d..797a20c1 --stat` touches `DESIGN.md`, `AccentPicker.css`,
`design.md`, `evaluation-3.md`, `files-modified.md`, `skeptic-final-1.md`,
`ticket.md`. The only non-`.md` file is `AccentPicker.css`, and its single changed
line is inside a comment block (`~1.05:1` → `1.119:1`). No declaration changed.

### Claim 1 — DESIGN.md §8's "ten `outline: none` declarations across nine distinct sites"

**True.** Enumerated from the real tree, not from the prose:

`grep -rn "outline: *none" frontend/src --include=*.css` returns **11** declarations:
`auth.css:107`, `DashboardList.css:75/144/355/687`, `PanelGrid.css:253`,
`PipelineDetailPage.css:796/804`, `AddSourceModal.css:156`, `AccentPicker.css:19`,
`inputs.css:39`.

`AddSourceModal.css:156` is design.md's site 9, explicitly excluded as orphaned (D9).
11 − 1 = **10 declarations**. Grouping those ten by site: inputs.css (1), three
`DashboardList` inputs (3), the `DashboardList` rename input (1), `auth.css` (1),
`PanelGrid.css` title (1), `PipelineDetailPage.css` footer (2), `AccentPicker.css`
swatch (1) = **nine sites**, ten declarations. DESIGN.md's own inline enumeration
lists exactly those nine and no others.

The sub-claims each check out against the pre-change tree at `736a8cbb`:
- **`PipelineDetailPage.css` is the only site contributing two** — `:796` is the base
  rule, `:804` the former bare-`:focus`/`:focus-visible` pair. Confirmed; no other
  file contributes two *within one site* (DashboardList's four are four distinct sites).
- **`PanelGrid.css` painted `--app-accent-strong`, not raw `--app-accent`** —
  confirmed at `736a8cbb:PanelGrid.css:246`: `border-bottom-color: var(--app-accent-strong)`.
- **`DashboardList.css`'s rename input was halo-only** — confirmed at
  `736a8cbb:DashboardList.css:678,686-689`: a *permanent* `border: 1px solid
  var(--app-accent)` on the base rule, and a `:focus-visible` rule adding only
  `box-shadow: 0 0 0 3px var(--app-accent-dim)`. Focus added nothing but the halo.
  Shipped tree now adds `border-color: var(--app-focus-ring-color)` at
  `:focus-visible` (`DashboardList.css:687`), matching the claim.

Note on a possible reading-collision that is **not** a defect: design.md still says
"Eleven `outline: none` sites" while DESIGN.md says ten/nine. Different denominators
(11 declarations incl. the excluded orphan; 10 fixed declarations across 9 sites),
both independently true against the tree.

### Claim 2 — Yellow `#eab308` vs `--app-surface-soft` `#efece6` = 1.6266

**True, and I derived it independently** (sRGB relative luminance, WCAG formula, from
the literal hexes in `theme.css:201` and `theme.ts:30`):

- Yellow `#eab308` vs `#efece6` → **1.6266** (the ticket's 1.63:1, exactly)
- Orange `#f97316` vs `#efece6` → **2.3774** (the previously-cited figure, unchanged)

So the retraction is correct on the merits: the withdrawn "compares a value to itself"
argument silently held the accent fixed at Orange, and the ticket's number reproduces
on the element the ticket named. This is arithmetic over real token values, not a
browser reading — and `measurement-report.md:40-42` **says so explicitly** ("computed
directly … since Yellow was not the live accent at the time"), which is the honest
framing rather than a dressed-up browser claim.

### Claim 3 — retraction honesty and completeness

The retraction lands in `ticket.md` §3, `design.md` (Site-11 paragraph) and
`.concertino/runs/HEL-1050/evidence/measurement-report.md` §"Task 2.3". In all three
the original text is preserved **verbatim inside an explicit superseded label**, not
silently rewritten. `ticket.md` states plainly that "the ticket was more accurate than
this correction of it."

**Residue check for the withdrawn argument:** grepped `*.md`/`*.css`/`*.ts` for
"compares a value to itself", "does not reproduce", "1.644", "accent-mid". Every
surviving occurrence of the withdrawn reasoning is either (a) inside a
clearly-labelled superseded block, or (b) in a prior round's immutable
`evaluation-*.md` / `skeptic-final-1.md` report, where it is a historical record of
what that round believed and should not be rewritten. No live doc asserts the
withdrawn hypothesis as operative. Unrelated `--app-accent-mid` hits in `DESIGN.md`
§Accent and across `frontend/src/**/*.css` are the ordinary selection-border token
usage, not residue.

**Overclaim check:** all three corrected docs bound the impact identically — the
defect, the fix and its scope were never affected; only the diagnosis of which preset
and element produced 1.63. That is the correct bound. `design.md` also flags that task
2.3's "refuted as directly observable" finding was therefore investigating the wrong
candidate, rather than quietly leaving that task's conclusion standing.

### Claim 4 — the "~1.05:1" → "1.119:1" correction

**True.** `--app-surface-strong` light is `#ffffff` (`theme.css:203`), `--app-bg` light
is `#f4f2ed` (`theme.css:199`). Computed contrast = **1.1188** → 1.119 as stated.

Both required sites are corrected and agree: `AccentPicker.css:51` and
`files-modified.md:8` (the latter labelling it "corrected in the final-gate cycle from
an imprecise '~1.05:1'"). Remaining `~1.05` strings exist only in `evaluation-2.md`,
`evaluation-3.md`, `skeptic-final-1.md` and `workflow-state.md`'s finding log — prior-round
records of the wrong figure being found and fixed, correct to leave intact.

### Gates (re-run, not taken on assertion)

Root `npm test` deliberately not used as evidence (`jest --passWithNoTests` is vacuous
at the worktree root). Ran the guard suites directly:
`cd frontend && npx jest src/theme` → **8 suites, 120 tests, all passing** (2.1s),
covering `focusRingTokenGuard.css.test.ts`, `elevationTokenGuard.css.test.ts` and
`appearance.test.ts`. Round 1 already established the three real-tree guard mutations
go red; nothing in this commit touches test code, so that evidence still binds.

No app run this round: no CSS/TS declaration changed since round 1's live verification
(AC-1's live 3.028 against `#efece6`, and the `AccentPicker` focused-vs-selected
resolution on Red in both themes), so re-driving the browser could only re-measure an
unchanged render.

### Verdict: CONFIRM

The three corrections this commit makes are each independently verified true, the
retraction is complete and honestly bounded, and I found no fourth instance of a
conclusion resting on a false support in the prose this commit *adds*. Ships.

### Non-blocking notes

- DESIGN.md §8 describes the `DashboardList` rename-input fix as "adding a conforming
  border". It actually recolours the existing permanent border *at the focus state*
  (`border-color: var(--app-focus-ring-color)`), which is what the sentence means in
  context and is not wrong — but "adds a conforming border **at focus**" would be
  unambiguous. Wording only.
- `design.md`'s inventory header still reads "Eleven `outline: none` sites" against
  DESIGN.md's "ten … across nine". Both true under their own denominators (see Claim 1);
  a half-clause in design.md noting that ten of the eleven are in scope after D9's
  orphan exclusion would remove the apparent collision for a future reader.
