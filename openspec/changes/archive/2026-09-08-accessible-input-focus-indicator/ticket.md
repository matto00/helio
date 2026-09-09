# HEL-1050: Focused text inputs indicate focus with a raw-accent border at 1.63:1 in light theme

## Description

Found by HEL-1046's final gate while hunting a fresh axis after the `outline`-based focus indicators were fixed. **Pre-existing; not introduced by HEL-1046, and not fixable within it.**

Focused text inputs set `outline: none` and indicate focus with a border in the raw `--app-accent` instead. HEL-1046's scope was ruled to the focus **ring** — the `--app-focus-ring` token and the `outline` declarations consuming it. This is a different mechanism, invisible both to that fix and to its whitelist guard, which reasons about `outline` and has nothing to say about `border` or `box-shadow`.

It is also a genuinely different decision. HEL-1046 could be settled on measurement because a theme-independent focus-ring colour exists at 3:1. A border on an input is a persistent, modality-independent indicator — `DESIGN.md` §8's own carve-out explicitly names *"a text input showing it's the one accepting keystrokes… an accent border, not an outline ring"* — so the fix must reckon with why a border was chosen there in the first place.

## Premise validation (corrections to this ticket's own claims)

Validated against `main` @ `736a8cbb` before branch derivation. Full record: `.concertino/runs/HEL-1050/evidence/premise-validation.md`. **Verdict: minor-staleness — corrected inline, no escalation.** Three corrections bind on this work:

1. **Size — "`inputs.css` plus four further copies" is wrong.** There are **11** `outline: none` sites in `frontend/src/**/*.css`, spanning **four distinct indicator mechanisms**, not five copies of one recipe:
   - *Accent border + `--app-accent-dim` halo* — `shared/ui/inputs.css:39`, `DashboardList.css:75`, `:144`, `:355`, `auth.css:107/113`
   - *Halo only, no border change* — `DashboardList.css:687`
   - *Border-bottom only, halo explicitly suppressed* — `PanelGrid.css:244`
   - *Border only, halo suppressed* — `PipelineDetailPage.css:805`, `AddSourceModal.css:156/160`
   - Plus `AccentPicker.css:19`, a **base-rule** suppression with its own `:focus-visible` at `:36`.

   **Four of the eleven are base-rule `outline: none`**, not focus-state declarations — a more dangerous shape, since they remove the outline unconditionally rather than replacing it in a focus state.

   **Design gate round 1 reduced this to 10 live sites.** `AddSourceModal.css`'s `cell-input`/`cell-select` have **zero markup references** — orphaned CSS, owned by **HEL-1052** (filed specifically for it) rather than edited (D9). A grep-derived inventory is not a rendered-instance inventory, which is the ticket's own stated constraint.

2. **Composition — the indicator is a border PLUS a halo.** `box-shadow: 0 0 0 3px var(--app-accent-dim)` accompanies the border in the largest family. The halo is measured at **1.08:1 (light) / 1.14:1 (dark)** against its surface — `--app-accent-dim` is an 8–10% alpha tint, so it contributes essentially nothing and must not be counted as part of the indicator.

3. **Magnitude — CORRECTION (skeptic final-gate cycle): the headline 1.63:1 DOES reproduce exactly, and the paragraph below (kept for the record, not deleted) was wrong to say otherwise.** The original claim — that raw `#f97316` (Orange) measures 2.377–2.803 in light and "the ticket contrasts 1.63 against 'the 2.38 that made HEL-1046 Urgent' — but 2.377 *is* that number, so it compares a value to itself" — silently assumed the Orange preset. It does not hold for every preset: raw `--app-accent` vs `--app-surface-soft` (`#efece6`) for **Yellow** (`#eab308`) measures **1.6266**, which **is** the ticket's 1.63:1, on precisely the element (`inputs.css`'s raw-accent border) the ticket named. The "compares a value to itself" argument is retracted — it never accounted for the accent being user-selectable, and the ticket was more accurate than this correction of it. The `--app-accent-mid`/1.644/`PipelineDetailPage.css:796` hypothesis below is also retracted (downgraded to "almost certainly the wrong candidate") — it was chasing a coincidental near-match to an already-mistaken target number, not the real source. **What does NOT change:** the defect itself was always real regardless of which preset or element produced 1.63 — 2.377–2.803 in light (Orange) is already below the 3:1 floor, so the fix (D1 onward) required no revision. Only the diagnosis of "why 1.63 specifically" was wrong, and is corrected here rather than left standing.

   **[Original, now-superseded text, kept verbatim for the record — do not read this as still endorsed]:** "Raw `#f97316` (which renders in *both* themes via the inline-style path) measures **2.377 – 2.803** against the five surface tokens in light, and 5.576 – 6.729 in dark. The ticket contrasts 1.63 against 'the 2.38 that made HEL-1046 Urgent' — but 2.377 *is* that number, so it compares a value to itself. Nearest reproduction found: `--app-accent-mid` vs `--app-surface` in **dark** = **1.644**, which is the base border of `PipelineDetailPage.css:796`. Working hypothesis: the final gate measured that element, not `inputs.css`. Resolve by computed-style measurement on the running app — not by argument."

   **The defect is unaffected and real:** 2.377–2.803 in light (and, for Yellow, exactly the reported 1.6266) is below the 3:1 non-text floor on every surface. Only the magnitude's assumed preset and the hypothesised element were misstated, and both are corrected above.

