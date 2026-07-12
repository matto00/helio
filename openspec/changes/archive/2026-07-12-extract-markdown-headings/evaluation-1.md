## Evaluation Report — Cycle 1

### Phase 1: Spec Review — PASS
Issues: none.

- All ticket ACs addressed explicitly: ATX heading extraction (1-6 `#`), one row per heading with
  text + level metadata, apply/infer parity (`GET /api/pipelines/:id/analyze` verified live — see
  Phase 3 — returns 200, not 500), allowedOps via new migration `V51`, frontend StepCard with
  field-selector gated to `string-body`. No AC reinterpreted.
- All 23 tasks.md items verified against the actual diff (not just checkbox trust) — every backend
  enumeration site and every frontend wiring site claimed in `files-modified.md` was independently
  confirmed present with the claimed shape (see Phase 2 for file:line evidence).
- No scope creep — diff is additive only (33 files, all either new or a small append to an existing
  enumeration site/list); no unrelated refactors.
- No regressions: targeted re-run of 186 backend tests spanning all 8 touched files plus the
  existing `splittext`/other-op assertions passed; full suite was reported clean by the executor and
  spot checks corroborate it.
- API contract: `schemas/`-equivalent OpenSpec deltas (`pipeline-extract-headings-op` ADDED,
  `pipeline-steps-persistence` MODIFIED) are present, `openspec validate --strict` passes, and both
  deltas' scenarios match the implemented behavior exactly (op name, config shape, output schema
  shape, migration version).
- Planning artifacts (design.md, tasks.md) match the final implementation; the design's decision 8
  "8 enumeration sites" claim was independently re-derived from the diff, not merely trusted.

### Phase 2: Code Review — PASS
Issues: none blocking.

- Canonical compliance (CONTRIBUTING.md): imports are all at top-of-file, no inline FQNs introduced;
  `com.helio.domain._`/`com.helio.domain.steps` wildcard-import pattern matches existing convention.
  File-size budget: `ExtractHeadingsStep.scala` is 107 lines (well under 250). One pre-existing-adjacent
  soft-budget note: `PipelineProtocol.scala` crossed from 247 → 258 lines (non-blocking — `check:scala-quality`
  reports it as a soft warning only, consistent with 40 other pre-existing soft-budget warnings in the
  codebase; the CONTRIBUTING.md hard trigger for "propose a split" is ~400 lines, not crossed).
- All 8 backend enumeration sites from design.md decision 8 verified directly against the diff:
  `PipelineStep.scala` (Registry + `PipelineStepKind`), `package.scala` (type/val aliases),
  `PipelineStepProtocol.scala` (`ExtractHeadingsStepResponse` + format + `fromDomain` + read/write
  union), `PipelineStepConfigCodec.scala` (`extractConfig`/`encodeConfig`),
  `PipelineStepRepository.rowToDomain`, `PipelineAnalyzeService.scala` (`inferExtractHeadings`
  dispatch + function), `PipelineProtocol.scala`'s separate `AnalyzeStepResponse` ADT (own case
  class, `jsonFormat6`, both read/write match arms — the exact site HEL-219 initially missed; present
  here), `PipelineService.toAnalyzeStepResponse` dispatch arm. All 4 frontend sites
  (`pipelineStep.ts`, `stepNarrowing.ts`, `StepCard.tsx`, `useStepCardState.ts`) also confirmed wired.
- DRY: `ExtractHeadingsConfig.tsx` reuses the shared `Select` component and the existing
  `.pipeline-detail-page__splittext-config`/`__compute-field`/`__compute-label` CSS classes rather
  than inventing new ones — no duplication introduced. Extraction logic is a single pure function
  (`extractHeadings`), unit-tested in isolation.
- Readable/modular: clear naming (`indexField`/`levelField`, `extractHeadings`), no magic values,
  small composable step class mirroring the established `SplitTextStep` shape.
- Type safety: config decode is tolerant (`StepCodecUtil.asObject` + per-field defaults) matching the
  established pattern; no untyped escape hatches beyond the pre-existing `Any`-typed row map
  convention already used by every other step in this codebase.
- Error handling: analyze-time validation surfaces `validationError` (not a 400) for unknown/
  non-string-body fields, matching `splittext`/`compute`'s established UX; malformed config is caught
  and surfaces a descriptive `validationError` rather than throwing.
