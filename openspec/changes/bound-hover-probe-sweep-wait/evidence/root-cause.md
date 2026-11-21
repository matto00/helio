# HEL-1813 root cause

The sweep `page.waitForFunction` (spec line 37, polling "raf") samples a predicate `top <= 360 && bottom >= 366` on the
Select trigger once per frame while the sheet's `bottom-sheet-in` slide (280 ms, ease-out, ~828 px) moves it. The
trigger is 44 px high, so the true band is top in [322, 360], 38 px wide. Measured (probe `hel1813-probe.spec.ts.txt`,
run output `red-probe-run.txt`) per-frame travel at the band is 36-66 px at natural speed (close to the band width, so
a hit can land with a 1 px margin) and up to 111+ px under CPU throttle (wider than the band), so the band is hit or
missed by frame phase alone. Once the trigger rests at top=247 (above the pointer row) the predicate can never become
true again, so the wait (no timeout of its own) runs to the 240 s test timeout.

Evidence:
- Natural rate: 0/16 misses, but the one sample inspected hit with top=359 (a 1-px margin) between 409 and 323: luck.
- Forced (CDP CPU throttling x4 and x8, 32 runs): 7 misses (dark x4 4/8, light x4 2/8, light x8 1/8, dark x8 0/8); cpu x1: 0/16.
  a miss frame series is tops 409 -> 298 (a 111 px jump straddling [322,360]). Dark and light both miss: theme is not the discriminator.
- CI trace (run 44873260203 job 136752280174, dark): click ended 612014.8, waitForFunction began 612026.8 and never
  ended; sheet mid-slide in frame 612103 and at rest by 612330 (trigger y ~248). The sheet opened; the wait missed the window.
- No app code is implicated: the animation is correct; the spec sampled a moving target.
