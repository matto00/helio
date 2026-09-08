## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Base `3a0c0fe8`, worktree clean except the untracked change dir. All measurements below were
re-derived from the tree by me; no number was inherited from the audit.

### What I verified (with evidence)

**Re-measured, agrees with the audit:**

- `border-radius`: 285 grep hits, 22 non-`var()` declarations = **12 × `50%`** (Toggle:52,
  AccentPicker:15, Spinner:10, PipelineDetailPage:977/995, DashboardList:669,
  DashboardAppearanceEditor:126, MobileNavSheet:300, UserMenu:10/26/34, StatusChip:51) +
  5 × `0`/`inherit` + **exactly the five sub-scale values claimed** (DividerPanel:19 `1px`,
  PipelineDetailPage:559 `1px`, MarkdownPanel:82 `3px`, MarkdownPanel:93 `4px`,
  PipelineDetailPage:905 `4px`). The audit's 17/12/5 split is correct.
- **Accent borders — the correction is upheld, and I checked the mirror direction.** 46 sites
  confirmed. I read the non-pseudo-class residue rather than trusting the classification:
  `MessageTurn.css:31/51`, `ProposalHandoff.css:8`, `ProposalReview.css:158`,
  `PipelineDetailPage.css:630/643/659` are all `--app-accent-surface`/`--app-accent-dim`
  backgrounds with a matching `--app-accent-mid` hairline — coherent semantic tinting, not a
  default hairline. `DESIGN.md:93` does document `--app-accent-mid` as the selection-border
  token and `:94`'s "never accent-tinted" governs `--app-border-subtle`/`-strong`. **I found no
  genuine default-hairline-in-accent violation.** The over-correction did not happen.
- **Nothing currently protects this.** `tokenAuditSweep.css.test.ts` walks a hard-coded
  9-file `SWEPT_FILES` list and covers spacing/color/font only — zero radius or shadow
  patterns. `motionTokenGuard.css.test.ts` walks the tree recursively but is duration-only.
  The "a new literal shadow or off-scale radius is caught by nothing" premise holds.
- **D1 (`50%` allowed, not exempted) is right.** 12 live circle declarations; an exception entry
  would be a standing invitation to "resolve" it. Confirm.
- **D2's "where a token applies" qualifier is legitimate here, not a reuse of HEL-441's wording.**
  `DESIGN.md:281` floors the scale at `--app-radius-sm` 6px. There is no token at 1/3/4px, so no
  token applies, and snapping is a 2–5px visible change. Default-to-LEAVE is correct.

**Re-measured, DISAGREES with the audit — see CR1 and CR2.**

### Verdict: REFUTE

Two of the three findings below are premise defects, not nits: one half of the ticket is
mis-measured, and one of the two remaining "judgment calls" is already settled by the binding
standard. Both would be discovered mid-execution, which is where the trap this gate exists to
catch actually springs.

### Change Requests

**1. The `box-shadow` premise is wrong: six declarations use no shadow token, and the plan has
nowhere to put them.**

`grep -rn "box-shadow *:" --include=*.css frontend/src | grep -v "var(--"` returns six
declarations whose *geometry* is entirely literal (only the colour is tokenised, so a
`var(--)`-on-the-line test scores them clean — that is how the audit got zero):

- Four **byte-identical** copies of a scroll-edge fade —
  `features/connectors/ui/ConnectorsPage.css:87`, `features/pipelines/ui/PipelineListTable.css:41`,
  `shared/ui/DataGrid.css:25`, `features/sources/ui/SourceListTable.css:106`:
  `inset 12px 0 12px -12px color-mix(...)` × 2.
- Two identical focus/selection rings — `shared/chrome/AccentPicker.css:37` and `:43`:
  `0 0 0 2px var(--app-surface-strong), 0 0 0 4px var(--app-accent)`.

None is `--app-shadow-card` or `--app-shadow-soft`, and **neither token applies** — a scroll
fade is not resting elevation and a focus ring is not an overlay lift. So the honest reading is
"6 non-token shadows, all correctly non-token", **not** "0 literal / already complete". Required:

- (a) Correct the table in `ticket.md`, `proposal.md` and `design.md`. "47 declarations, ZERO
  literal, already complete" is the load-bearing claim behind "the guard is the whole
  deliverable"; leaving it stated that way means the final gate is checking the wrong fact.
- (b) Decide **at design time** what the guard does with these six. Task 2.1 says "no literal
  `box-shadow`" and task 2.3 scopes the exception list to "whichever sub-scale radii survive
  task 3.1" — so as written the guard goes RED on six correct declarations on first run, and the
  executor's two exits are both bad: snap them onto `--app-shadow-card`/`-soft` (visually wrong,
  and precisely the HEL-441 "tidier and worse" failure), or quietly redefine literal as
  "contains no `var()`".
