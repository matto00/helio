## Skeptic Report — design gate (round 3, skeptic-design-3.md)

Artifacts at `afc6a81a`. Base `main` @ `a6bde0d3`. Every number below was computed by me
from the literal hexes in `frontend/src/theme/theme.css`; scripts and raw output are in
`.concertino/runs/HEL-1048/evidence/skeptic3-*` (main checkout).

### What I verified (with evidence)

- **Complete mechanical enumeration of accent-as-text sites.** Wrote a transitive-closure
  scan (`skeptic3-accent-text-closure.py`, output `.txt`): fixpoint over every CSS custom
  property whose *definition* reaches `--app-accent` at any depth, then every `color:`
  declaration valued at one of them. Result: **9 reaching properties**, **53 declarations**
  = 42 `--app-accent` + 8 `--app-accent-strong` + 1 `--app-info` + **2 `--toast-intent-color`**.
  Confirms the design's 42 and 8 exactly. The 2 toast sites are new (F1).
- **Complete enumeration of the D12 background route.** `grep -rnE "(background|background-color)\s*:.*color-mix\([^)]*var\(--app-accent\)"` returns exactly the four
  declarations D12 names (`InlineConnectorSetup.css:38`, `AddSourceModal.css:84`/`:94`,
  `BottomNav.css:126`) and nothing else; no gradient/`background-image` route exists.
  **Clean negative: there is no fifth background class.** Round 4 need not redo this.
- **Independent re-derivation of D3's dark `+tinted` column** (`skeptic3-d.js`):
  Purple 21 / Red 22 / Blue 18 / Pink 18 / Orange 2 / Cyan 0 / Green 0 / Yellow 0 — matches
  the design's 22/22/17/18/2/0/0/0 within ±1 (lighten-rounding model). D3 is sound.
- **D12's cost claim** (`skeptic3-e.js`, `-d.js`) — see F3; reproduced, but not for the
  stated reason.
- **D11 candidates (a) and (b)** measured (`skeptic3-g.js`, `-h.js`) — see the ruling.
- **Base/hover collapse sweep** across all 53 sites by selector (see F5).
- `--app-bg-accent` (7%/5%) and `--app-bg-secondary` (4%/3%) are accent tints too, but both
  are strictly lighter than `--app-accent-dim` (8%/10%) and the contrast is monotone in tint
  alpha in both themes' regimes, so D2's scored set already bounds them. **Clean negative.**

### Verdict: REFUTE

Three items would produce a wrong implementation or a false green. The plan is otherwise
sound and F6–F8 are notes, not blockers.

---

## THE D11 RULING YOU ASKED FOR: **(b), the brand-preserving option — and (a) as written is defective.**

I did not rule for (a), and the reason is not brand cost.

**Option (a) as specified makes the selection indicator invisible.** `::selection { background: var(--app-bg); color: var(--app-text); }` paints selected text in `--app-text` on
`--app-bg`. Any text that is *already* `--app-text` on `--app-bg` — the page background, the
single most common text/surface pairing in the app — becomes **pixel-identical when selected**
(contrast of the selection background against the underlying surface = **1.000**,
`skeptic3-g.js`). The user gets no selection feedback at all. That is a worse accessibility
outcome than the hue shift it was avoiding, and it is exactly the D11 failure mode repeating:
the justifying numbers (14.963 / 16.435) are **correct** — they are the selected-text contrast —
and **silent** on the pairing they break. Third instance of that shape on this lane.

So the brand-cost escalation question is moot: (a) is not shippable on its own terms, and no
owner escalation is needed to decline it.

**(b) is concretely derivable, and it collapses into D2 rather than adding machinery.**
Do not build a second derivation. Instead:

1. Emit an **opaque** selection-background token per theme:
   `light = composite(accent 26% over #f4f2ed)`, `dark = composite(accent 30% over #121110)`
   — the existing `--app-accent-mid` percentages (`theme.css:174`/`:225`), resolved to a flat
   hex in TypeScript so it does **not** composite over whatever is beneath. Opacity is what
   makes the pair determinate; that is D11's own correct lesson, just applied to (b).
