# :273 "bars do not grow from zero after a type change" -- root cause (probe, 6x)

Red: `c3-final-6x-n10-a.txt` (2 of 10 fail at :273, Received 0.12420785804816227, no preload in the code), captured with
data in `flake-probe-6x-n70-with-273-captures.jsonl.txt` (2 of 70 probe runs; the probe spec is
`hel1651-flake-probe.spec.ts.txt`, the same flow with the assertion replaced by a dump).

What the recorder saw in a failing run (sum of drawn rect heights per animation frame, run-length compressed):
`293 (bars) -> 36 (the as-line state, ~1.2 s) -> 293 (the replayed bars)`. There is NO intermediate value: the bars did not
grow, they appeared at full height in one frame. The ratio 0.1242 = 36 / 293 comes from ONE sample, taken after `t0`
(the clock read just before `setOption`) but BEFORE zrender repainted: the recorder's `requestAnimationFrame` tick ran
ahead of zrender's own repaint in the same frame and still saw the previous (line) render, sum 36. On a fast host the
tick lands after the repaint, so the stale sample is absent. `longestSpanMs` was 0 and `appliedAnimationDuration` 0 in the
same runs: the entrance was not replayed. State not reached when the assertion fails: "the new option has been painted"
-- the assertion read a frame from before it.
