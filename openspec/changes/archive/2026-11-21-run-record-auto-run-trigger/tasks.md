## Standing Constraints

- [C1] The run-history seam spec seeds omitted-Option shapes (succeeded run with no errorLog; queued/running run with no completedAt/rowCount) and goes through the real route + protocol writer; never fill every Option to make validation pass
- [C2] The AC 1 red shows manual/scheduled/external records validating and the auto-run record failing at /triggerSource; red runs are committed as .txt before the fix they precede

## Tasks

### Backend

- [x] 1.1 Write the run-history seam spec (four sources + omitted-Option shapes per C1, real route, schema validation
  asserting error location, fixture compare); run on the CURRENT schema; commit red output (i) as `.txt`
- [x] 1.2 Drop `completedAt`/`rowCount`/`errorLog` from the schema's `required` (+ "omitted when not set" descriptions);
  re-run; commit red output (ii) as `.txt` (only auto-run fails, at `/triggerSource`)
- [x] 1.3 Add `auto-run` to the enum and the schema `description`; regenerate the shared fixture
  `shared-test-fixtures/pipeline-run/run-history-response.json` with `HEL1815_WRITE_FIXTURE=1`; green
- [x] 1.4 Mutation: drop `scheduled` from the enum, confirm red, restore (record result)

### Frontend

- [x] 2.1 Export `TRIGGER_SOURCES` const array + derived `TriggerSource` in `pipelineStep.ts`; use it on `PipelineRunRecord`
- [x] 2.1a `normalizeRunRecord`: default omitted `completedAt`/`rowCount`/`errorLog` to `null`
- [x] 2.2 Type `triggerSourceLabel.ts`'s label map as `Record<TriggerSource, string>`; keep the fallback for `string` input
- [x] 2.3 `TimelineMark.tsx`: replace `TRIGGER_WORD` with `triggerSourceLabel`

### Tests

- [x] 4.1 Frontend contract test: shared fixture through `fetchRunHistory` -> omitted fields `null`, every
  `triggerSource` in `TRIGGER_SOURCES` with a known label; schema enum equals `TRIGGER_SOURCES` (red first)
- [x] 4.2 TimelineMark test: an `auto-run` mark's details read `Auto-run` (red first)
- [x] 4.4 Run the full affected spec files: backend new spec + PipelineRunRoutesSpec, frontend pipelines/home suites; lint, typecheck, format

## Evidence notes

- Red (i): `red-1-spec-vs-current-schema.txt`; red (ii): `red-2-spec-after-required-relaxed.txt` (only auto-run fails, at `$.triggerSource`); frontend red: `red-3-frontend-contract-and-timeline.txt`.
- Mutation 1.4: dropping `scheduled` from the enum fails 2 of 5 spec cases (enum equality and record validation); restored.
