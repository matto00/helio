## Skeptic Report — design gate (round 4, skeptic-design-4.md)

### What I verified (with evidence)

**Citations — all correct.** `theme.css:340` is `.sr-only`; `theme.css:322-324` is the
"feature CSS should use this shared class instead of redefining it locally" text;
`ActionsMenu.tsx:152` is `<div className="popover actions-menu">` with no `className`
prop; `DashboardList.css:238-248` is the resting `display:none` + 3-arm reveal rule
with `:focus-within` at 244; `App.css:519`/`604-609` hides `.app-sidebar` at <=768px;
`MobileNavSheet.tsx:419` is a comment, the file's only `ActionsMenu` occurrence. The
`AgentMemoryList.css:42` idiom the plan says to mirror exists (also
`PipelineListTable.css:9`). R1-R6 and D0a-D0d hold.

**Servers / freshness (CON-155).** `start-servers.sh` reported "already healthy …
reusing"; I did not accept that. `ss -ltnp` + `/proc/<pid>/cwd` shows 6435 -> this
worktree's `frontend`, 9342 -> this worktree's `backend`. Vite serves CSS from disk
per request.

**Probe negative control (D0d).** Ran my measurement probe first against the empty
dashboard list; it returned `{found:false, why:'no .dashboard-list__item-row'}`. It
can produce its negative result. (I then created one dashboard, "Skeptic probe", to
have a row to measure — it is still in the dev DB.)

**Measured, Chromium 1440x900, base ef3b7538, unmodified worktree:**
- rest: row button `215.00px`, wrapper `display:none`, trigger rect `0x0`
- `.focus()` on the resting trigger -> `document.activeElement === document.body`
  (defect (a) reproduced)
- reveal (`:focus-within` via row button): row button `187.00px`, trigger `24x24`,
  wrapper `clip:auto`, `overflow:visible`, `margin:0px`, `display:flex`,
  **`position: relative`**

So 215 / 187 / ~24x24 are confirmed. `position: static` is **not**.

**Simulated the plan's D1 in-browser (injected stylesheet, no file edits):**
- resting treatment alone, reveal rule untouched: `.focus()` -> TRIGGER (fix works),
  row button stays 215, and the wrapper stays `clip: rect(0,0,0,0)` even under
  `:focus-within` — round 3's green-but-broken outcome independently reproduced.
- reveal rule extended (display/position/width/height/margin/overflow/clip): row
  button returns to `187.00`, trigger rect `24x24` at `x=203` — identical to the
  original baseline reveal (`187.00`, `x=203`). **D1's host-CSS route is
  implementable and does restore the original geometry** (Q4: yes).

**Other re-confirmations.** `git diff --stat main...HEAD` is empty (only the untracked
change dir); highest migration is `V102__share_tokens_privileged_grant.sql` and none
is added; no `PipelineStepRepository`/pipelines-schema (HEL-973) or Connectors/REST
(HEL-845) file touched. HEL-1006 exists in Linear with the spun-off mobile scope.
Cross-artifact scan of all five artifacts found no leftover `.sr-only`-mandate, no
surviving "430 is the broken path", and no surviving "fails at both widths" — the
three round-3 blockers are substantively addressed. The defects below are new/residual.

### Verdict: REFUTE

Two of the three findings are the *same failure class* the plan has now shipped four
times: a binding criterion that correct code cannot satisfy, or that is green in
exactly the state it exists to catch.

### Change Requests

1. **`position: static` on reveal is a fabricated measurement, and a correct
   implementation fails it.** `ticket.md` AC 3a, `design.md` D1 ("Density, both
   states"), and `tasks.md` 2.7 all assert that on reveal the wrapper is
   `position: static`, and D1 calls these numbers "measured on this worktree and …
   binding checks, not illustrations". Measured on this worktree, the revealed
   wrapper's computed `position` is **`relative`**, from `Popover.css:1-3`
   (`.popover { position: relative }`). The same sentence demands the row "return to
   its pre-change hover geometry" — which is `relative` — so AC 3a contradicts itself,
   and an executor restoring the true baseline is failed by the criterion while an
   executor satisfying it deviates from baseline (and drops the `.popover` containing
   block). Replace `position: static` with `position: relative` in all three
   artifacts, and cite `Popover.css:1-3` as its source so it is not "corrected" back.

2. **"Trigger has a rendered rect of ~24x24" is vacuous — it is green in the broken
   state.** Measured with the resting treatment applied and the reveal rule NOT
   extended (the exact green-but-broken state AC 3a was written to catch), the trigger
   still reports `24x24`: `overflow:hidden` on a 1x1 wrapper clips paint, not the
   child's border box, and the trigger's own `width/height:24px` come from
   `DashboardList.css:250+`. This sub-criterion discriminates nothing — the same
   defect D4 correctly diagnosed in the `reachedAt` red arm. Either drop it or replace
   it with a genuinely discriminating paint check; the discriminating assertions in
   AC 3a are the row-button reflow to 187px and `clip: auto` (plus wrapper `position`,
   once #1 is fixed). Whichever is chosen, `tasks.md` 2.7 must say explicitly which
   assertion carries the discrimination, so it is not weakened to the 24x24 one under
   pressure.

3. **`specs/actions-menu-keyboard-access/spec.md` still says "at any viewport
   width".** The first requirement's scenario ("Focus restore from a dialog opened via
   the menu") reads "**at any viewport width**". Every other artifact now scopes this
   defect to above the 768px breakpoint, and R6 states in terms that a 430 criterion
   "would function as an instruction to un-hide the sidebar on phone". The second
   requirement carries the "binds only where the menu is actually rendered" qualifier;
   the first does not. Add the same qualifier (or scope the scenario to where the
   trigger is rendered). This is the one artifact of the five that still carries the
   refuted framing — precisely the forgotten-artifact pattern round 2 hit.

### Non-blocking notes

- Q2 (can I still construct a green-but-broken implementation?): after #1 and #2 land,
  no — I could not. Always-visible kebab fails AC 3 (rest would measure 187, not 215);
  `opacity:0`-but-laid-out fails AC 3 likewise; never-painted fails AC 3a's 187/`clip`
  assertions on both `:hover` and `:focus-within`. The hole is closed, but only by the
  reflow and `clip` assertions, not by the 24x24 one.
- The third reveal arm (`:has([aria-expanded="true"])`) shares the same rule block, so
  extending the rule covers it automatically; AC 3a testing only `:hover` and
  `:focus-within` is fine.
- AC 3a is verified once during delivery but is not covered by the permanent Playwright
  guard (AC 4 is programmatic-focus only). Consider adding the 187px reflow assertion
  to the same spec file as a non-discriminating no-regression check, labelled as such
  per D4.
- A "Skeptic probe" dashboard was created in the shared dev DB to obtain a row to
  measure; harmless, but the executor will likewise need at least one row.
