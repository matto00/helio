## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Cold spawn. Every conclusion below derives from the tree, the running app, or my own
re-computation — not from `evaluation-*.md`, `design.md`, or the executor's narrative.

### What I verified (with evidence)

**Ground truth.** `git log --oneline 736a8cbb..fb92b81d` (8 commits), `git diff --stat` (24 files).
Read the full source/doc diff excluding the guard, then the guard file in full (586 new lines).

**Gates, re-run explicitly in `frontend/` (not root `npm test`).**
`npm run typecheck` clean; `npm run format:check` "All matched files use Prettier code style!";
`npm run lint` clean (`--max-warnings=0`); `npm test` → **292 suites / 2963 tests passed**.
Root `npm run check:tokens` → "every `var(--*)` reference under …/frontend/src resolves."

**AC-2 / the guard is genuinely load-bearing — three real-tree mutations, each reproduced red.**
Not fixture-only; I mutated the shipped tree and re-ran `npx jest src/theme/focusRingTokenGuard`:
1. `inputs.css` `border-color` reverted to `var(--app-accent)` → RED ("every base declaring
   outline:none has a conforming :focus-visible indicator…"). Reverted.
2. Site 6's newly-added `border-color: var(--app-focus-ring-color)` deleted from
   `DashboardList.css`'s `.dashboard-list__rename-input:focus-visible` → RED. Reverted.
3. Deleted one of the two `AddSourceModal.css` pins → RED. Reverted.
`git status --porcelain` clean afterwards. HEL-1046's two pre-existing guard describes stay green.

**The two `AddSourceModal.css` pins.** Verified the split is mechanical, not a hole:
`AddSourceModal.css:146-161` really is a two-selector comma list with `outline: none` on the base
and only a bare `:focus` sibling (`border-color: var(--app-accent)`), so it fails both parts.
Pin matching is {file, exact base selector, exact count}; mutation 3 proves it is not slack.
`PanelDetailModal.binding.css:137` correctly needs no pin — I read it: it declares
`outline: var(--app-focus-ring)`, not `outline: none`.

**Deferrals are real (read all three tickets in Linear, not the change's summary of them).**
- HEL-1052 covers `AddSourceModal.css`'s orphan and its AC explicitly states HEL-1050's guard pin
  "does not survive this ticket in either case". (It says "pin" singular while two ship — but the
  guard's exact-count assertion goes red if only one is removed, so this is self-enforcing.)
- HEL-1051 covers site 7's user-chosen-surface residual, including the "a test that varies the
  accent but not the surface cannot find a defect whose variable is the surface" trap.
- HEL-1049 covers `PanelDetailModal.binding.css`'s `type-search`/`type-list` orphan.

**AC-1, independently reproduced on the running app.** Self-authenticated first:
`curl localhost:6482/src/features/panels/ui/grid/PanelGrid.css | grep -c HEL-1051` → 1, and
`inputs.css` served with `border-color: var(--app-focus-ring-color)`. Then, light theme,
`--app-accent` inline = `#f97316`, ring `#db6513`, 1.4s settle:
`.dashboard-list__filter-input` focused → `border rgb(219,101,19)` on `background rgb(239,236,230)`
(`#efece6`, `--app-surface-soft` — the **binding** light surface, not `#ffffff`) → **3.028**,
matching the report's row exactly. Dark: `rgb(219,101,19)` on `rgb(22,21,20)`.
I re-derived the whole preset table myself in Python against `FOCUS_RING_SURFACES` and reproduce
DESIGN.md's per-preset darkening exactly (Red/Purple/Blue 0%, Pink 1%, Orange 12%, Cyan 18%,
Green 21%, Yellow 28%) and Yellow's `--app-accent-strong` light figure as **2.775 ≈ 2.78**.
Scanned `measurement-report.md` for sub-3.0 values: the **only** one is 2.48 (site 7,
non-default mid-grey panel background) — exactly task 5.4's single permitted carve-out, recorded
with its number and HEL-1051. Site 7 on default appearance is measured at 3.4815 (not exempt,
clears). Minimum elsewhere 3.010 (Cyan/light). No other value waved through under that framing.

**Citations audited (the "true conclusion on false support" hunt).**
Verified as *accurate*: `appearance.ts:320-333` `FOCUS_RING_SURFACES` really is ten literal hexes;
D7's "2.58–2.99" is exactly the extremes-derived shortfall range I recomputed (2.577/2.578/2.591/
2.602/2.992); `theme.css` really is `76%, black` / `78%, white`; DESIGN.md's "Measured need per
preset" block exists and reproduces; `AccentPicker`'s only call site really is `SettingsPage.tsx:62`
and the quoted stale F-169 popover comment really says what it is said to say; `ticket.md`'s
`premise-validation.md` exists (in the durable `.concertino/runs/HEL-1050/evidence/`).
Three did **not** hold — see Change Requests 1–3.

**UI cohesion, judged against the running app in both themes (screenshots in
`.concertino/runs/HEL-1050/evidence/skeptic-*.png`).**
- `skeptic-light-filter-focused.png` / `skeptic-dark-filter-focused.png`: the derived ring reads as
  a deliberate accent border in both themes, clearly stronger than the neutral
  `--app-border-strong` hover border and clearly distinct from the unfocused
  `rgba(242,239,233,0.09)`. Parity holds; nothing looks like a different visual dialect.
- `aria-invalid` stays distinguishable: `--app-error` `#f07561` + `--app-error-surface` halo vs the
  ring `#db6513` + `--app-accent-dim` halo. (With the *Red* preset the ring `#ef4444` sits close to
  `#f07561` — but that is unchanged from pre-change behaviour, where the border was the raw accent,
  so it is not a regression this diff introduces.)
- **The `AccentPicker` collision is genuinely fixed, verified visually on the worst case.** Drove
  the real picker to Red (DOM `--app-accent` and `--app-focus-ring-color` both `#ef4444` — the
  zero-darkening equality), then keyboard-Tabbed focus onto the *unselected* Blue swatch
  (`matches(':focus-visible') === true`). Focused = `#fff 2px, #ef4444 4px, rgba(33,29,25,.2) 6px`;
  selected = `#fff 2px, #ef4444 4px`. `skeptic-accentpicker-zoom-light.png` and
  `-dark.png` show the two states are plainly different to the eye in both themes. No escalation
  needed; no surface outside this diff needs touching.
- Methodology note: the documented hazard is real — my Red pick changed the DOM accent but did not
  persist (a reload restored Orange). It did not affect the collision judgement, which is a
  live-DOM property, but it confirms the warning.

**No console errors observed** across the light/dark, dashboards/settings navigations above.

### Verdict: REFUTE

The code is right. Every mechanism check, every gate, AC-1's margins, the guard's
falsifiability, the deferrals, and the visual cohesion all hold up under independent re-derivation,
and I would ship the CSS/TS diff as-is.

What I am refusing is the **documentation carried by a change whose entire subject is a true
conclusion resting on false support**. I found a third instance of exactly that pattern (CR-3),
plus a self-contradiction in the binding design standard (CR-2), on top of the known wrong number
(CR-1). All three are text-only, need no re-measurement, and are cheap in the final-gate loop.
On CR-1 specifically, since I was asked to make the call rather than inherit it: **no, it is not
acceptable.** A knowably wrong contrast figure, sitting permanently in a source comment, inside the
one change that exists to stop wrong contrast figures, is not a triviality — it is the defect class.

### Change Requests

1. **`frontend/src/shared/chrome/AccentPicker.css` — the "~1.05:1" figure is wrong.**
   `--app-surface-strong` against `--app-bg` in light is `#ffffff` vs `#f4f2ed` = **1.119**, not
   ~1.05 (dark is `#262320` vs `#121110` = 1.207). Correct the number in the comment, and state
   which theme it is for. The same wrong figure is repeated in
   `openspec/changes/accessible-input-focus-indicator/files-modified.md` (the AccentPicker bullet's
   "Cycle 3" sentence) — fix both. The comment's *conclusion* (a `--app-surface-strong` outer layer
   is near-invisible on an `--app-bg` backdrop) is unaffected and stays.

