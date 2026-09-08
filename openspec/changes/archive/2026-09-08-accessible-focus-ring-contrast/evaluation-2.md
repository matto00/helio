## Evaluation Report — Cycle 2 (evaluation-2.md)

Delta reviewed: `abcbc2a9..29df7aae` ("Repoint 16 hand-copied focus-ring
outlines at the token (CR1-4)"), plus regression surface. Cycle-1 findings
re-checked where the delta could plausibly have disturbed them.

Content self-authenticated before every visual reading: the dev server on
:6478 serves `DashboardList.css` with **4** `outline: var(--app-focus-ring)`
occurrences and **0** `outline: 2px solid var(--app-accent)` — i.e. cycle-2
content, not a cached cycle-1 transform. (Counting note: Vite serves CSS as a
single-line JS module, so `grep -c` returns 1 regardless — I used
`grep -o | wc -l`. A `grep -c` here would have been a meaningless green.)
`location.href` re-checked at every reading; theme allowed 7s to settle;
accent read as the live server preference throughout.

### Phase 1: Spec Review — PASS

- **AC 1 is now met.** The cycle-1 failing site is fixed and I re-measured it
  myself (below). Every focus indicator in the changed set resolves the
  derived token.
- Scope discipline held: the delta is 9 component stylesheets (one line each),
  the guard file, `appearance.test.ts` cleanup, DESIGN.md, `files-modified.md`.
  No `--app-accent` value change, no `ThemeProvider` change, no accent-as-text
  work — **HEL-1048's scope is still untouched**.
- CR4 satisfied: DESIGN.md §8 now records that the "every component references
  one token" sentence was false when written, is true now, and names the
  single pinned exception. (One factual slip in that new text — see
  Non-blocking 1.)

**Closing out the cycle-1 count/enumeration mismatch, as asked.** The
executor is right that my report said "8 stylesheets" while my CR1 bullet list
named only 7 — `DashboardAppearanceEditor.css:112` was in my `grep -rln`
output but dropped from the enumeration. It found that site and fixed it.
Running the correct arithmetic against the base commit:

- `git grep` at `abcbc2a9` → **17** `outline: 2px solid var(--app-accent);`
  declarations across **8** stylesheets.
- The delta repoints **all 17** (`+17/-17`; DashboardAppearanceEditor 1,
  DashboardList 4, OutputPicker 1, PanelDetailModal.css 2, `.sections` 3,
  `.binding` 4, `.appearance` 1, TableDisplayFields 1).
- So the true figures are **17 sites / 8 files**, not 16/9. Of the 17: 15 are
  `:focus-visible`, 1 is a bare `:focus` (`PanelDetailModal.binding.css:138`,
  the type-search input), 1 is a state class (`OutputPicker.css:74`
  `.output-picker__card--focused`). My "15" counted only the `:focus-visible`
  subset; the executor's "16" is also one short. **Nothing was missed** —
  `grep -rn "outline:.*var(--app-accent" frontend/src/` returns 0, and the new
  whitelist guard now makes the count question moot by construction.
- The one remaining `solid var(--app-accent)` in `DashboardList.css:683` is a
  `border`, not an outline — correctly out of scope.

**Was the 16th/17th site genuinely a focus ring?** Yes.
`DashboardAppearanceEditor.css:112` is `.appearance-preset:focus-visible` — a
real keyboard focus indicator on the dashboard appearance preset swatches.
Converting `OutputPicker.css:74`'s state class rather than exempting it is
also the right call: `.output-picker__card--focused` is a roving-focus
indicator driven by keyboard navigation, so it carries the same 3:1
obligation; exempting it would have been the "exception that cannot expire"
the design gate spent three rounds rejecting.

### Phase 2: Code Review — PASS

Gates, all re-run by me from `frontend/` (never the worktree root):

| gate | result |
| -- | -- |
| `npm run lint` (frontend) | clean, 0 warnings |
| `npm test` (frontend) | 292 suites / **2952** tests passed (was 2949; +3 = the new guard's 3 tests) |
| `npm run format:check` | clean |
| `npm run typecheck` | clean |
| `npm --prefix frontend run build` | succeeded |
| `check:tokens` (HEL-1037) | OK |
| HEL-441 motion + HEL-442 elevation guards | green |

**CR1 — repointing is behaviour-preserving. Verified line-by-line.** Every one
of the 17 hunks changes exactly the colour half of the declaration and nothing
else. **Every `outline-offset` is preserved verbatim**, including the
deliberate carve-outs:
- `DashboardList.css:488` keeps `outline-offset: -2px` (the flush-list-item
  clip carve-out).
- `DashboardList.css:292`/`:330` and `PanelDetailModal.binding.css:138` keep
  `outline-offset: 1px`.
- The remaining 13 keep `2px`.
No site lost an offset, gained one, or changed width/style. `App.css:43`'s
`-3px`-adjacent `BottomNav` carve-out and the skip-link ring are untouched.

**CR2 — the whitelist is the right call, and it is genuinely failable.** I ran
six mutations, each verified as landed (`sed -n` echo) before running, and the
tree restored clean after each:

| mutation | expected | result |
| -- | -- | -- |
| A: reintroduce `var(--app-accent)` at `DashboardList.css:292` | RED | **RED**, names the file + exact declaration |
| B: hardcoded literal `#f97316` | RED | **RED** — *a blacklist would have missed this* |
| C: a different token `var(--app-accent-strong)` | RED | **RED** — *a blacklist would have missed this* |
| D: duplicate the pinned skip-link declaration in `App.css` (count 1→2) | RED | **RED** on the stale-exception test |
| E: pinned declaration text moved to a *different* file | RED | **RED** — pin is file-scoped |
| F: `var(--app-focus-ring-color)` used directly in an `outline` | ? | **RED** — the allow-regex requires the exact `var(--app-focus-ring)` closing paren, so the longer token name does not substring-match |

B and C answer your question directly: **the whitelist is strictly stronger
than the blacklist I asked for**, and the difference is not hypothetical — a
hardcoded hex and a wrong-token reference are both realistic future edits that
the blacklist I specified would have waved through. F is stronger than I
predicted; I expected a substring hole and there isn't one.

**Can the pinned-exception mechanism silently swallow a regression?** No, on
the two axes that matter. A pin matches on `{file, exact normalised
declaration text}` and asserts an **exact occurrence count**, so (D) a second
copy in the same file goes red, and (E) the same text in another file goes
red. Adding a second exception requires a code change carrying file, exact
declaration, count and a written reason — reviewable, not silent. The guard
also states its own CANNOT honestly (it does not prove a pinned exception is
accessibility-safe), which is the correct scope: the `App.css` skip-link pin
is a `var(--app-text)` ring measured in cycle 1 at very high contrast.

**CR3 — re-measured independently, and the executor's numbers reproduce.**

### Phase 3: UI Review — PASS

All readings: light theme, **Yellow** accent (the adversarial 28%-darkening
preset), set through the real Settings `AccentPicker` UI, 7s settle, real
`Tab` keypress, `:focus-visible` asserted `true`, contrast computed from the
**composited** ancestor background stack down to `--app-bg` (not from token
names, and not from a single possibly-translucent layer).

| element | painted `outline-color` | offset | composited bg | contrast |
| -- | -- | -- | -- | -- |
| `.dashboard-list__item-row .actions-menu__trigger` — **the exact cycle-1 1.87 site** | `rgb(168,129,6)` = `#a88106` | 1px | `rgb(253,252,250)` | **3.527** |
| `.dashboard-list__button` — the deliberate `-2px` inset ring, over an accent-tinted button | `rgb(168,129,6)` | -2px | `rgb(251,246,231)` | **3.347** |
| modal Close button (in-modal, keyboard-focused) | `rgb(168,129,6)` | 2px | `rgb(255,255,255)` | **3.616** |

**1.87 → 3.527 at the exact site I broke the cycle-1 verdict on.** The
executor's 3.53 and 3.62 both reproduce to three significant figures.

The second row is worth calling out because it is a surface the derivation
deliberately does **not** score against: `.dashboard-list__button`'s
background is an 8%-alpha accent tint, and the derivation excludes
accent-tinted surfaces to avoid deriving the ring against its own accent
(circularity). I composited it manually and it still clears at **3.347** —
so the exclusion is safe here empirically, not just by argument. It is the
thinnest real margin I found.

**Perceptibility — judged, not just checked.** For every element measured I
computed the ring's box (rect ± `outline-offset` ± 2px width) against every
`overflow: hidden|clip` ancestor and the viewport. **Zero clipping, zero
off-screen, on every repointed site I could reach**, including the `-2px`
inset ring (which is inset precisely so it cannot clip) and the in-modal
control inside the modal's scroll container. Contrast is necessary but not
sufficient, and here both hold. The clipping hits my cycle-1 sweep reported
remain confined to closed `.popover` subtrees, are identical on `main`, and
are untouched by a colour-only change.

No new console errors. Happy path (login → dashboards → panel detail modal →
settings → accent/theme switching) works; accessible names intact.

**Two-axes answer for this cycle.** *What no source text carries:* nothing new
that I could find — the delta's own DESIGN.md text is unusually candid about
the previous gap. *What path the gates did not exercise:* the `outline-color`
/ `outline-width` / `outline-style` **longhands**. See Non-blocking 2: I
mutated a site to `outline: var(--app-focus-ring); outline-color:
var(--app-accent);` and the guard **passed it**. There are currently **zero**
longhand `outline-*` colour declarations in the tree, so this is a latent hole
in a new guard, not a live defect — which is why it is a suggestion and not a
change request.

**Cohesion capture (NOT ruled on — final gate / owner).** Yellow still derives
to `#a88106`; now that 17 more sites paint it, the muted bronze ring appears
throughout the dashboard list and panel modal rather than only on token-using
chrome, so the gap between the ring and the yellow swatch the user picked is
more visible than it was in cycle 1. Screenshot:
`.concertino/runs/HEL-1046/evidence/eval-c2-light-yellow-repointed-ring.png`.
Recorded for the owner; explicitly not my call.

### Overall: PASS

All four change requests are satisfied, verified by my own re-run gates,
six landed mutations, and independent live measurement of the exact site
that failed cycle 1.

### Change Requests

None.

### Non-blocking Suggestions

1. **DESIGN.md's new paragraph has the count wrong** — it says "16
   `:focus-visible`/focus-state rules across 9 component stylesheets"; the
   true figures are **17 rules across 8 stylesheets** (verified by `git grep`
   at `abcbc2a9` and by the `+17/-17` delta). This is the same
   count-vs-enumeration slip that appeared in my cycle-1 report and in the
   executor's cycle-2 summary, now written into a canonical standard where it
   will outlive the ticket. Suggest correcting to 17/8 in the merge commit;
   the paragraph's substance is right and does not gate.
2. **Close the longhand hole in the adoption guard.** `OUTLINE_DECL_RE` only
   matches the `outline:` shorthand, so
   `outline: var(--app-focus-ring); outline-color: var(--app-accent);` passes
   (confirmed: 9/9 green under that mutation). Zero longhands exist today, so
   nothing is broken — but the guard's stated PROVES is slightly broader than
   what it does. Either extend the regex to
   `\boutline(-color)?\s*:` (with `outline-color`'s allowed values being the
   ring token or a pin) or narrow the in-file PROVES comment to say
   shorthand-only. The latter is a one-line honesty fix and consistent with
   how the file already documents its multi-line-declaration limitation.
3. `appearance.test.ts`'s `void label;` cleanup from cycle 1 is done correctly
   — noting only that the replacement comment now accurately points at the
   sibling test that does the pinning.
