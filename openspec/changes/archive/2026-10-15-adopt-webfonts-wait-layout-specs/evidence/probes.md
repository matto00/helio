# HEL-1613 probes (task 1.1): hel1510 and hel813 surface 7

Method: scratch spec copies (`scratch/zzprobe1510.spec.ts.txt`, `scratch/zzprobe813.spec.ts.txt`, helper
`scratch/zzfontgate.ts.txt`) hold the `fonts.gstatic.com` responses on a promise per family (the family is read from
the live Google Fonts stylesheet body) and release them at named points; fallback-only aborts the stylesheet.
Probe note: with a held font a pre-load `page.goto` can hang (Chromium delays the load event for a pending font, observed
as 90 s timeouts before the probe used `waitUntil: "commit"`); that is a probe artefact, not a product or spec finding.

## hel1510 (card 0.1px overflow) -> font swap REFUTED

Asserted values, `limit` = Configuration card content-right + 0.5 and the control rights, 1100px:

| state | limit | max control right | modal body sw/cw | result |
| --- | --- | --- | --- | --- |
| baseline (live fonts) | 872.374 | 872.000 | 718/718 | pass |
| fallback-only (stylesheet aborted) | 872.374 / 872.298 | 872.000 | 718/718 | pass |
| all fonts held for the whole test | 872.298 | 872.000 | 718/718 | pass |
| all held, released after `limit`, no wait (x3) | 872.188, 872.188, 872.426 | 872.000 | 718/718 | pass x3 |
| all held, released after `limit`, settle | 872.374 | 872.000 | 718/718 | pass |
| all held, released after the controls loop (settle / no wait) | 872.188 / 872.298 | 872.000 | 718/718 | pass |
| one family held, released after `limit` / after controls (Schibsted, JetBrains Mono, Fraunces) | 871.811-872.374 | 872.000 | 718/718 | pass x6 |

Fraunces was exercised (as a held family) but the surface renders no Fraunces text, so that state equals baseline.
The `limit` varies by up to 0.69px between runs in EVERY state including fallback-only, so it is not font driven.
Competing cause, measured (`probe-1510b-*.log`, rAF samples of the card content-right after the long name is
visible): it is still moving during the first ~100ms, 871.53-871.87 rising to exactly 872.000, with and without
fonts, while the widest control sits at exactly 872.000 at rest. A `limit` sampled below 871.5 (the card's modal
entrance animation, not yet at rest, under CPU load) gives limit < 872.0, i.e. a ~0.1px overflow. That is consistent
with the ticket's symptom but was NOT reproduced as a failure here; it is reported as the likely cause and a follow-up,
not claimed. Verdict: the font-swap mechanism is REFUTED for hel1510; the spec is not converted.

## hel813 surface 7 (Connectors at 768/430) -> font swap REFUTED

Boxes measured per step (w x h), fonts live vs fallback: CTA 131.91x44 in both; dialog buttons 78.38x32 / 147.36x32
(fallback) vs 80x32 / 147x32; row trigger 28x28 in both; toolbar 129.91x32 vs 128x32. Heights are fixed; the floor
checks are `box.height < 44` (compact painted box) plus `bisectHitExtent` on a 44px `::after` expander and
`>= 43.25` rendered-box floors, none of which a 1.6px width change can move.
States exercised, each at 430 and 768 (`probe-813-*.log`): baseline; fallback-only; all held forever; all held and
released after the CTA sweep (nowait: 1 gate-artefact failure then 3 green reruns; settle), before the dialog bisect (nowait x3, i.e. the swap lands
during the dialog's `bisectHitExtent` loop), after the dialog (nowait, settle), before the row sweep (nowait x3), after
the row (nowait, settle); per family (Schibsted, JetBrains Mono, Fraunces) released after the CTA and after the dialog.
All pass. One run failed in a gate artefact (`probe-813-all-release-after-cta-nowait.log`: the test ended while the
probe's stylesheet fetch was in flight, `route.fetch: ... closed`); the gate was fixed to ignore that and the case
re-run 3x green. The row cells' JetBrains Mono is first requested after the row exists (logged `fonts=...JetBrains
Mono:loading` at the row step), as the design predicted, and the row/toolbar floors are still met. Verdict: REFUTED;
the spec and `touchTargetProbe.ts` are not converted. The original once-per-run 768 failure remains unexplained by
fonts (not reproduced); surfaced as a follow-up, not silently "fixed".
