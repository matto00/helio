## 1. Frontend

- [x] 1.1 Add a `formatMetricValue` helper in `MetricRenderer.tsx` (or colocated module) that
      parses `data.value` to a `Number`; if finite, formats via
      `Intl.NumberFormat(undefined, { maximumFractionDigits: 2, useGrouping: false })`; otherwise
      returns the raw string unchanged.
- [x] 1.2 Use `formatMetricValue(data?.value)` in place of the raw `data?.value` in the metric
      value slot JSX; leave the `unit` span untouched.
- [x] 1.3 Add a code comment on `coerceNumber` in `frontend/src/utils/aggregate.ts` documenting
      the intentional `"Infinity"` divergence from Scala's `s.toDoubleOption` (per design.md
      Decision 2) — no behavior change.

## 2. Tests

- [x] 2.1 Add/extend `MetricRenderer.test.tsx` cases: long/repeating decimal rounds to 2 fraction
      digits; integer value renders unchanged (no added decimals, no thousands separator);
      non-numeric string value renders unchanged; `"Infinity"` string renders unchanged.
- [x] 2.2 Run `npm run lint` and `npm test` (frontend) and confirm no regressions in
      `aggregate.test.ts` or `MetricRenderer.test.tsx`.
