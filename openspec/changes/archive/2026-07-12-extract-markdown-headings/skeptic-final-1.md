## Skeptic Report — final gate (round 1)

### What I verified (with evidence)

**Ground truth re-established**
- `git diff main...HEAD --stat` — 33 files, additive-only diff (new files + small appends to
  enumeration sites), matches `files-modified.md`'s claimed shape.
- Read `ticket.md` in full and traced every AC below to code/behavior I inspected myself.

**AC 1 — ATX heading extraction, 1-6 `#`**
- `backend/.../steps/ExtractHeadingsStep.scala`: `HeadingPattern = "^(#{1,6})\\s+(.*)$".r`,
  `extractHeadings` normalizes `\r\n`→`\n`, splits lines, collects matches, `level = hashes.length`,
  `title = title.trim`. Matches the ticket's literal spec exactly.

**AC 2 — one row per heading, text + level metadata**
- `ExtractHeadingsStep.apply`: `rows.flatMap { ... extractHeadings(...).zipWithIndex.map { row + (field -> title) + (indexField -> idx) + (levelField -> level) } }`.
- `ExtractHeadingsStepSpec.scala` (87 lines): mixed-level extraction, `\r\n` normalization, trim,
  no-heading drop, null-field drop, absent-field drop, custom field names, last-write-wins collision
  — all real, non-tautological assertions on concrete input/output pairs.
- Live UI: added/expanded the "Extract headings" step on the `Eval SplitText Pipeline` (real
  `string-body` source), selected `content`, clicked "Preview data" — table rendered `headingIndex`,
  `headingLevel`, `content` (replaced with title text), plus untouched passthrough fields
  (`filename`, `sizeBytes`, upstream `segmentIndex`). Output exactly matches ticket AC 2.

**AC 3 — apply/infer parity, analyze must not 500**
- Independently re-ran the exact regression class: `PipelineAnalyzeRoutesSpec` new test
  `"return 200 ... extractheadings step (regression: analyze 500 on extractheadings)"` — asserts
  200, correct `inputSchema`/`outputSchema`, `validationError` None.
- Verified via my own live browser session: `browser_network_requests` filtered on `analyze` showed
  3 fresh `GET /api/pipelines/.../analyze` calls, all `200 OK`, while the pipeline had the
  `extractheadings` step attached.
- **This is the exact bug class HEL-219 shipped with in cycle 1** (missing `AnalyzeStepResponse`
  arm). Confirmed by direct diff inspection that HEL-220 adds the parallel arm in
  `PipelineProtocol.scala` (`ExtractHeadingsAnalyzeStepResponse` case class, `jsonFormat6`, both
  read/write match arms) AND in `PipelineService.toAnalyzeStepResponse`
  (`case Success(cfg: ExtractHeadingsConfig) => ExtractHeadingsAnalyzeStepResponse(...)`).

**All 8 backend enumeration sites — checked directly against the diff, not trusted from any report:**
1. `PipelineStep.scala` — Registry entry + `PipelineStepKind.ExtractHeadings` val — present.
2. `package.scala` — `type`/`val ExtractHeadingsStep`, `type`/`val ExtractHeadingsConfig` aliases —
   present.
3. `PipelineStepConfigCodec.scala` — `extractConfig`/`encodeConfig` match arms — present.
4. `PipelineStepProtocol.scala` — `ExtractHeadingsStepResponse` case class, format, `fromDomain`,
   both read/write union arms — present.
5. `PipelineStepRepository.rowToDomain` — match arm — present.
6. `PipelineAnalyzeService.scala` — `"extractheadings" => inferExtractHeadings(...)` dispatch +
   the function itself (validates string-body, appends two integer fields, identity fallback on
   error) — present, semantics match the design/spec exactly.
7. `PipelineProtocol.scala`'s separate `AnalyzeStepResponse` ADT — own case class, `jsonFormat6`,
   both match arms — present (the exact site HEL-219 missed).
8. `PipelineService.toAnalyzeStepResponse` — dispatch arm — present.

