# HEL-777: DESIGN.md's sanctioned ::after hit-expander clause omits the gap/tiling constraint that makes it safe

## Description

HEL-772 (PR #409, merged `98862321`) added a clause to `DESIGN.md`'s Control-metrics section sanctioning a **sized** `::after` **hit expander** as an alternative to `min-width`/`min-height: 44px` for painted chrome controls that must not grow visually. That was needed because the product owner ruled that command-bar controls keep a 28px painted box and only the *hit area* expands to 44px.

The clause accurately describes the mechanism. It **omits the constraint that makes the mechanism safe**, and that omission is the actual defect here.

### The missing constraint

A 44px hit region around a 28px box extends **8px beyond the control on every side**. So any cluster of such controls must have a gap of at least 16px, or adjacent expanders overlap and the later-painted sibling wins the hit test in the overlapping band — silently truncating its neighbour's tap area.

This is not hypothetical. In HEL-772's own bar, `.app-command-bar__right` gapped its controls by `var(--space-2)` (8px). Measured with the expander applied and the gap left at 8px:

* `getComputedStyle(el, "::after").width` still reports a full **44px** — the naive check passes
* the **real** tap extent, bisected with `elementFromPoint`, is **35.75px** — well under the floor
* sampling neighbouring *painted boxes* for overlap reports **zero violations**, because the regions never reach a neighbour's painted box; they reach its *expander*

The fix in HEL-772 was to widen that gap to `var(--space-4)` (16px), at which the regions tile exactly (`294..338 | 338..382 | 382..426`, zero overlap).

### Why this matters beyond HEL-772

`DESIGN.md` is binding on all frontend work and is what the next person will read — they will not read HEL-772's `openspec` `design.md`, where the constraint *is* recorded. An incomplete rule in a binding document propagates silently: someone applies the sanctioned pattern to another dense mobile cluster, `getComputedStyle` tells them it is 44px, and the tap targets are quietly ~36px.

This is the same failure class HEL-774 spent a cycle on this session — a code comment citing a `DESIGN.md` exception that did not actually exist. Getting the written rule right is cheaper than catching each downstream misuse.

### Proposed change

Extend the `::after` clause in `DESIGN.md`'s Control-metrics section to state:

1. the expander extends `(44 - controlSize) / 2` per side (8px for a 28px control);
2. a cluster of expander-based controls needs a gap of at least twice that, or the regions overlap and steal taps;
3. `getComputedStyle(el, "::after").width` **cannot** detect the overlap, and neither can sampling neighbouring painted boxes — verification must bisect the real hit extent with `elementFromPoint`;
4. abutting regions legitimately bisect to just under 44px (~43.75 at a 0.25px sampling step), so the assertion threshold needs an epsilon — and the gap must **not** be widened past the tiling point to force the number over 44.

## Acceptance Criteria

- [ ] `DESIGN.md`'s `::after` clause states the per-side extension and the minimum-gap rule
- [ ] It states that computed `::after` size is not a sufficient check, and names the `elementFromPoint` bisection as the verification
- [ ] It notes the sub-44px reading for abutting regions and the epsilon, with the explicit warning not to widen the gap to compensate
- [ ] Wording is consistent with the existing Control-metrics section (the `44px` literal remains sanctioned there)

## Related

HEL-772 (origin), PR #409. HEL-774 (adjacent doc-carve-out failure class). HEL-778 (sibling, different scope — CSS selector scoping, not this prose).
