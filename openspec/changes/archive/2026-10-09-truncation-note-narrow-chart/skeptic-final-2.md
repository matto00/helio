## Skeptic Report — final gate (round 2, skeptic-final-2.md)

Reviewed HEAD 4b9cc9bc0ae24a6fd17be8a1cf223f3e4b8415fe. Diff base resolved live: `resolve-review-base.sh` -> 68af567556efdf014314028e9d5bd266923f6570 (exit 0; equals `origin/main` after a fresh fetch).

### What I verified (with evidence)

- **Spawn-cwd guard:** `READY ambient=/home/matt/Development/helio branch=bug/truncation-note-narrow-chart/HEL-1398`.
- **Owner ruling (C3) is real:** `.concertino/runs/HEL-1398/events.jsonl` line 37 is `escalation.answered`, `answer=accept-scoping-file-followup`, `answer_source=human`, and `escalation_id` matches the round-1 raise on line 36. C3 is in tasks.md and in workflow-state CONSTRAINTS. I did not re-litigate it.
- **The merge did not change HEL-1392 or HEL-1380 code:**
  - `git diff origin/main HEAD --stat` over `panels/hooks`, `PanelCard*.tsx` and `detailModal` is empty. useOutputMeta, usePanelData and the detail modal are byte-identical to main.
  - The suites that guard them pass on HEAD: `usePanelData.remountReuse`, `usePanelData`, `usePanelData.crossFilter`, `useOutputMeta`, `PanelCardBody.mountRenders`, `PanelCard`, `PanelDetailModal.chartTypeDefault`. Together with the HEL-1398 suites that is 11 files, 120/120 tests.
- **Cycle 4 runtime delta (9d7d8712..HEAD in HEL-1398 files) is comment-only.**
  - ChartRenderer.tsx:38 now reads "leaves the chart canvas more room". The stale "keeps its floor" is gone.
  - PanelContent.css:411 is re-wrapped.
  - PanelContent.css:462 adds the tracking justification. A raw `0.02em` is also used at PanelContent.css:242 and :262, and DESIGN.md's only tracking token is `--eyebrow-tracking` (0.14em), so the raw value follows existing practice.
- **Servers:**
  - `start-servers.sh` reused healthy servers, and `assert-phase.sh servers` returned `PASS servers`.
  - Both listeners' cwd resolves inside this worktree (`frontend/`, `backend/`).
  - The backend process started at 10:09:39, 19s after merge commit 72ca8e7f (10:09:20). It is running the merged backend.
- **Gates, run fresh on HEAD under `nice -n 19`:**
  - `npm run lint`, `npm run typecheck` and `npm run format:check` all exit 0.
  - `jest --maxWorkers=3` exits 0: 495 suites and 5183 tests passed. Summary: `/home/matt/Development/helio/.concertino/runs/HEL-1398/evidence/e2e-evidence/HEL-1398/skeptic-r2/jest-summary.txt`.
- **e2e, run fresh** (`DEV_PORT=6830 BACKEND_PORT=9737`, `--workers=2`): `e2e/hel1398-chart-narrow-footnotes.spec.ts` passed 14 of 14 in 1.3m. Log: `/home/matt/Development/helio/.concertino/runs/HEL-1398/evidence/e2e-evidence/HEL-1398/skeptic-r2/e2e-run.txt`. The spec deletes its own seeded dashboard, pipeline and source by exact id.

### Acceptance criteria

1. **Item 1: chart canvas >= 96px at w=2 with both footnotes, red-first.** Met.
   - **No control bar, measured geometry:** canvas 102.03px at both 1440 and 1900, in light and dark. Annotation and note are one line each (16.8px). The content box spans 141.4–277 and the footer starts at 289, so nothing overlaps.
   - **Visible short form:** "200 of 500 rows." The full sentence stays in the DOM: in the `-long` span (visually hidden, not aria-hidden) and in `title` (ChartRenderer.tsx:86-96).
   - **Red-first:** recorded at c5589f8f / evaluation-1 (5.2px pre-fix). I did not re-run the pre-fix code; that was settled in round 1 and is unchanged.
   - **With a control bar (C3):** contained, as the ruling requires. The bar ends at 198.4, the content box starts at 210.4, the canvas is 33.03px, and the footer starts at 289. Same in all four theme/viewport runs.
   - **Phone stack:** unchanged and not absorbed into this ticket (HEL-1438 keeps it). Canvas is 100px at 390 and 320, both themes, and the full sentence is shown. The query cannot match there because `MobilePanelStack.css:81` overrides the output stack card to `container-type: inline-size`, so the `max-height` feature never evaluates true.
