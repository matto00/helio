## Skeptic Report — design gate (round 4, skeptic-design-4.md)

### What I verified (with evidence)

- **Model validated before use.** I rebuilt the derivation in Python with **JS half-up rounding**
  (`Math.floor(x+0.5)`), not Python banker's rounding. First pass with banker's rounding reported light
  Orange neutral **30%**, contradicting D5; the half-up model reproduces D5 exactly (30% -> `#ae510f` 4.4711
  FAIL, 31% -> `#ac4f0f` 4.5911). D5 stands; my first reading was the unstable one. The corrected model then
  reproduces **every** published table verbatim: light neutral 16/19/20/21/31/36/38/43, light +tinted
  23/25/26/27/35/39/41/45, dark +tinted 22/22/17/18/2/0/0/0, and D12's dark Orange **+14**. All numbers below
  come from that validated model.
- **Closure script re-run** from `frontend/src` in this worktree: **9 properties / 53 declarations**,
  reproducing round 3 exactly (`--app-accent, -dim, -mid, -strong, -surface, --app-bg-accent,
  --app-bg-secondary, --app-info, --toast-intent-color`), including `toast.css:90`/`:112`.
- **Sixth-route hunt (negative, recorded so it is not redone).** `color: color-mix(in srgb, currentColor N%,
  transparent)` exists at 8 sites — a real alpha-weakening route the closure structurally cannot see — but
  **all 8 are panel-content scoped** (`PanelContent.css:31/40/214`, `PanelGrid.css:217`, `ImagePanel.css:51`,
  plus 3 `scrollbar-color`), inheriting panel text, never accent. No `color: var(--x, fallback)` reaches
  accent. No `.tsx` sets an accent colour inline except `OrbitMark` (decorative, already recorded);
  `setProperty` has exactly one call site (`appearance.ts:446`, the token writer). No `-webkit-text-fill-color`
  / `text-decoration-color` / `text-emphasis` anywhere. **I found no sixth reachability route.**
- **D11 third version computed**, both themes, all 8 presets, against all five surfaces per theme.

### Verdict: REFUTE

Four findings. None is a new reachability route — the closure holds. All four are **the fix's own arithmetic
and its propagation into the mechanism**, i.e. the failure mode round 3 named.

### Change Requests