4. **Not claimed by the ticket, found during validation:** four sites indicate focus on bare `:focus` rather than `:focus-visible` (`auth.css:113`, `PipelineDetailPage.css:803`, `AddSourceModal.css:160-161`, `PanelDetailModal.binding.css:137`), contradicting HEL-1022's binding contract. **Scope question for the design gate to rule on explicitly — do not absorb silently and do not widen the diff by reflex.**

## Scope

- Decide how a focused text input should indicate focus accessibly: a derived accent border meeting 3:1, or reinstating an `outline` ring. If the latter, first establish **why `outline: none` was set** — check it was not working around a clipping or layout problem before removing it.
- Apply across the re-derived site inventory above, per mechanism. The four mechanisms may not want the same answer; do not force uniformity that the surfaces do not support.
- Decide whether HEL-1046's whitelist guard should be extended to cover `border`/`box-shadow` focus states, or whether a separate guard is the honest shape.

## Acceptance criteria

- **AC-1** — A focused text input's focus indicator clears **3:1** against its surface, in **both themes**, across **all 8 accent presets**, verified on the running app by computed style.
- **AC-2** — HEL-1046's focus-ring guard stays green, and `--app-focus-ring-color` remains theme-independent by construction.
- **AC-3** — If the fix requires a theme-aware derivation, **coordinate with HEL-1048 rather than duplicating it.** That ticket owns the theme-aware accent question and the proof that 4.5:1 cannot be met theme-independently. **HEL-1048 is owner-ruled NOT to be folded into this diff.**
- **AC-4** — Any site left unfixed is named explicitly with the reason, and carries a filed ticket. A silent omission fails this criterion.
  Known at planning time: `AddSourceModal.css` (orphaned → **HEL-1052**, which also deletes the guard pin this change ships for it); `PanelDetailModal.binding.css:137` (orphaned → HEL-1049); and **site 7's residual** — `PanelGrid.css`'s title input renders its indicator against a **user-chosen** panel background, which no single derived colour can guarantee at 3:1 (→ **HEL-1051**). Site 7 is still repointed to the ring token here, which is a strict improvement and removes the Yellow failure; it is simply not a closure.

## Constraints carried from HEL-1046

- **Route through `--app-focus-ring-color`**; do not reintroduce raw-accent focus states.
- **No bordered focus states reintroduced** where an outline would serve.
- **Size from rendered instances, not grep counts.** HEL-1046's site count was wrong three times before `git grep` settled it, and its rendered-instance count diverged sharply from its static one.
- **Measurement trap:** a too-fast probe (800–1200ms settle) reads the light accent as the dead `#ea580c`. Use a long settle and drive the real `AccentPicker` — accent is server-preference-backed, so writing `localStorage` exercises the wrong path.
- **Derive contrast against the BINDING surfaces, not the palette extremes.** For a mid-luminance colour the extremes (`#ffffff` / `#121110`) are the *easiest* surfaces. The binding pair is `--app-surface-soft` `#efece6` (L=0.8405) in light and `--app-surface-strong` `#262320` (L=0.0172) in dark. HEL-1046 got this wrong once; the extremes-derived values would have shipped a ring scoring 2.58–2.99 — that ticket's own defect passing its own proof.
