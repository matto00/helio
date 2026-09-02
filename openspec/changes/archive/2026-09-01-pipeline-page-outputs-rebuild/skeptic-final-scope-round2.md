## Skeptic Report — final gate (round 2, skeptic-final-4.md)

**Axis:** ticket-scope completeness + honesty of every "out of scope"/"blocked"/"not
reproducible" disposition; regression safety of named historical invariants.

Ground truth: HEAD `9b3d0699`, tree clean (`git status --porcelain` empty). Backend
`{"status":"ok"}` on :9247, frontend HTTP 200 on :6340 — both live, not restarted.
Cold instance; every number below is my own fresh measurement.

### What I verified (with evidence)

**Round-1 CR1 — genuinely fixed, live-confirmed. CLOSED.**
- Backend ground truth, re-derived myself (not from the executor's citation): authenticated
  `GET /api/pipelines` returns **62** pipelines; key set is exactly
  `id, lastRunAt, lastRunRowCount, lastRunStatus, name, ownerId, sourceDataSourceId,
  sourceDataSourceName`. `outputDataTypeName`: present on **0/62**. `outputDataTypeId`:
  **0/62**. Backend source agrees — `PipelineProtocol.scala:44` `PipelineSummaryResponse`
  is a `jsonFormat9` with neither field. Round 1's refutation was correct.
- Live rendered `/pipelines` (DOM read at `location.href === "http://localhost:6340/pipelines"`):
  headers are exactly `["Name","Source","Last run status","Last run at","Rows written","Actions"]`
  — 6 columns, 6 `<td>` per row, 62 rows, and `document.body.innerText.includes("Output type")`
  is **false**. The dead column is gone from the rendered page, not merely from source.
  Screenshot: `.playwright-mcp/hel908-r2-pipelines-list.png` (detail page; header region shows
  `Source / Outputs (19) / Schedule` with no "Output type" link, confirming that AC too).
- Task 8.3's rewritten justification checks out against source: the retained
  `outputDataTypeId?` on `PipelineSummary` and `CreatePipelinePayload.outputDataTypeName`
  are genuinely different things (a permanently-empty provenance-map read behind HEL-937,
  and a live request-payload field `ShapeInstantiateStep.tsx:196` still sends). No false
  backend-provenance claim survives — I scanned every `outputDataTypeName`/`outputDataTypeId`
  occurrence in `frontend/src` and `backend/src/main`, not just the one line originally found.

**Round-1 CR2, part 2 (unfiled follow-ups) — genuinely fixed. CLOSED.**
- `HEL-938` exists (Backlog, created 2026-09-02T00:46:25Z), titled "Split
  usePipelineDetailPage.ts into its four documented seams (HEL-908 follow-up)". Description is
  accurate: it cites **1033 lines** (matches my own count), names the four seams, and explicitly
  requires F-105/F-146 preservation through the split.
- `HEL-939` exists (Backlog, created 2026-09-02T00:46:30Z), "Extend ShapeParamDescriptor with
  enum/fieldRef widget metadata (HEL-731 remainder, HEL-908 follow-up)". Accurately describes
  design decision 13's owed backend work.
- `tasks.md` 10.4 / 6.2 and `design.md` decision 13 now name the real ids instead of "not yet
  filed" (`git show 9b3d0699`). Correct.

**Gates — all re-run fresh by me at HEAD** (my first run was from the repo root, where
`test`/`build` don't exist; re-run from `frontend/`):
- `npm run lint` (`--max-warnings=0`) → exit 0. `npm run format:check` → exit 0.
- `npm run typecheck` → exit 0. `npx jest` → **282 suites / 3013 tests passed**, exit 0.
- `npm run build` → succeeded (PWA precache 28 entries).
- `npm run check:openspec` → "openspec/ is clean", exit 0.
- `npx openspec validate pipeline-page-outputs-rebuild --strict` → **exit 1** (see CR1 below).

**Regression safety of named invariants — no exposure this round.** The three round-2 commits
touch **zero** behavioral source outside `PipelineListTable.tsx` and a type/comment edit:
`git diff --stat 5fa1fc54..HEAD -- e2e/ frontend/src/features/pipelines/hooks/
frontend/src/features/pipelines/ui/PipelineRiverView.tsx` is **empty**. So
`usePipelineDetailPage.ts` (F-105 `skipNextAnalyzeRef`, F-146 stable refs, HEL-878
`resetRunScopedState`), `PipelineRiverView.tsx`, and every `hel908-*.spec.ts` are byte-identical
to the state round 1 verified in depth. HEL-681's `previewRequestToken` and HEL-629's remount key
likewise untouched. Round-1's verification of all five stands unweakened.

**Sanity re-confirms (per instruction, not full re-investigation):**
- **HEL-676** — no code changed this round that could resurrect it; round-1's structural finding
  (the footer chain computes `position: static`, so the "fixed bar overlaps" premise is void)
  is unaffected. Still honestly dispositioned.
- **Task 9.3 interaction budget** — `e2e/hel908-full-flow.spec.ts` unchanged this round, so the
  recorded 25 clicks and the reasoning that spec line 256's ≤12 budget covers a narrower,
  placement-inclusive flow remain accurate.
- **Tasks 2.5 / 5.9 / 6.4 (PanelDetailModal / HEL-937 blocker)** — still real: `ShapeInstantiateStep.tsx`
  is still live-imported and still sends `outputDataTypeName`. Task 2.5 is correctly left `- [ ]`
  unchecked rather than falsely claimed.

**Acceptance-criteria re-trace at HEAD (all 7 bullets):** Playwright one-page flow ✓
(`hel908-full-flow.spec.ts`, count recorded); Jest river/rail/capabilities/pie↔bar ✓;
HEL-676/878/681 re-run + dispositioned ✓; mobile 375/430px ✓ (round-1 sibling axis, untouched);
paste-a-table + HEL-878 enumeration ✓; e2e greps + spec deltas + `check:openspec` green ✓;
lint/typecheck/test green ✓ and no file over ~400 lines without a stated reason ✓ *(reasons are
stated for all four over-budget files; the defect below is the accuracy of two numbers, not the
absence of a reason)*. Nothing regressed or was left inconsistent by this round's fix commits.

### Verdict: REFUTE

Both round-1 change requests are substantively resolved — the dead column is genuinely gone,
the backend claim is genuinely corrected, and both owed tickets genuinely exist with accurate
descriptions. The code ships. What does not yet ship clean is the same defect class that has
now recurred **inside the very commit that was fixing it**: two self-reported "verified/passing"
claims in this change's own docs are false against the tool at HEAD. Both are ~5-minute
documentation fixes with no functional impact — I am flagging them because my axis is precisely
the trustworthiness of these claims, and a reviewer reading task 10.2 would be told a gate
passes that does not.

### Change Requests

1. **Three separate tasks claim `openspec validate --strict` passes; it reproducibly fails
   (exit 1).** Run twice, byte-identical output both times, so this is a stable result and not a
   flaky reading:
   ```
   $ npx openspec validate pipeline-page-outputs-rebuild --strict ; echo $?
   Change 'pipeline-page-outputs-rebuild' has issues
   ⚠ [WARNING] tasks.md: Task "3.9" is under group 10, but its leading number points to group 3.
   ⚠ [WARNING] tasks.md: Task "3.10" is under group 10, but its leading number points to group 3.
   ⚠ [WARNING] tasks.md: Task "3.11" is under group 10, but its leading number points to group 3.
   1
   ```
   - `tasks.md:25` (task 3.5b): *"`openspec validate … --strict` passes."*
   - `tasks.md:81` (task 10.1): *"`openspec validate … --strict` passes with both deltas added."*
   - `tasks.md:82` (task 10.2): *"…and `openspec validate … --strict` **all pass**."*
   The ticket's actual AC ("check:openspec green") **is** met — `npm run check:openspec` exits 0 —
   so this is not an AC failure. It is three false green-gate assertions. Cause: the CR9/CR10/CR11
   fix tasks were appended as `3.9`/`3.10`/`3.11` under the `## 10.` heading in a later cycle,
   after these claims were written, and nobody re-ran the command.
   Fix: renumber those three to `10.7`/`10.8`/`10.9` (or move them under `## 3.`) so `--strict`
   exits 0, then re-run it and correct the three claims to whatever it actually prints.

2. **Task 10.4's "re-measured fresh" `OutputEditorSheet.tsx` figure is already wrong again, and
   10.4 now contains two contradictory counts for the same file.** My `wc -l` at HEAD:
   | file | 10.4 claims | my count at HEAD |
   |---|---|---|
   | `usePipelineDetailPage.ts` | 1033 | **1033** ✓ |
   | `PipelineDetailPage.tsx` | 363 | **363** ✓ |
   | `PipelineRiverView.tsx` | 500 | **500** ✓ |
   | `StepCard.tsx` / `CreatePipelineModal.tsx` / `ShapePickerModal.tsx` / `AddSourceModal.tsx` | 379 / 228 / 221 / 521 | **379 / 228 / 221 / 521** ✓ |
   | `OutputEditorSheet.tsx` | 579 (`tasks.md:87`) **and 569 (`tasks.md:89`)** | **581** ✗ |
   - Mechanism (self-inflicted): `git show 10dd4eb1:…/OutputEditorSheet.tsx \| wc -l` = 579. Commit
     `972e0d43` measured 579, then **added 2 lines to that same file** writing the correction into
     its header comment, and never re-measured. `git show 972e0d43:… \| wc -l` = 581.
   - The in-file header comment inherits the same error: it now reads *"soft budget (579 lines --
     … re-measured with `wc -l` rather than re-copied forward)"* while the file is 581.
   - Separately, `tasks.md:89` still carries the **old, superseded** `OutputEditorSheet.tsx`
     (**569 lines**) bullet directly below the new 579 one. Task 10.4 therefore states two
     different line counts for one file, neither of them correct.
   Fix: set both `tasks.md` and the file's own header comment to the true count, and delete (or
   fold into the surviving bullet) the stale `tasks.md:89` 569-line duplicate. Note that editing
   the header comment can change the count again — measure *after* the edit lands, or state it as
   a rounded "~580" that cannot go stale on a one-line touch.

### Non-blocking notes

- Carried forward unresolved from round 1 and still true: `ticket.md`'s Scope bullet lists
  "Place on dashboard (dashboard picker; `POST /api/panels`)" while its own **Out of scope**
  section excludes it. The out-of-scope reading is correct (design.md agrees, HEL-909 owns it),
  but the Scope bullet should be corrected so a future reader doesn't re-litigate it.
- HEL-676 is worth closing with round-1's *mechanism* (footer ancestor chain is `position: static`;
  nothing `fixed`/`sticky` overlaps the river) rather than "not reproducible" — a materially
  stronger close, and free to state in the PR.
- The spec's ≤12-interaction budget (design spec line 256) remains genuinely unproven for the epic
  since it requires dashboard placement; worth adding as an explicit HEL-909 acceptance item so it
  isn't lost between the two tickets.
- Environmental, not a defect: the in-memory rate limiter (120 req/60s, per CLAUDE.md) 429s the
  login endpoint after a burst of review probing. I waited out the window rather than working
  around it; noting it so a later reviewer doesn't misread a 429 as an auth regression.