- (c) That second exit must be closed explicitly, because it silently defeats task 2.4. Under a
  "line contains any `var()`" rule the required RED mutation
  `box-shadow: 0 2px 8px var(--app-text)` passes **green**. State the shadow arm's rule
  precisely (e.g. the value, after stripping `inset`, must be exactly one of the two tokens, with
  the six above pinned by file + declaration + count), and require the mutation transcript in 2.4
  to use a mutation carrying a `var()` colour so it proves the arm is actually failable.
- (d) The four identical scroll-fade copies are the one genuine cohesion finding a grep *did*
  surface here. Either lift them to a shared token/utility in this change or file a spinoff and
  name it — per the plan's own "a deferral is real only if a ticket owns it".

**2. D3 / task 3.2 reopens a settled, measurement-backed decision. Re-scope it to
verification-only.**

`DESIGN.md:123-135` is an explicit named carve-out — "**Carve-out (HEL-774): the phone bottom tab
bar**" — permitting `backdrop-filter: blur(10–16px)` on `BottomNav` alone, with a *measured
contrast floor* replacing the invariant, and `BottomNav.css:35-37` carries an in-code comment
citing `DESIGN.md §0.2`. Task 3.2 ("judge it against the opacity invariant on the running app…
if it stays, say so in DESIGN.md") is wrong on both halves: DESIGN.md already says so at length,
and inviting an executor to re-derive by eye a decision that was settled by measurement is
exactly the "new UI/UX gap" the mandate forbids — the failure mode is an executor removing the
blur and regressing icon legibility. Rewrite 3.2 as: confirm `BottomNav.css:38-39` still matches
the HEL-774 carve-out (blur within 10–16px, tint layer present, `-webkit-` prefix), **do not
modify**, and record it as already-satisfied. Drop the corresponding DESIGN.md edit from 5.1 —
re-stating an existing carve-out is duplication that can drift.

Consequence to state plainly in `proposal.md`: with 3.2 verification-only, `Modal.css` deferred
to HEL-1035, and D2 defaulting to LEAVE, the expected diff is **guard + DESIGN.md `50%` rule +
CR1's shadow decision, and possibly zero other CSS change**. That is an honest outcome and I
would confirm it — but it must be written down now, so the final gate does not read a small diff
as under-delivery and pressure someone into manufacturing cleanup.

**3. AC3 and the D5 absence-hunt are currently dischargeable vacuously — enumerate them now.**

Tasks 4.2 and 4.3 are the two checks the guard cannot make, and they are the plan's most
valuable content, but neither names *what* is to be inspected: "sample the rungs in the browser"
and "hunt for surfaces with NO elevation". A tired executor discharges both with two screenshots
and a sentence, and nothing in the artifact can call that wrong. Before execution, fix in
`design.md` an explicit table: **rung → concrete component/view → expected token**, covering all
five rungs (`--app-bg` canvas, `--app-surface-soft` recessed input/well, `--app-surface` card,
`--app-surface-raised` hover, `--app-surface-strong` modal/popover/toast), with at least one
named live surface per rung, checked by `getComputedStyle().backgroundColor` in **both** themes.
For 4.2, name the specific candidate inventory to walk (the pages this lane can reach: dashboard
list, panel grid, pipeline detail, sources, settings, plus every popover/menu/toast) rather than
leaving the search unbounded. A pass on 4.2/4.3 must be a stated list with a per-item result.

### Non-blocking notes

- `features/pipelines/ui/PipelineDetailPage.css:791` is the one accent-border site I could not
  cleanly classify: `background: var(--app-surface)` (neutral) with `border: 1px solid
  var(--app-accent-mid)`. It reads as an accent-outlined secondary-button affordance rather than
  a default hairline, so I do **not** treat it as a violation and it should **not** widen scope —
  but if the executor is in that file for another reason, an eyes-on confirmation is cheap.
  Same element is also a one-off button reinventing the shared control; that belongs to a
  different ticket, not this one.
- `tokenAuditSweep.css.test.ts` pins its baseline by **line number**, which breaks on any edit
  above a pinned line. Task 2.3 correctly specifies file + declaration + count instead — keep it
  that way; do not copy the older file's line-pinning for consistency's sake.
- No visual observation is recorded in this report, so no dev-server provenance was required or
  claimed. The provenance procedure in task 1.1 is correct as written and binds execution.
