## Why

`e2e/hel1172-multi-denial-toast.spec.ts:105` fails intermittently in CI at its keyboard-order step (Tab from Alpha's
"Run to update" does not reach Beta's link, `Received: inactive`). It failed in both job attempts of run 45281484916 on PR #1252 (a CI-config-only diff; `playwright.config.ts`
sets `retries: 0`, so there was no Playwright retry), so it is a flake in the HEL-1172 surface or its spec, and it blocks unrelated PRs. The existing
`run-to-update-affordance` requirement already says a multi-denial toast's link and action "SHALL be reachable by Tab in
row order"; if a real keyboard user can hit the same failure, the product breaks that requirement.

## What Changes

- Probe-confirmed root cause of the intermittent focus loss, with recorded evidence (CI trace/error-context artifacts
  where retrievable, plus a local CI-like reproduction: a fresh-server cold-start loop in the leg-7 order, and throttled
  `--repeat-each` runs).
- A red rate (k failures in N runs under named conditions) recorded and committed before any fix, and the same
  conditions re-run after the fix with N large enough that zero failures is meaningful.
- The fix at the root cause: in the product (toast/row list/focus hand-off/CSS/store) if a real keyboard user can hit it,
  otherwise in the spec, never by adding waits or timeouts, and without weakening any unrelated assertion.
- A unit/e2e guard that fails on mutation of the fix.
- A weight row for `e2e/hel1172-multi-denial-toast.spec.ts` in `e2e/shard-weights.tsv` if the planner's conventions call
  for one.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

(none) — the fix restores the existing `run-to-update-affordance` requirement ("reachable by Tab in row order"); no
requirement text changes. `.openspec.yaml` sets `skip_specs: true`.

## Impact

- Frontend toast surface (`frontend/src/shared/ui/Toast.tsx`, `ToastRowList.tsx`, `toastFocusHandOff.ts`, `toast.css`,
  `features/toasts/state/toastsSlice.ts`, `features/pipelines/services/deniedPipelinesToast.ts`, form submit path) and/or
  `e2e/hel1172-multi-denial-toast.spec.ts`; possibly `e2e/shard-weights.tsv`.
- No backend change, no migration, no API/schema change.
- Unblocks HEL-1825's PR #1252 (not touched by this change).
