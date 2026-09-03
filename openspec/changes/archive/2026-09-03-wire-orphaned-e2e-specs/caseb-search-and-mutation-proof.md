# HEL-951 Case B candidate search + mutation proof

## P1 candidate pool (selectors swept by assertFloor/sweepSurface at 430px in
e2e/hel813-mobile-touch-target-floor.spec.ts, excluding assertExpanderFloor
and assertHiddenAtWidth selectors)

- `.mobile-nav-sheet__item` (surface 1, both widths)
- `.toast__close` (surface 3, both widths)
- `.ui-empty-state__cta` (surfaces 4 and 7, both widths)
- `.ui-select__trigger` (surface 5, both widths)
- `.ui-select__option` (surface 5, both widths)

(`.panel-list__zoom-button`/`.panel-list__zoom-reset` are swept only at
768px, not 430px — excluded by P1's "measured... at 430px" requirement.)

## P2/P3/P4 determination (runtime measurement + computed style, not grep)

| Candidate | P2 baseline (measured, 430px) | P3 height-floor/no-width-floor | P4 own rule | Verdict |
|---|---|---|---|---|
| `.toast__close` | n/a | mobile media rule sets BOTH `width: 44px` AND `height: 44px` — width IS floored | FAIL P3 | disqualified |
| `.ui-empty-state__cta` | n/a | mobile media rule sets `min-height: 44px` only (no width) | rule is `.ui-empty-state__cta, .ui-empty-state__secondary-cta { min-height: 44px; }` — comma-shared with a sibling selector | FAIL P4 | disqualified |
| `.ui-select__trigger` | passes (width: 100% container-driven; not measured live in this search, disqualification of siblings made a second live probe unnecessary once a P4-clean candidate was found) | `width: 100%` (no floor), `min-height: 44px` declared on its own rule in the mobile media block | own rule (not comma-shared in the mobile block) | qualifies on paper, not runtime-confirmed (superseded by `.mobile-nav-sheet__item`, which was) |
| `.ui-select__option` | same as above | same shape as trigger | own rule | qualifies on paper, not runtime-confirmed (superseded) |
| `.mobile-nav-sheet__item` | **measured 404x44 at 430px** (`e2e/zz-caseb-candidate-probe.spec.ts`, deleted after use) — both axes clear, computed `min-height: 44px`, `width: 404px` | height floor via `min-height: 44px` declared in the mobile `@media` block; width is 404px, driven entirely by the sheet's own width (no width/min-width declared anywhere on `.mobile-nav-sheet__item`) | `@media (max-width: 768px) { .mobile-nav-sheet__item { min-height: 44px; } }` — sole selector in that rule, not comma-shared | **QUALIFIES — selected** |

Search stopped at `.mobile-nav-sheet__item` once all four preconditions were
confirmed by live measurement; `.ui-select__trigger`/`.ui-select__option`
were not separately re-confirmed live since only one surviving control is
needed and `.mobile-nav-sheet__item` gave the cleanest, most directly
analogous replacement for the removed `.panel-list__add` (same shape: a
full-width block-level row/button with an own-rule height floor and no
width floor).

## Mutation-proof transcripts (task 6.6, D6 — one mutation, one observed
red, per assertion)

Repaired Case B has three assertions:
(a) `expect(redError).not.toBeNull()` — assertFloor throws on the mutated shape.
(b) `expect(mutatedBox.width).toBeLessThan(FLOOR)` — width axis genuinely red.
(c) `expect(mutatedBox.height).toBeGreaterThanOrEqual(FLOOR)` — height axis stays clear (epsilon floor, not bare 44).

### Mutation 1 — width:20px added to `.mobile-nav-sheet__item`'s mobile rule (proves a, b, c together under the real Case B scenario)

```
Running 1 test using 1 worker

[caseb-mutation1] box = {"width":26,"height":44,"visible":true} threw=true
  ✓  1 e2e/zz-caseb-mutation1.spec.ts:12:5 › mutation 1: width:20px added to .mobile-nav-sheet__item mobile rule (3.8s)

  1 passed (4.2s)
```

Rendered width measured 26px (CSS `width: 20px` plus content-box padding),
well below the epsilon floor (43.25px) — assertion (a) throws, assertion
(b) (26 < 43.25) holds, and assertion (c) (44 >= 43.25) holds — height stays
clear, exactly the wrong-axis shape Case B exists to catch.

### Mutation 2 — min-height shrunk to 20px on `.mobile-nav-sheet__item`'s mobile rule (proves assertion (c) is not vacuously true)

```
Running 1 test using 1 worker

[caseb-mutation2] box = {"width":404,"height":20,"visible":true}
  ✓  1 e2e/zz-caseb-mutation2.spec.ts:16:5 › mutation 2: min-height shrunk on .mobile-nav-sheet__item mobile rule (proves the height assertion is not vacuous) (4.2s)
```

Height genuinely drops to 20px (< the 43.25px floor) under this
independent mutation — demonstrating assertion (c) is a real, sensitive
check (it CAN observe a red), not a tautology that would pass regardless
of what happens to height.

Both throwaway mutation specs (`e2e/zz-caseb-mutation1.spec.ts`,
`e2e/zz-caseb-mutation2.spec.ts`) and the candidate probe
(`e2e/zz-caseb-candidate-probe.spec.ts`) were deleted after use; the CSS
mutations to `frontend/src/shared/chrome/MobileNavSheet.css` were reverted
and confirmed byte-identical to the pre-mutation original via `diff`.
`git status --short` was clean of both before proceeding.