2. **`DESIGN.md` §8 — the new "the 3:1 obligation binds on whichever mechanism" bullet
   mischaracterises its own site list, and contradicts the two bullets that follow it.**
   It says the "ten sites (…)" "painted the raw, undarkened `--app-accent` as a border or shadow
   instead — measuring 2.38–2.80 in light". Three problems:
   - `PanelGrid.css`'s title input painted **`--app-accent-strong`**, measuring 3.93 (Orange) /
     2.78 (Yellow) — *this same section says so three bullets later*.
   - `DashboardList.css`'s always-bordered rename input painted **no accent border on focus at
     all** (halo-only, 1.08) — *also stated in the next bullet*.
   - The parenthetical enumerates **nine** items for "the ten sites" (sites 8 and 11 are the same
     element, which a reader cannot infer from the doc).
   Reword so the binding standard is not self-contradictory: state the ten sites as "suppressed
   `outline` and conveyed focus by a border/shadow instead", and attribute the 2.38–2.80 figure to
   the raw-`--app-accent` family specifically rather than to all ten. (HEL-1046's own text in this
   file explicitly records its miscounts; this bullet should meet the same bar.)

3. **The "the ticket's 1.63:1 does not reproduce" premise correction is itself false support — and
   the ticket's original number was right.** Carried in `ticket.md` (Premise validation §3),
   `design.md` ("Site 11 is the ticket's own headline number" and D-preamble), and
   `.concertino/runs/HEL-1050/evidence/measurement-report.md` (task 2.3).
   The argument is "2.377 *is* that number, so it compares a value to itself", with a working
   hypothesis that the final gate measured `PipelineDetailPage.css:796` (`--app-accent-mid` vs
   `--app-surface` dark = 1.644). That argument silently assumes the Orange preset. Re-derived
   here: the pre-change raw `var(--app-accent)` focus border against `--app-surface-soft` `#efece6`
   in light measures Orange 2.377, Cyan 2.059, Green 1.933, **Yellow `#eab308` = 1.627**. So
   **1.63:1 reproduces exactly**, on precisely the element the ticket named (`inputs.css`'s focused
   text input), in the theme it named — just for a non-default preset. It was never a
   value-compared-to-itself and it was almost certainly not `PipelineDetailPage.css:796`.
   Correct all three artifacts: record 1.627 (Yellow, raw accent vs `--app-surface-soft`, light) as
   the reproduction, retire the "compares a value to itself" claim and the
   `--app-accent-mid`/1.644 hypothesis (keep 1.644 as the separate, unrelated base-border figure it
   is). Task 2.3's live-app finding — the footer input is `autoFocus`-mounted so its unfocused base
   border is unreachable — is correct and should be kept as-is.

### Non-blocking notes

- The 8×2 sweep measures only the `inputs.css` border+halo mechanism (via the `DashboardList`
  filter input); the `AccentPicker` box-shadow mechanism has no numeric row of its own. It is
  covered arithmetically (its backdrops `--app-bg`/`--app-surface-strong` are both inside
  `FOCUS_RING_SURFACES`) and I verified the painted values live, so this is a completeness gap in
  the report, not a coverage gap in the fix.
- HEL-1052's AC says "guard pin" singular where two ship. Self-enforcing via the exact-count
  assertion, so no action needed — noted only so the next reader is not surprised.
- `evaluation-3.md` is untracked in the worktree (the only dirty path). Orchestrator's call, not a
  code issue.
- With the Red preset the focus ring (`#ef4444`) sits close to `--app-error` (`#f07561`). Unchanged
  by this diff (the border was the raw accent before), but it is a real accent-vs-error proximity
  worth a ticket someday.
