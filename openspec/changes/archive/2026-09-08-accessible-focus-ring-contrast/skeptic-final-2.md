## Skeptic Report — final gate (round 2, skeptic-final-2.md)

Cold spawn. Scope per the orchestrator's brief: verify CR1's fix, independently test
the orphaned-CSS claim, and check for anything newly broken. Round 1's findings were
not re-litigated (no evidence of regression appeared).

### Content self-authentication (before any visual reading)

`curl localhost:6478/src/theme/theme.css | grep -o db6513 | wc -l` → `3`;
`curl .../DashboardList.css | grep -o app-focus-ring | wc -l` → `4` (matches this
branch's 4 repointed sites in that file). `curl localhost:9385/health` → `{"status":"ok"}`.
`location.href` re-read before every browser reading; all on `localhost:6478`.

### 1. CR1's fix — the corrected `theme.css` comment is TRUE

I enumerated every consumer of `var(--app-focus-ring)` under `frontend/src` and
extracted the owning selector for each (32 consumers across 19 stylesheets, plus the
`theme.css` definition):

- **Exactly one bare `:focus`**: `PanelDetailModal.binding.css:138`
  `.panel-detail-modal__type-search:focus`. The comment's "Consumed by bare `:focus`
  in exactly ONE place" is correct, and it names the right site.
- 30 of the remaining 31 are `:focus-visible` (including the two sibling-combinator
  forms, `.ui-toggle__input:focus-visible + .ui-toggle__track` and
  `.dashboard-list__import-input:focus-visible + .dashboard-list__import-label`).
- 1 is the state class `.output-picker__card--focused` (`OutputPicker.css:74`),
  which is neither `:focus` nor `:focus-visible` — see non-blocking note 1.

**The comment's claim about the guard is also true, verified by mutation, not by
reading.** I rewrote `PanelDetailModal.binding.css:138` to
`outline: 2px solid #eab308;`, **confirmed the mutation landed** (`sed -n 137,139p`
printed it), ran `npx jest src/theme/focusRingTokenGuard` → **RED**, "Found 1
unguarded outline declaration(s)"; reverted and confirmed the line is back to
`outline: var(--app-focus-ring);`. So the stylesheet and the guard now agree, and the
agreement is enforced rather than asserted.

### 2. DESIGN.md's note is honestly framed

I read the whole §8 addition. It says the site is "**most plausibly** orphaned CSS,
not a live, deliberately-chosen instance of the carve-out", and records the carve-out
as "what that carve-out **WOULD** require **if** the rule ever renders again … **not**
as a claim that a real user currently sees this behavior." That is the correct framing
for the evidence available, and it does **not** assert a live user-facing
justification. `theme.css` matches ("appears to be orphaned CSS … recorded there as
the rule this rule WOULD satisfy if it were live").

### 3. The orphaned-CSS claim — independently checked, and it holds

I did not accept "zero grep hits" at face value:

- `grep -rn "type-search\|type-list"` across the whole repo (excluding `node_modules`/
  `.git`) returns hits **only** in the two `PanelDetailModal.binding.css` declarations,
  a cross-reference comment in `PanelDetailModal.sections.css:54`, and this change's own
  docs/reports. No `.tsx`/`.ts` hit anywhere — including tests and stories.
- **Dynamic construction checked, not assumed.** `grep` for template-literal class
  building on this BEM prefix (`` `panel-detail-modal__${ ``, `` `panel-detail-modal ``,
  string concatenation) returns 4 hits, all of them literal prefixes with a
  *modifier* suffix (`panel-detail-modal--view`, `panel-detail-modal__mapping-row`,
  `panel-detail-modal__mode-toggle-btn`). None can produce `type-search`/`type-list`.
  `typeSearch` (camelCase, e.g. a CSS-modules or styled key) → zero hits.
- **Provenance confirmed independently.** `git log` on the file shows the last
  non-HEL-1046 commit is `94874bf4` "HEL-909 P1.6 … retire wizard/BindingEditor/Types/
  Metrics pages (#509)", and `git log --diff-filter=D -- '*BindingEditor.tsx'` returns
  that same commit. `frontend/src/features/panels/ui/editors/` no longer contains
  `BindingEditor.tsx`.

**Conclusion: I found no live consumer.** The DESIGN.md note is not wrong in the
opposite direction, and HEL-1049 does not need correcting.

### 4. Deferrals are real (both verified in Linear, this session)

- **HEL-1048** — live, **Todo**, High, v0.7 project, not archived. Accent-as-text at
  4.5:1. This diff touches none of it: `--app-accent` is byte-identical and no
  `color:` site moved.
- **HEL-1049** — live, **Backlog**, Low, created 2026-09-08T20:39Z, not archived. I
  read its full description: it is correctly hedged ("*'No renderer in the current
  tree' is strong evidence but not proof*"), scopes the confirm-then-delete work, and
  requires DESIGN.md §8 to be updated with whichever answer is reached. It owns
  exactly the thing this diff declined to do. This diff does not touch its scope
  (the rule is left in place, only repointed).

### 5. Nothing newly broken by the comment-only cycle

Run from `frontend/` (not the worktree root, where jest finds zero tests):
`npx jest` → **292 suites / 2952 tests passed, 1 snapshot** · `npm run lint`
(`--max-warnings=0`) clean · `npm run typecheck` clean · root `npm run check:tokens`
OK · root `npm run format:check` "All matched files use Prettier code style". The
`src/theme` subset (which contains both HEL-1046 guards plus the HEL-441/HEL-442
guards, `theme.css.test.ts`, `motionTokenGuard`, `elevationTokenGuard`) is 8 suites /
109 tests green. The cycle-4 diff is `DESIGN.md` + `theme.css` comment text +
`files-modified.md` only — I diffed `4ce4a0fd` and confirmed **no declaration,
selector, or value changed**.

### 6. Two-axes question — answered explicitly

Round 1's ninth-defect hunt used the negative-`outline-offset` axis and came up empty.
**I picked a different axis: focus indicators that are not `outline` at all** — rules
that set `outline: none` and paint the indicator with `border-color` / `box-shadow`.
This axis is invisible to both the new guard (which scans only the `outline`
shorthand, a limit the code discloses) and to round 1's live sweep (which measured
`outlineColor`, so an `outline: none` element contributes nothing).

**It produced a finding — see "Substantive finding" below.** It is not a defect in
this diff, and I did not treat it as blocking.

### Cohesion — captured, not ruled

I concur with round 1's advice, **`accept-derived-bronze`**, and add nothing new; the
owner's call stands unaffected by a comment-only cycle. (New screenshot below is about
the finding, not about the ring's hue.)

---

### Verdict: CONFIRM

CR1 is discharged correctly and honestly: the sentence is true, the guard enforces it,
the "is it live?" question was investigated rather than answered with a fabricated
justification, and the residue is owned by a real ticket. Nothing regressed. It ships.

---

### Substantive finding (NOT blocking this diff — needs a follow-up ticket)

**In the light theme, focused text inputs render no compliant focus indicator at all.**
`shared/ui/inputs.css:36-42` (`.ui-input, .ui-select__trigger, .ui-textarea:focus-visible`)
and four near-identical copies in `DashboardList.css` / `auth.css` /
`PipelineDetailPage.css` set `outline: none` and indicate focus with
`border-color: var(--app-accent)` plus a 10%-alpha `box-shadow` halo — i.e. the **raw,
undarkened accent**, the exact colour this ticket was filed to stop painting.

Measured live (not from token names), light theme, Yellow accent, after an 8s settle,
reproduced on two elements:

| element | `outline` | indicator colour | own/adjacent bg | contrast |
| -- | -- | -- | -- | -- |
| `.dashboard-list__filter-input:focus-visible` | `none` | `rgb(234,179,8)` (`--app-accent`) | `rgb(239,236,230)` | **1.627** |
| `.ui-input:focus-visible` (create-dashboard input) | `none` | `rgb(234,179,8)` | `rgb(239,236,230)` | **1.627** |

Screenshot: `.concertino/runs/HEL-1046/evidence/skeptic-final-2-light-input-focus-border.png`
— a pale yellow hairline on pale grey; the ring is essentially invisible, which is what
1.63:1 looks like.

(Honest caveat on method: my *first* reading of this element returned the unfocused
border and no box-shadow. I re-ran it and got the stable result above, twice, on two
elements. Only the reproduced reading is reported.)

**Why I am not refuting on it:**
- It is **pre-existing and untouched** by this diff — `--app-accent` is byte-identical,
  and none of these five rules were in the 17 the ticket repointed (they are not
  `outline` declarations, so they were never in scope of the token adoption).
- The ticket's own scope paragraph is explicit: "**IN: the focus ring only**", and the
  ruled fix is the `--app-focus-ring-color` token. Every `outline`-based focus ring in
  the app now clears 3:1; that work is complete and correct.
- A third round could not fix this within scope anyway: recolouring input focus
  borders/halos is the same theme-dependent brand call HEL-1048 exists to carry.

**But it does mean AC-1's literal wording ("*every `:focus-visible` element renders a
focus indicator clearing 3:1*") is not fully discharged by this change**, because five
rules opt out of `outline` entirely. That gap is currently owned by **no ticket** —
HEL-1048 is accent-*as-text* at 4.5:1, a different obligation and a different set of
sites. **Recommendation: file it before archiving HEL-1046**, and note in the ticket
that the shipped guard cannot see this class of indicator (it matches only the
`outline` shorthand — a limit the code already documents).

### Non-blocking notes

1. **`theme.css`'s "Every OTHER consumer of this token is `:focus-visible`" is
   imprecise by one site.** `OutputPicker.css:74`'s `.output-picker__card--focused` is a
   JS/`aria-selected`-driven **state class**, not `:focus-visible` — DESIGN.md's own
   15/1/1 breakdown says so two paragraphs earlier. It does not make the bare-`:focus`
   claim false and it is not the CR1 failure mode (nothing enforces the opposite), but
   it is one more absolute in the most-shared file. Suggested minimal amend: "Every
   OTHER consumer is `:focus-visible`, except `OutputPicker.css`'s
   `.output-picker__card--focused` state class."
2. **DESIGN.md now says "no existing ticket owns a dead-CSS sweep of this file."** That
   was true when `4ce4a0fd` was written and became false ~4 minutes later when
   **HEL-1049** was filed. Same class as CR1, far lower stakes (a doc sentence about
   ticket ownership, enforced by nothing). Suggested one-line amend: "…so it is left in
   place, correctly described, and **HEL-1049** owns confirming and removing it."
3. DESIGN.md calls the bare-`:focus` site "a second, DIFFERENT kind of exception … in
   the same guard's whitelist". It is not an exception in the guard at all — the guard
   treats it identically to every `:focus-visible` site. The sentence corrects itself
   in its own next clause ("same as every `:focus-visible` site"), so this is wording
   only.
