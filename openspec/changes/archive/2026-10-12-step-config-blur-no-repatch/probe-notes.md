# HEL-1507 probe notes

## Enumeration (task 1.1)

`grep -rn onBlur frontend/src/features/pipelines --include=*.tsx` (non-test), 8 hits:

| Site | Re-emits step config on blur? |
| --- | --- |
| `ui/stepConfigs/ConvertFormatConfig.tsx:120` Destination field | yes |
| `ui/stepConfigs/ComputeFieldConfig.tsx:67` Output field name | yes |
| `ui/stepConfigs/ComputeFieldConfig.tsx:82` Expression | yes |
| `ui/stepConfigs/UpsertSourceConfig.tsx:187` New source name | yes |
| `ui/stepConfigs/AggregateConfig.tsx:252` | no, sets local touched state only |
| `ui/PipelineDetailFooter.tsx:179` | no, pipeline-name edit mode toggle |
| `ui/outputEditor/ConditionalFormatsField.tsx:219,234` | no, output editor `onTouch` |

## Live probes (tasks 1.2 / 2.4)

Own servers (dev 6939, backend 9846), throwaway `@example.test` users, Playwright (chromium) intercepting
`PATCH /api/pipeline-steps/:id`. Per field: (a) fill, wait 1.5 s (past the 400 ms debounce), blur by clicking
a heading, wait 1.5 s; (b) click the field, blur, no edit. Scripts and raw logs: `.concertino/runs/HEL-1507/evidence/openspec/changes/step-config-blur-no-repatch/probe/` (persisted via
persist-evidence.sh).

| Field | Scenario | Before (PATCH count) | After |
| --- | --- | --- | --- |
| convertformat Destination field | edit then blur | 2, byte-identical bodies | 1 |
| convertformat Destination field | focus, blur, no edit | 1 (unedited config re-sent) | 0 |
| compute Output field name | edit then blur | 2, identical | 1 |
| compute Output field name | no edit | 1 | 0 |
| compute Expression | edit then blur | 2, identical | 1 |
| compute Expression | no edit | 1 | 0 |
| upsertsource New source name | edit then blur | 2, identical | 1 |
| upsertsource New source name | no edit | 1 | 0 |

All four fields reproduce the duplicate PATCH before the fix, so all four are in scope (the ticket's "not probed
live" compute and upsertsource are now confirmed). The no-edit case is worse than the ticket described: a bare
focus-then-blur re-sent the whole config (the second bullet in each pair) even with nothing edited.
Paste was not separately probed; React's controlled `onChange` listens to `input` events, which paste fires.

## Throwaway-user cleanup

Two users created (one per seed run), deleted by exact (id, email) with `buildUserDeleteSql`:
- `109c447c-f9e2-40a7-ae2f-e8b8b47d8d28` hel1507-probe-1791868012021@example.test
- `29c3bdc5-10ed-4ad3-9445-fd3a7949a1c5` hel1507-probe-1791868112451@example.test

Post-delete `SELECT count(*)` for those ids or `hel1507-probe-%` emails: 0 (`.concertino/runs/HEL-1507/evidence/openspec/changes/step-config-blur-no-repatch/probe/HEL-1507-cleanup-transcript.txt`).

## Red/green unit evidence (tasks 2.1 / 2.2)

With the three components reverted to pre-fix: 12 failed / 34 passed (`.concertino/runs/HEL-1507/evidence/openspec/changes/step-config-blur-no-repatch/probe/HEL-1507-jest-red.txt`; StepCard cases
fail on call counts 2 vs 1 and 1 vs 0). With the fix: 5 suites, 220 passed, including the unchanged
`useStepCardState.characterization.test.ts` (`.concertino/runs/HEL-1507/evidence/openspec/changes/step-config-blur-no-repatch/probe/HEL-1507-jest-green.txt`).