1. **(c) — introduced by round 3's fix. D11's "it costs nothing" is false, and the same decision contradicts
   itself.** D11 says scoring `::selection` "would be expensive: light Yellow **48%**, dark Cyan **23%**,
   Green **22%**, Yellow **12%**", then rules that adding the opaque hex to the scored set means "**every
   percentage it forces is already forced by D12, so it costs nothing**." Computed (validated model), adding
   the 26%/30% selection background on top of D12's set:

   | | Purple | Red | Blue | Pink | Orange | Cyan | Green | Yellow |
   |---|---|---|---|---|---|---|---|---|
   | light, +D12 (plan's set) | 29 | 32 | 31 | 33 | 39 | 43 | 44 | 47 |
   | light, **+selection** | 32 | 34 | 34 | 36 | 40 | 44 | 45 | **48** |
   | dark, +D12 (plan's set) | 28 | 28 | 25 | 25 | **14** | 3 | 0 | 0 |
   | dark, **+selection** | **35** | **36** | **33** | **35** | **29** | **23** | **22** | **12** |

   It costs +1 to **+22** points, and the resulting numbers are exactly D11's own "expensive" figures
   (48 / 23 / 22 / 12). The first half of D11 is right; the ruling sentence is wrong.

   **And the scoring is not merely expensive — it is unnecessary.** Task 4.6 has `::selection` set **both**
   properties, so accent text is *never painted on the selection background*: the selection's own `color`
   overrides it. Scoring it constrains the derivation for a case that cannot occur, at up to +22 points of
   hue shift the owner never ruled on.

   Required: (a) **remove the `::selection` background from task 2.2's scored set** and delete the "costs
   nothing" sentence from D11; (b) replace it with the check that *is* load-bearing — the **fixed pair**
   `::selection` colour vs. the opaque selection hex, asserted for 8 presets x 2 themes. I measured that pair
   (colour = `--app-text`) at **7.01 (dark Yellow on `--app-surface-strong`) to 14.11 (light Yellow on
   `--app-surface-raised`)** — it passes everywhere with margin, so this is a cheap guard, not a new problem;
   (c) resolve two under-specifications D11 leaves an implementer to guess: **which base the "flat hex" is
   mixed over** (light `--app-bg` `#f4f2ed` and `--app-surface-raised` `#ffffff` give different hexes), and
   **which "existing text token"** is the colour — if an implementer reads that as *the new accent-text
   token*, the expensive scoring comes back through the side door. State `--app-text` (or whichever) by name.
   Selection remains visible under this scheme: selection-hex vs. underlying surface is 1.10-1.60, never the
   round-3 1.000.

2. **(b) — repeat: a number corrected in one place and not propagated. Task 2.0's D4 perceptibility gate
   judges colours the plan no longer ships.** Task 2.0 says "Render the revised dark values (Red +22%,
   Pink +18%, Purple +22%, Blue +17%)". Those are the **`+tinted`** column. D12 — now correctly wired into
   task 2.2 — raises the shipped dark values to **Red +28, Pink +25, Purple +28, Blue +25** (and Orange 2 ->
   14). So the gate that exists specifically to decide "is the hue shift perceptible enough to re-escalate?"
   would render the wrong swatches and could return a false "imperceptible, proceed". Update task 2.0 and D4
   to the D12-inclusive values, and add **Orange (+2 -> +14, the shipped default)** to the four presets it
   judges — its adjustment grew 7x and it is not currently in the gate's list.

3. **(a) — new: the transitive-closure rule reached the inventory but not the guard.** D13's stated lesson is
   "the rule must be **transitive closure, not one hop**", and task 1.2 adopts the closure. But task **5.1**
   still specifies the guard corpus as *"must resolve accent aliases (`--app-info`) and cover
   `--app-accent-strong`-as-text"* — a hand-list of the two one-hop cases already known. A guard built to that
   letter would **not** see `--toast-intent-color` (two hops) and would go green on exactly the class that has
   now been missed twice. Rewrite 5.1 to require the guard corpus be built by **the same closure as task 1.2**
   (fixpoint over custom-property definitions), not by an enumerated alias list, and mutation-test it (5.4)
   with a **newly introduced two-level alias** so the closure property itself is exercised.

4. **(a) — new: "re-parse from `theme.css`, never hardcode" is unsatisfiable for the D12 tints.** Tasks 2.2
   and 5.1 both say to re-parse the surface hexes **and the tint percentages** from `theme.css`. The
   `--app-accent-surface` / `--app-accent-dim` percentages are indeed there, but the D12 percentages are
   **not**: 22% is `shared/chrome/BottomNav.css:126`, 20% is `features/sources/ui/AddSourceModal.css:84`/`:94`,
   10% is `features/sources/ui/InlineConnectorSetup.css:38`. As written the implementer either hardcodes them
   (the thing the task forbids) or parses a file that does not contain them. State that the inline-tint
   percentages are parsed from the **component stylesheets** (`color-mix(... var(--app-accent) N%`), which is
   also what keeps a future fifth inline tint from silently escaping the scored set.

### Non-blocking notes

- Record the closure's **stated limits** in task 1.2 rather than adopting it as unqualified truth: it matches
  `color: var(--x)` on a single line only — no `var(--x, fallback)`, no inline `color: color-mix(...
  var(--app-accent) ...)`, no multi-line declaration, no `currentColor` inheritance, no JS/inline styles. I
  checked all five categories against the tree and none is currently populated by an accent route, so this is
  documentation of a known blind spot, not an open defect. Adding the `currentColor` result to D12's
  "negative results" list would close the question permanently.
- `--app-bg-accent` and `--app-bg-secondary` appear in the closure's reaching set. They are background tokens;
  if the closure returns no `color:` declaration using them, say so explicitly in 1.2a so a later reader does
  not re-investigate.
