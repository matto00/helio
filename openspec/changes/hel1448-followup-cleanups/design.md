## Context

See proposal.md - Why. Premise validation (`.concertino/runs/HEL-1453/evidence/premise-validation.md` in the main
checkout) re-derived every item against main@2d815623f; all four still apply, none were already fixed.

## Goals / Non-Goals

**Goals:** behaviour-neutral removal of dead surface; one shared home for the duplicated e2e type pair; the lint guard
sees test-file config.

**Non-Goals:** see proposal.md - Non-goals. No runtime, UI, or lint-policy change.

## Decisions

**D1 — Remove, not wire, `draftAppearance` (CommandBar).** History: HEL-724 (6ba9988be) added the prop; the draft
appearance is consumed in `App.tsx` via `DashboardAppearancePreviewContext.Provider value={draftAppearance}` and the
page-level `appearance` fallback, never inside CommandBar. CommandBar only needs `setDraftAppearance` (kept). HEL-1448
(a796c8e81) removed the unused destructure, proving no reader. Removing the type field and the two call-site
attributes (App.tsx, CommandBar.test.tsx) changes no rendered output. Wiring it would have nothing to drive.

**D2 — Remove, not wire, `syncStepsFromServer` (usePipelineStepCreation).** At extraction (HEL-1340, 05004f85b) the
hook used it; HEL-1345 (f4601ba2e) deliberately replaced the create-path full resync with applying the create
response's delta (see `PipelineDetailPage.draftCreate.test.tsx:419-420`: "a create-immediately add no longer
resyncs"), leaving the arg dead; HEL-1448 removed the destructure. Re-wiring would reintroduce a resync HEL-1345
removed on purpose. Remove from the args type and from the one caller (`usePipelineStepStructure.ts`), which keeps
its own `syncStepsFromServer` for its other consumers.

**D3 — e2e types: types only, three specs only.** New `e2e/support/echartsFiber.ts` exports `EchartsInstance` and
`ReactFiber` exactly as currently written in hel1304, hel1351 and hel1392-remount-staleness (byte-identical in all
three). Specs use `import type { ... } from "./support/echartsFiber"`. Type imports are erased, so nothing is
serialized into `page.evaluate`/`waitForFunction` closures (a value import used inside a browser closure would break
at runtime — that is why only types move). The fiber-walk function and the differently-shaped spec-local
`EchartsInstance` types in hel1305/1306/1311/1508 are left for HEL-1377. Alternative (do HEL-1377 here) rejected:
it changes runtime e2e code that needs a live browser run to verify, out of proportion for a Low follow-up.

**D4 — Cast.** `(fetchMock.mock.calls[0] as [string, { signal: AbortSignal }])[1].signal` is already
`AbortSignal`; drop the trailing `as AbortSignal`.

**D5 — Guard covers test paths: full-set parity with an exact allowance.** Add test probe paths to
`scripts/check-eslint-ts-rules.mjs`, each paired with its non-test baseline in the same package:
`frontend/src/__guard__.test.ts` -> `frontend/src/__guard__.ts`, `frontend/src/__guard__.test.tsx` ->
`frontend/src/__guard__.tsx`, `frontend/src/test/__guard__.ts` -> `frontend/src/__guard__.ts`,
`helio-mcp/src/__guard__.test.ts` -> `helio-mcp/src/__guard__.ts` (helio-mcp has 47 jest tests; every linted
package the guard already probes gets a test pair), `e2e/__guard__.spec.ts` -> `e2e/__guard__.ts`. For each pair, every `@typescript-eslint/*` rule active as an error on
the baseline (20 rules on the real config, measured by the design skeptic) must be an error on the test path too —
not just the 4 `REQUIRED_RULES` — unless the exact (test path, rule) pair is in a named allowance map. The map holds
only the one intentional exemption in `eslint.config.cjs`: `@typescript-eslint/no-require-imports` for the four
jest paths (frontend `.test.ts`/`.test.tsx`, `frontend/src/test/**`, helio-mcp `.test.ts`). The e2e spec path gets no allowance (Playwright specs keep
the rule). The existing `REQUIRED_RULES` check on baseline paths stays (it is what catches the broken spread, where
the baseline itself is empty). The lintText probe also runs against one test path.

**D6 — Red selftest.** New selftest case writes a tmpdir fixture that `require`s the real `eslint.config.cjs` by
absolute path and appends `{ files: ["**/*.test.{ts,tsx}"], rules: { "@typescript-eslint/no-explicit-any": "off" } }`;
asserts the guard exits non-zero and stderr names both a `.test.` path and `no-explicit-any`. A second red case does
the same with a recommended rule OUTSIDE `REQUIRED_RULES` (e.g. `@typescript-eslint/no-empty-object-type`), so the
selftest distinguishes a 4-rule implementation from the full-parity one. A third red case scopes the override to
`helio-mcp/**/*.test.ts` only, proving the helio-mcp pair is wired. Each case must be shown
red-first against the pre-change guard (it passes there, i.e. the selftest assertion fails), then green after.

## Gate-Chain Implications Checklist

`.husky/pre-commit` runs `npm run check:eslint-ts-rules` and `check:eslint-ts-rules:selftest`; both scripts change.

- **What does it execute?** `node scripts/check-eslint-ts-rules.mjs` (ESLint `calculateConfigForFile` + `lintText`,
  in-process, no child processes) and the selftest, which spawns that guard via `process.execPath` with a fixture path.
- **What environment does it inherit, and from where?** The hook's shell env; it resolves `eslint`/plugins via
  `createRequire` from the repo root `package.json`. No new env vars read.
- **Does it write anything outside its own sandbox?** The selftest writes one fixture under `os.tmpdir()` (mkdtemp) and
  removes it in `finally`, as today. The guard writes nothing. Probe paths are virtual (never created on disk).
- **Does it behave differently from a linted worktree than from a main checkout?** No: `repoRoot` derives from the
  script's own location, and the fixture requires the real config by absolute path from that root.
- **What happens on its first run?** Same as every run; no cache or state. Runtime grows by four
  `calculateConfigForFile` calls and one extra fixture spawn (seconds).

## Risks / Trade-offs

- [#1016 overlap: App.tsx/CommandBar.tsx] → edits are single lines in hunks not adjacent to #1016's; verify with a
  trial merge at Delivery and note in the PR body.
- [Fixture basePath with overrideConfigFile in tmpdir] → the existing selftest fixture already relies on cwd-relative
  globs with a tmpdir config; the new case requires the real config's globs to match the same way — verified by the
  green-real / red-fixture pair.

## Planner Notes

Self-approved: removal over wiring (D1/D2, history-backed, behaviour-neutral); types-only e2e move (D3).
