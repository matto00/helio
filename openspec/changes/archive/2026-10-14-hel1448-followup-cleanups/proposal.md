## Why

HEL-1448 turned on the typescript-eslint recommended rules and left four small follow-ups: two declared-but-unread
props/options, a duplicated e2e type pair, a redundant cast, and a lint guard that never looks at test-file config.
The guard gap is the real one: an override that disabled a TS rule only for tests would pass silently.

## What Changes

- Remove the unread `draftAppearance` prop from `CommandBar` and the unread `syncStepsFromServer` arg from
  `usePipelineStepCreation`, plus their call sites. No behaviour change (neither value is read).
- Move the identical `EchartsInstance`/`ReactFiber` type pair (3 e2e specs) into one `e2e/support/` module, imported
  type-only.
- Drop the redundant `as AbortSignal` in `usePipelineRunEvents.test.ts`.
- Extend `scripts/check-eslint-ts-rules.mjs` to probe test-file paths, with an exact named exemption for the
  documented jest `no-require-imports` allowance; add a red selftest case.

## Capabilities

### New Capabilities

### Modified Capabilities
- `eslint-typescript-rules-guard`: the guard requirement now covers test-file paths too.

## Non-goals

- Deduplicating the React-fiber walk function itself (HEL-1377 owns that).
- Unifying the spec-specific `EchartsInstance` shapes in hel1305/1306/1311/1508.
- Touching hel1444/hel1512 specs (open PR #1016 edits them).
- Any change to lint rule policy.

## Impact

frontend/src/app/{App,CommandBar,CommandBar.test}.tsx; frontend/src/features/pipelines/hooks/
{usePipelineStepCreation,usePipelineStepStructure,usePipelineRunEvents.test}.ts; three e2e specs + one new
e2e/support module; scripts/check-eslint-ts-rules{,.selftest}.mjs (run by .husky/pre-commit and CI).