- Tests meaningful: standalone `ExtractHeadingsStepSpec` covers mixed-level extraction, `\r\n`
  normalization, trimming, passthrough, null/absent-field drop, no-heading drop, custom field names,
  and the last-write-wins collision rule. `PipelineAnalyzeRoutesSpec` adds the regression test that
  would have caught HEL-219's exact bug class (missing `AnalyzeStepResponse` arm → 500) — verified by
  fresh re-run, not just executor claim.
- No dead code: no TODO/FIXME/console.log found in the diff (grepped directly).
- No over-engineering: single-behavior op, no unnecessary abstraction; frontend component has no
  mode toggle since the ticket has one behavior (correctly matches design.md decision 6).
- Fresh gate re-verification (independent of executor's report, per verification-before-completion):
  - `sbt testOnly` on the 8 directly-affected specs: **186/186 passed**, migration V51 applied
    cleanly to a fresh embedded-Postgres instance (`51 migrations ... now at version v51`).
  - `npx jest ... ExtractHeadingsConfig`: **3/3 passed**.
  - `npm run lint`: clean (zero warnings).
  - `npm run format:check`: clean.
  - `npm run check:scala-quality`: clean (soft warnings only, pre-existing pattern).
  - `openspec validate extract-markdown-headings --strict`: valid.
  - `npm run check:openspec`: flags the change as "complete but not archived" — this is the expected,
    disclosed `git commit -n` bypass; archiving is a downstream phase per this repo's workflow
    (confirmed HEL-219's own merged commit followed the identical pattern). Not a defect.

### Phase 3: UI Review — PASS
Issues: none blocking.

Servers started via `scripts/concertino/start-servers.sh` / `assert-phase.sh servers` — both PASS.
Exercised the feature live end-to-end (logged in, real Postgres dev data):

- **Happy path**: added an "Extract headings" step to a real pipeline over a `string-body` source
  (reusing HEL-219's leftover `Eval SplitText Source`/`Eval SplitText Pipeline` dev fixtures),
  expanded the step card, selected the `content` field, ran "Preview data" — produced correct output
  rows (heading title replacing `content`, `headingIndex`/`headingLevel` populated, passthrough
  fields (`filename`, `sizeBytes`, upstream `segmentIndex`) preserved unchanged). Matches
  design.md/spec scenario exactly.
- **Apply/infer parity — directly confirmed via network trace**: `GET /api/pipelines/:id/analyze`
  fired 4 times during the session (initial load + after each step-card interaction) and returned
  `200 OK` every time with the `extractheadings` step present in the pipeline — the exact bug class
  HEL-219 shipped with in its own cycle 1 does not reproduce here.
  - **Step picker entry point**: "Extract headings" appears in the "+ Add transformation step" menu
    with its own icon (`faHeading`), alongside all other ops.
  - **Field-selector gating**: dropdown correctly offered only the `string-body`-typed `content`
    field (verified by inspecting the listbox — no other upstream fields like `filename`/
    `sizeBytes`/`segmentIndex` appeared as options).
  - **Accessible names/keyboard**: "Content field to extract headings from" combobox, "Preview data"/
    "Remove step" buttons, and the step-card toggle button all exposed correct accessible names in
    the a11y tree; no unlabeled interactive elements.
  - **No console errors**: 0 errors across the full flow (add step → expand → select field → preview
    → light/dark toggle → breakpoint resizes); 1 pre-existing warning unrelated to this change
    (present before any interaction).
  - **Breakpoints (1440/1100/768/375)**: rendered without layout breakage introduced by this change.
    At 768/375 the persistent left sidebar overlaps main content — confirmed this is pre-existing,
    app-wide behavior unrelated to this diff (reproduced identically on pipelines/pages untouched by
    HEL-220, and the sidebar has an explicit manual collapse toggle already present at all widths);
    not a regression to flag against this change.
  - **Non-blocking observation**: a decorative striped/gradient bar renders above and below each
    step-card boundary (visible in both light and dark theme). Confirmed via reload/remove-step
    testing that this is **pre-existing** — it renders identically around the original single
    `splittext` step before `ExtractHeadingsConfig` was ever added, so it predates this change and is
    not introduced by this diff. Flagging only as a non-blocking observation for a separate ticket if
    it's actually a bug; out of scope for HEL-220's evaluation.

### Overall: PASS

### Change Requests
None.

### Non-blocking Suggestions
- Consider filing a follow-up ticket (unrelated to HEL-220) for the pre-existing decorative
  striped-bar rendering between pipeline step cards, observed independent of this change.
- `PipelineProtocol.scala` is now at 258 lines (soft budget 250, no action required yet, but the next
  op in this family — HEL-221 — will push it further; worth a proactive split before then).
