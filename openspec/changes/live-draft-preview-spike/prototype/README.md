# HEL-1580 prototype (THROWAWAY)

Evidence for `docs/live-draft-preview.md` only. Nothing in `frontend/`, `backend/` or any build imports this directory
(`grep -r live-draft-preview-spike frontend backend` is empty). It has no npm dependencies; the drivers use the repo's
existing `playwright-core` through an absolute path.

- `index.html` – plain-JS page. Deterministic 1,000-row `runs` source (`date`, `status`, `duration_s`), the board's three
  steps (filter `duration_s >= T`, sort `date` asc, compute `duration_min = duration_s / 60`), a per-step row cache
  (recompute from the edited step down), and a render (step counts, 25-row table, SVG polyline, two metric tiles).
- `measure.cjs` – launches its own headless Chromium, runs 50 warm-up + 500 measured edits, unthrottled and 4x CDP CPU throttle.
- `transport.cjs` – local round-trip measurements against this worktree's backend (creates then deletes its own fixtures).
- `results-*.json` – raw outputs of the runs quoted in `../measurements.md`.

## What the prototype includes vs a faithful port

Included: a real tokenizer + Pratt parser for the compute expression (parsed on every evaluation of that step, so parse
cost is counted); numeric coercion in filter; a stable sort with the backend's numeric-tier-before-lexicographic idea and
nulls last; null propagation and divide-by-zero to null; the per-step cache.

Deviations: column references are bare identifiers (`duration_s / 60`, as the board draws them) whereas the real strict grammar requires `$duration_s / 60`.

Omitted (so the number is optimistic): the full expression language (15 functions, boolean/comparison operators,
three-valued logic, the legacy bare-identifier fallback, date functions), `round` half-up on the shortest decimal
(the grammar rounds half away from zero on the decimal form, `round(-2.5)` = `-3`; the prototype uses `Math.round`, which gives `-2`, and only does so for a `round()` call the board does not use),
Java `Double.toString` in concatenation, the full filter operator set (`contains`, `is null`, `=`/`!=` numeric-vs-string
rules), per-value-type coercion of Scala `Int`/`Long`/`BigDecimal`, schema inference, and the assertion/AI/write-back
steps. The numbers are therefore a floor for the three board steps, not a bound for every step kind.