2. **Item 2: stale "one-line" comment.** Met. ChartRenderer.tsx:32-34 now describes the two-line clamp.
3. **Item 3: comment-robust regex, shown red.** Met.
   - In `PanelContent.truncationNoteStyle.test.ts`, the fixture asserts that the old regex returns null (the false green) on a rule placed after a comment, while the new one matches it.
   - I checked the claim by reading the regex: the comment text between `}` and the selector defeats `(?:^|\})\s*` when no multiline flag is set.
   - C1's comma-preceded negative case is tested (both plain and with comments), as are the join and inner-span negatives.
4. **Item 4: "matching rows" wording, live, both themes.** Met. The live run logged "Based on the first 200 of 250 matching rows." in light and in dark. I viewed the dark screenshot.

### UI / design judgment

I viewed these screenshots myself, all persisted:
- `/home/matt/Development/helio/.concertino/runs/HEL-1398/evidence/e2e-evidence/HEL-1398/skeptic-r2/containment-1440-std-light.png`
- `/home/matt/Development/helio/.concertino/runs/HEL-1398/evidence/e2e-evidence/HEL-1398/skeptic-r2/containment-1440-std-dark.png`
- `/home/matt/Development/helio/.concertino/runs/HEL-1398/evidence/e2e-evidence/HEL-1398/skeptic-r2/containment-1900-std-dark.png`
- `/home/matt/Development/helio/.concertino/runs/HEL-1398/evidence/e2e-evidence/HEL-1398/skeptic-r2/containment-1440-ctl-light.png`
- `/home/matt/Development/helio/.concertino/runs/HEL-1398/evidence/e2e-evidence/HEL-1398/skeptic-r2/matching-rows-dark.png`
- `/home/matt/Development/helio/.concertino/runs/HEL-1398/evidence/e2e-evidence/HEL-1398/skeptic-r2/phone-card-light.png`

What they show:
- **No-control-bar card:** the chart is legible, with readable axes. The footnotes are centred and muted, the footer sits on one line, and light and dark match.
- **Control-bar card:** a contained sliver whose y-axis labels overprint. This is the accepted C3 follow-up case.
- **Styling:** the new CSS uses tokens (`--space-1`). The `.sr-only` re-declaration is commented.
- **Scope:** chrome tightening is limited to footnoted chart cards by `:has()`, and the e2e scope test passes (a table, and a chart with no footnotes, keep unclamped titles).

### Verdict: CONFIRM

### Non-blocking notes

- **Follow-up still to file.** The ruling is "accept-scoping-**file-followup**", but I found no follow-up ticket in events.jsonl or workflow-state. The orchestrator should file the control-bar layout follow-up at delivery: 33px canvas and overprinting y-axis labels, per `containment-1440-ctl-light.png`.
- **C2's wording vs the shipped mechanism.**
  - C2's text says the width threshold stays below phone-stack card widths. In fact the 320px stack card is 256px wide, which is under the 260px threshold.
  - The protection comes from the height clause and the stack's inline-size container instead. The CSS comment states this, and the live 320px measurement confirms it.
  - The intent of C2 is met, but its literal text is not. Worth noting when C2 is retired.
- **Comment line lengths.**
  - PanelContent.css:462, the new tracking justification, is itself 120 characters: the same over-long-comment pattern cycle 4 fixed at :411.
  - The re-wrap at :411-412 leaves a ragged short line.
  - Both are cosmetic.
- **Truncated title at 1440.** A footnoted chart title shows only "HEL- / 1398…". A `title` attribute on `.panel-grid-card__title` is a follow-up candidate (carried from round 1).
