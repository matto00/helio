## Context

`synthesizeDemoPatchSet` (DEV builds only, `IS_DEV && !location.state.patchSet`) builds a title-only `update` edit
for the first dashboard's first panel: `{ title: \`${baseTitle(firstPanel.title)} (previewed)\` }`. Preview
(`POST /api/patch-sets/preview`) is read-only; Accept applies it. F-002 added `baseTitle` with
`PREVIEWED_SUFFIX_RE = / \(previewed\)$/`, which strips one occurrence. Its own test documents that
`"Revenue (previewed) (previewed)"` becomes `"Revenue (previewed)"`, so the re-appended title keeps the same count:
non-growing but non-converging.

## Decisions

### D1: Strip the whole trailing run of markers with an anchored, quantified regex

`/(?: \(previewed\))+$/`. Anchored at end, so a marker in the middle of a title (`"A (previewed) B"`) is untouched,
matching F-002's existing "trailing suffix only" semantics. No `g` flag needed (one anchored match). Linear-time:
the group is a fixed literal, no nested quantifier ambiguity (no ReDoS).

### D2: Probe at the page level, not only the pure function

The red probe renders `PatchSetReviewPage` through the demo path with a mocked first panel titled
`"Revenue (previewed) (previewed) (previewed)"` and asserts the patch set sent to `previewPatchSet` carries
`"Revenue (previewed)"`. The demo path is gated on `IS_DEV`, which the test file mocks `false`; the executor must
check how the existing test module mocks `config/env` and, if needed, override `IS_DEV` to `true` for this probe
only (e.g. a mutable mock or `jest.isolateModules`), without changing other tests' behaviour. If driving the page
proves infeasible, fall back to a pure-function probe asserting
`baseTitle(t) + " (previewed)"` has exactly one marker for t with 0..5 markers — but say so explicitly.

### D3: Update the existing single-strip test

Replace "strips a stacked suffix down to just the last occurrence" with a test asserting full strip
(`"Revenue (previewed) (previewed)"` -> `"Revenue"`), and add a mid-title marker case that stays unchanged.

## Risks / Trade-offs

- A user-chosen title that legitimately ends in " (previewed)" loses it in the demo rename — same trade-off F-002
  already accepted for one marker; DEV-only.

## Gate-chain

No `.husky/**` or pre-commit-invoked script is touched.

## Planner Notes

- Self-approved: `skip_specs: true` (DEV-only fixture, no spec covers it; inventing a requirement would be noise).
- Grepped `frontend/src`, repo-root `e2e/`, `frontend/e2e/`, `helio-mcp/src`: only `PatchSetReviewPage.test.tsx`
  depends on the single-strip behaviour (the test D3 updates).