2. Add that single opaque hex to **D2's scored background set**. Then
   `::selection { background: var(--app-accent-selection); color: var(--app-accent-text); }`
   reuses the one text token — no second token, no second derivation, and D11 stops being a
   separate class.
3. Because `::selection` sets **both** properties, the 34 `--app-accent-ink`-on-accent-fill
   pairings are replaced wholesale and cannot regress. That was round 2's real finding and (b)
   honours it as fully as (a) did.

Measured cost of folding selection into the scored set (`skeptic3-h.js`, full set =
neutrals + 11/8/15/10 tints + D12's 22/20/10 + selection):

| | Purple | Red | Blue | Pink | Orange | Cyan | Green | Yellow |
|---|---|---|---|---|---|---|---|---|
| light | 29% `#773caf` | 32% `#a32e2e` | 32% `#2858a7` | 34% `#9c3065` | 39% `#98460d` | 43% `#036879` | 44% `#136e35` | 47% `#7c5f04` |
| dark | 28% `#c085f9` | 28% `#f37878` | 25% `#6ca1f8` | 25% `#f176b3` | **14% `#fa8737`** | 3% `#0db8d5` | 0% | 0% |

Selection **adds nothing** over the D12-inclusive set in either theme — every column above is
already forced by D12. (b) is therefore free relative to a design that honours F2.

Residual obligation on (b), to be checked visually, not by table: the opaque selection
background must be distinguishable from the surface it overlays. Dark is comfortable
(`#572e12` vs `#121110`–`#262320`). **Light Yellow `#f1e2b1` against `--app-surface-soft` `#efece6` is the tight case** — a chroma delta, not a luminance one. Verify it on the running
app; if it reads as no-selection, that is the one place (a)'s neutral pair would come back as
a fallback, and *that* would be the moment to escalate the brand cost.

---

### Change Requests

1. **[new] Two accent-text sites are invisible to every pattern in tasks 1.1/1.1a, and they
   fail today.** `shared/ui/toast.css:90` (`.toast__icon`) and **`:112` (`.toast__action`)**
   render `color: var(--toast-intent-color)`, and `.toast--info` (`toast.css:72`) sets
   `--toast-intent-color: var(--app-info)` → `--app-accent` (`theme.css:181`/`:232`). A
   **two-level** alias chain: greps for `var(--app-accent)`, `var(--app-accent-strong)` and
   `var(--app-info)` all return zero here. `.toast__action` is a semibold underlined text
   button at `--text-xs` on `background: var(--app-surface-strong)` (`toast.css:33`) —
   unambiguously normal text. Measured on that surface (`skeptic3-c.js`):
   **light `#ffffff`** — Purple 3.957, Red 3.763, Blue 3.678, Pink 3.527, Orange **2.803**,
   Cyan 2.428, Green 2.279, Yellow 1.918: **all eight fail**;
   **dark `#262320`** — Purple 3.950, Red 4.153, Blue 4.249, Pink 4.431 fail.
   Info toasts are live (`MfaSecuritySection.tsx:68`).
   *Fix:* add both sites to the inventory and repoint them; and see CR4 for the method that
   would have found them.

2. **[new] D12's tints are diagnosed but never enter the scored set, so the plan as written
   ships the shipped default failing AC-1.** Task 2.2 scopes scoring to "the five neutral
   surface tokens plus `--app-accent-surface` and `--app-accent-dim`". Task 1.1a(c) only
   *enumerates* D12's 20%/22%/10% tints; no task scores them, fixes them, or defers them with
   an owning ticket. The owner ruled `fix-here` on accent-tinted surfaces and AC-1 says "every
   surface it renders on". Concretely (`skeptic3-f.js`): with task 2.2's set, dark Orange —
   the shipped default — derives **+2% `#f9761b`**, which measures **4.161** against
   `AddSourceModal.css:84`'s 20% tint over `--app-surface-strong`. It needs **+14%** to reach
   4.678. *Fix:* add the D12 tint percentages (22/20/10) composited over each neutral to task
   2.2's scored set — or, if any is to be left unscored, say which, why, and which ticket owns
   it (AC-4). Do not leave the third option (silence) available to the implementer.

3. **[new] Task 2.0's perceptibility gate no longer covers the right set.** It names Red +22,
   Pink +18, Purple +22, Blue +17. Under CR2 the correct dark values are Purple **+28**, Red
   **+28**, Blue **+25**, Pink **+25**, **Orange +14** and Cyan +3. D12's own text says its
   cost takes dark Orange from +2% to +14% and I reproduce that (`skeptic3-e.js`), yet Orange
   is absent from the gate. *Fix:* task 2.0 must cover **Purple, Red, Blue, Pink and Orange**,
   with Orange called out as the shipped default, and its stated percentages updated to the
   post-D12 numbers rather than the D3 ones.
   *Sub-note on D12's supporting prose:* the "+2% to +14%" total is right, but the
   attribution is not. I computed the BottomNav lozenge specifically — 22% accent over the
   nav's own `--app-surface` 55%-over-`--app-bg` plate (`BottomNav.css:59`), composite
   `#161513` — and it costs **nothing** (dark Orange stays at +2%, `skeptic3-d.js`). The
   driver is `AddSourceModal.css:84`/`:94`'s 20% tint over the light modal surfaces. Correct
   the sentence, or state explicitly that the scored set assumes every inline tint over every
   neutral (a defensible conservative choice — but say so, because the two readings give
   different answers).

4. **[repeat, third occurrence of the D9/D10 shape] Task 1.2 still says "produce the set by
   script and state the method" without stating one.** Hand counts have been 5, 12, 16, 18;
   tasks 1.1/1.1a give three literal token greps, and those three greps demonstrably miss CR1.
   *Fix:* specify the method as a **transitive closure to a fixpoint** over custom-property
   definitions reaching `--app-accent`, then `color:` declarations valued at any member. I
   have written and run it: `.concertino/runs/HEL-1048/evidence/skeptic3-accent-text-closure.py`,
   output `…-closure.txt`. It returns **9 properties / 53 declarations** and finds all three
   previously-missed classes plus CR1 without being told about any of them. Adopt it verbatim
   as task 1.2's method and as the guard corpus's resolver (task 5.1's "resolve accent
   aliases" is currently satisfiable by a one-level `--app-info` lookup that would still miss
   the toast).

5. **[new] Adopt the D11 ruling above** — replace task 4.6 and D11's closing paragraph with
   option (b) as specified, and record that (a) was rejected for the invisible-selection
   defect (contrast 1.000 against `--app-bg`), **not** for its brand cost. As written, task 4.6
   instructs the implementer to ship (a).

### Non-blocking notes

- **Answer to the base/hover question (D9/task 4.4): only one more pair exists, and it is a
  false positive.** Sweeping all 53 sites by selector, the only base+hover pairs both landing
  in the accent set are `SidebarBody.css:46`/`:55` (already covered) and
  `AddSourceModal.css:85`/`:95`. The latter is *deliberately* identical — `:95` is an
  F-071 specificity-restoration rule (see the comment at `:88`) whose whole job is to make the
  hovered `--active` pill look like the unhovered one. Repointing both is correct there;
  say so in task 4.4 so 4.4's "check every other repointed site" does not cause someone to
  invent a spurious hover treatment. Every other accent-text rule is hover-only over a
  non-accent base, so repointing preserves a real delta.
- Task 4.4 describes `SidebarBody.css:46`/`:55` as two `--app-accent-strong` sites; `:46` is
  actually `--app-accent` and `:55` is `--app-accent-strong`. Harmless (the collapse is real
  either way), but the design should not carry a wrong fact.
- Task 7.2 hardcodes Yellow light as `#856605` (43%). Under CR2 it becomes **47% `#7c5f04`**;
  the ticket's whole "measured facts" table and D3's light row also shift (light Orange
  31→39%). Capture the derived value the implementation actually emits, not the contact-sheet
  value, or the final-gate artifact will be evidence for a colour that never shipped.
- The owner's `accept-hue-shift` ruling was directional and I do **not** read these larger
  light values as needing re-escalation on their own — but D4's escalation gate should be
  restated to cover "the shipped values drifted from the contact sheets in **both** themes",
  not dark only.
