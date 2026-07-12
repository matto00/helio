## Skeptic Report — design gate (round 1)

### What I verified (with evidence)

1. **Ticket AC scoping** — Read `ticket.md` (AC list, lines 45-58). `design.md` decisions 1-6 and
   `proposal.md`'s "What Changes" map 1:1 onto every AC: op name `extractheadings` (decision 1),
   `StringBodyType`/`string-body` input gating (decisions 5/6), one row per heading with
   text+level metadata (decisions 2/3/4), apply/infer parity (decision 8/goals), allowedOps
   migration (decision 7), frontend StepCard with field-selector gating (decision 6, task 2.2).
   No AC is left uncovered by tasks.md; no task exceeds ticket scope (chunk-by-token/HEL-221 and
   heading-hierarchy output are explicitly out-of-scope in both proposal.md and design.md's
   Non-Goals).

2. **Reuse vs. divergence from HEL-219's pattern** — Read the archived
   `openspec/changes/archive/2026-07-12-split-text-by-paragraph/design.md` in full. Confirmed
   `design.md`'s Context section correctly cites it and correctly identifies the one genuine
   divergence: `levelField` as an additive 4th row-shape part (passthrough + replaced field + index
   + level), vs. splittext's 3-part shape. Row-shape (flatMap, null-row-drop, last-write-wins
   collision), tolerant decode pattern, analyze validate-then-shape parity, and migration approach
   (`DROP CONSTRAINT IF EXISTS`/`ADD CONSTRAINT`) are all inherited unchanged, matching the
   established pattern rather than reinventing it.

3. **"8 enumeration sites" claim spot-checked against real files** — ran
   `grep -rln "splittext\|SplitText" backend/src frontend/src` and individually confirmed each of
   the 8 backend sites `design.md` decision 8 names actually exists and has the shape claimed:
   - `PipelineStep.scala:112,141` — Registry + `PipelineStepKind.SplitText` ✓
   - `package.scala:31-32,63-64` — type/val aliases for wildcard import ✓
   - `PipelineStepProtocol.scala:76-180` — `SplitTextStepResponse` case class, `jsonFormat6`,
     `fromDomain` match, read/write union match ✓
   - `PipelineStepConfigCodec.scala:85,116,132` — `extractConfig`/`encodeConfig` arms ✓
   - `PipelineStepRepository.scala:212` — `rowToDomain` arm ✓
   - `PipelineAnalyzeService.scala:70,162` — `inferSplitText` dispatch + function ✓
   - `PipelineProtocol.scala:113-212` — the separate `AnalyzeStepResponse` ADT (own case class,
     `jsonFormat6`, both write/read match arms) — **this is the exact site HEL-219's cycle 1 missed**
     (per its own design.md decision 8 correction and evaluation-1.md), and design.md/tasks.md for
     HEL-220 call it out explicitly as task 1.8/3.8 — good, this is the highest-risk gap and it's
     directly addressed, not just mentioned in passing.
   - `PipelineService.scala:22,44,194` — `toAnalyzeStepResponse` dispatch arm ✓
   All 7 test-file sites named in design.md decision 8 (`PipelineStepSpec`,
   `PipelineStepConfigCodecSpec`, `PipelineStepProtocolSpec`, `InProcessPipelineEngineSpec`,
   `PipelineAnalyzeServiceSpec`, `PipelineStepRoutesSpec`, `PipelineAnalyzeRoutesSpec`) exist and
   reference `SplitText`/`splittext`, confirmed via the same grep. The one additional splittext
   reference found by the grep that design.md does **not** enumerate —
   `frontend/src/features/pipelines/ui/PipelineDetailPage.css:626`
   (`.pipeline-detail-page__splittext-config`) — is a purely cosmetic CSS layout class (shared
   `display:flex; flex-direction:column; gap:10px` alongside `compute-config`/`limit-config`), not
   a functional wiring site; omitting it from the "8 sites" list is correct (it's not one of the 8,
   it's decoration a future ExtractHeadingsConfig.tsx could reuse or add its own variant of without
   any functional consequence either way). No missed functional site found.

4. **jsonFormatN arity sanity-check** — `SplitTextStepResponse`/`SplitTextAnalyzeStepResponse` are
   both `jsonFormat6` (6 fields: id, pipelineId/position/createdAt/updatedAt, config). Read
   `PipelineProtocol.scala:113-117` and `PipelineStepProtocol.scala:76-79` — `ExtractHeadingsConfig`
   folds its extra `levelField` into the existing `config` field slot (not a new top-level field),
   so the equivalent `ExtractHeadingsStepResponse`/`ExtractHeadingsAnalyzeStepResponse` will also be
   6-field/`jsonFormat6` — tasks.md's generic "jsonFormatN" phrasing (1.4, 1.8) is appropriately
   non-committal and doesn't hardcode a wrong arity.

5. **tasks.md completeness/ordering** — Backend (§1, 9 tasks) → Frontend (§2, 4 tasks) → Tests
   (§3, 10 tasks) is correctly ordered (implementation before test-list extension) and every
   enumeration site from design.md decision 8 has a corresponding task (1.3-1.8 for the 8 backend
   sites, 3.1,3.3-3.8 for the 7 test-file extensions + new spec file). Frontend impact list in
   proposal.md (`pipelineStep.ts`, `stepNarrowing.ts`, `StepCard.tsx`, `useStepCardState.ts`) was
   independently confirmed against real `SplitText` references in those exact 4 files via grep —
   task 2.1/2.3/2.4 cover all of them.

6. **V51 migration number free** — `ls backend/src/main/resources/db/migration/ | sort -V` shows
   the highest existing file is `V50__add_splittext_op.sql`; no `V51__*` file exists on this branch.
   Nothing else in tasks.md/design.md/proposal.md claims a different number for this change. Free
   and correctly identified.

7. **Spec deltas well-formed** — Read both
   `specs/pipeline-extract-headings-op/spec.md` (ADDED, 3 requirements, 4-hash scenarios under
   each) and `specs/pipeline-steps-persistence/spec.md` (MODIFIED, correctly updates the CHECK
   constraint enumeration text to include `'extractheadings'`/V51 and adds the new
   `POST type "extractheadings"` scenario matching HEL-219's existing scenario pattern). Ran
   `openspec validate extract-markdown-headings --strict`, which reported: `Change
   'extract-markdown-headings' is valid.`

8. **No placeholders/hand-waving** — grepped all planning docs for
   `TODO|TBD|figure out later|to be determined|placeholder`; only false-positive substring matches
   (`rowToDomain`) turned up. No deferred decisions that block implementation; the design's
   "Planner Notes" section explicitly self-approves the two narrow reversible choices (kind string,
   config field naming) rather than leaving them open.

### Verdict: CONFIRM

### Non-blocking notes

- `ExtractHeadingsConfig.tsx` (task 2.2) will need its own CSS layout class analogous to
  `.pipeline-detail-page__splittext-config` (or can reuse it) — not called out in design.md/tasks.md
  explicitly, but it's a trivial styling detail an implementer will naturally handle when mirroring
  `SplitTextConfig.tsx`'s JSX structure; not worth a task-list entry.