All 4 frontend sites checked: `pipelineStep.ts` (types + `PipelineStepConfig`/`PipelineStep`/
`AnalyzeStepResult` union members), `stepNarrowing.ts` (`OP_TYPES` entry with `faHeading` icon,
`defaultConfigFor`, `extractHeadingsConfigOf`), `StepCard.tsx` (renders `ExtractHeadingsConfig`),
`useStepCardState.ts` (state + `onExtractHeadingsChange` + persist wiring) — all present and
correctly wired.

**AC 4 — allowedOps via new migration, next free version**
- `V51__add_extractheadings_op.sql` drops/re-adds `pipeline_steps_op_check` listing all 12 kinds
  including `extractheadings`. Confirmed via `ls backend/.../db/migration` (sorted) that V51 is the
  next free version after `splittext`'s V50, and confirmed on `main` (`git log --oneline -5 main`,
  separate directory) that no V51 exists there — no collision risk.
- Fresh `sbt test` run (see below) shows Flyway migrating a clean embedded-Postgres instance through
  V51 successfully (`Successfully applied 51 migrations ... now at version v51`).

**AC 5 — Frontend StepCard UI, wired into picker, gated to string-body**
- Live UI: opened the "+ Add transformation step" menu — "Extract headings" appears with its own
  icon. Clicked the field dropdown on the added step — listbox showed **only** `content` (the
  `string-body` field), correctly excluding `filename`/`sizeBytes`/`segmentIndex` from the same row
  schema. This directly exercises the gating logic in `ExtractHeadingsConfig.tsx`
  (`analyzeSchema.filter((f) => f.type === "string-body")`).

**AC 6 — CONTRIBUTING.md / DESIGN.md**
- No inline FQNs (all imports top-of-file, checked `ExtractHeadingsStep.scala`,
  `PipelineProtocol.scala`, `PipelineService.scala` diffs directly).
- `ExtractHeadingsStep.scala` is 107 lines — well under budget.
- No new CSS — `ExtractHeadingsConfig.tsx` reuses `.pipeline-detail-page__splittext-config`/
  `__compute-field`/`__compute-label` and the shared `Select` component (confirmed by reading the
  file — no new class definitions, no hardcoded colors/spacing).
- Light/dark parity: screenshotted the expanded step card + preview table in both themes — correct
  token-driven theming in both, no washed-out contrast, consistent with sibling `SplitText` step
  card (same shared classes).

**Fresh gate re-verification (my own runs, not the evaluator's pasted output):**
- `sbt testOnly` on the 8 targeted specs: **186/186 passed**, V51 applied cleanly.
- Full `sbt test`: **1219/1219 passed**, 0 failures — no regressions beyond the targeted specs.
- `npx jest --testPathPatterns=ExtractHeadingsConfig`: **3/3 passed**.
- `npm run lint` (full `src`, zero-warnings policy): clean.
- `npx openspec validate extract-markdown-headings --strict`: valid.
- Live browser session: servers started/healthy via `scripts/concertino/start-servers.sh` +
  `assert-phase.sh servers` (PASS), 0 console errors throughout the session.

### Verdict: CONFIRM

The evaluator's PASS holds up under independent, adversarial re-verification. Every one of the 8
backend + 4 frontend enumeration sites is genuinely present with the correct shape (I read each
diff hunk myself, not merely the evaluator's line-count claims). The exact HEL-219 bug class (missing
`AnalyzeStepResponse` arm) is closed here, confirmed both by a fresh regression test I re-ran and by
my own live network trace showing repeated `200 OK` on `GET /api/pipelines/:id/analyze`. The op's
behavior matches the ticket's literal acceptance criteria (ATX headings 1-6 `#`, one row per heading,
text + level metadata, string-body gating) — verified via unit tests, an engine-level integration
test, and a live end-to-end preview producing correct output. Migration V51 is the correct next
version with no conflict against main. Tests are concrete input/output assertions, not tautologies.

### Non-blocking notes
- Same pre-existing decorative striped bar between step cards observed by the evaluator — confirmed
  present here too, unrelated to this diff (visible identically around the untouched `Split text`
  step card). Not a regression; a separate ticket if pursued.
- `PipelineProtocol.scala` is now ~258 lines; still under CONTRIBUTING.md's hard-split trigger, but
  worth a proactive split before HEL-221 (the third planned text op) pushes it further.
