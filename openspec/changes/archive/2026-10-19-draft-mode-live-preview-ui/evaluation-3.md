## Evaluation Report — Cycle 3 (evaluation-3.md)

I reviewed HEAD `8a2d5ec1585629df181ef7a8a0531fae2f4aec67`. The base, resolved live, is `538a867d718204775f7c0844450f683889e145e3`. The scope is the delta `fdfeca1dd..8a2d5ec15` (`02f24b230` and `8a2d5ec15`), which answers the final skeptic's REFUTE in `skeptic-final-1.md`.

### Fresh gate runs (my own, `nice -n 19`)

- **lint, `format:check`, typecheck:** each exited 0.
- **Frontend jest** (`HELIO_JEST_MAX_WORKERS=2`): exited 0. 747 suites, 9281 tests, which is 4 more than cycle 2 (the new CR1, CR2, CR3 and near-cap tests).
- **e2e** (hel1631, hel1579, hel1582, hel1668), run under the e2e.lock flock with `--trace retain-on-failure`: 62 passed and 1 failed.
  - The failure was `hel1582-mobile-pipeline.spec.ts:46` (AC1 fit). The helper `e2e/support/hel1582Phone.ts:252` takes a non-retrying `outputs.count()` snapshot and got 0, against an expected 1.
  - I re-ran that one test with `--repeat-each=3 --workers=1`: 3 of 3 passed.
  - Nothing in the delta changes how Outputs load on open. The only Output change is the refresh after a save.
  - I judge it a timing flake in the helper (the race is in `assertFits` itself), not a regression. It is listed below as non-blocking.
- **Evidence** is under `/home/matt/Development/helio/.concertino/runs/HEL-1631/evidence/.concertino/scratch/HEL-1631/`:
  - `eval3-e2e.txt`
  - `eval3-e2e-hel1582-ac1-rerun.txt`
  - `eval3-jest.txt`

### Phase 1: Spec Review — PASS

- **CR5 ruling (C8).** I verified the ruling in `events.jsonl`. There is an `escalation.answered` event with:
  - `escalation_id`: HEL-1631-1792470998080-9a4d45
  - `answer`: `amend-ac-fetch-on-view`
  - `answer_source`: `human`
- **CR5 amendments.** ticket.md (AC3), the draft-mode spec, design.md and tasks.md (C8) are amended to match the ruling.
- **CR1 ruling.** It is chat-only, with no escalation event, as the orchestrator stated. I accepted it on that basis. The spec now says that a leave the app cannot hold (Back, Forward, the palette, Settings) keeps the draft for the tab.
- **Spine-layout spec line 25** is reconciled with DESIGN.md §11 and C7: the chip is secondary with an accent dot, and the flash is a 22% accent wash.

### Phase 2: Code Review — PASS

- **CR1, the draft is kept per tab.** `usePipelineDraft.ts` restores the draft from sessionStorage once per pipeline id after the saved steps load, using `rebaseOverlay`, which prunes edits to steps that no longer exist. It writes the draft back on every change and removes the key once the draft is empty.
  - **Red-first evidence:**
    - The e2e mutation fails at the draft-chip assertion (`cr1-back-red-mutation.txt`).
    - The Jest mutation shows 1 test failing (`cycle3-jest-red.txt`).
  - **My own live probe** covered the harder case: Back and Forward between two different pipelines. The same `PipelineDetailPage` instance stays mounted there, so the `ready` and pipeline-id race matters.
    - Draft on B, Back to A: A shows no draft, and B's copy is kept.
    - Draft on A, Forward to B: B's draft (280, "8 → 11") is restored.
    - Back to A: A's draft (320, "8 → 5") is restored.
    - Neither draft leaked into the other pipeline.
- **CR2, the dead Undo.** Undo now runs once per application id. A successful Undo dismisses the "Saved." toast, and a newer save replaces the older toast. Red-first: the Jest mutation shows 1 test failing.
- **CR3, the deleted-Output preview.** The refresh after a save now uses `saved.definition.outputs`. Red-first: the Jest mutation shows 1 test failing.
- **CR4, the phone add row.** I measured it live at 375 with a draft open:
  - `button.spine-add-row` is disabled, with opacity 0.5, cursor `not-allowed`, and the title "Save or discard your draft first".
  - The hover style is excluded while it is disabled.
  - The phone chip's dot is the accent colour.
- **CR5, the fetch-on-view rule.** The e2e now asserts that Discard sends exactly one GET, the saved preview of the step first opened during the draft.
  - The red file shows the old zero-request assertion receiving exactly that one GET.
  - The new assertion is tight: an exact count of one plus the exact URL, so any extra request turns it red.
- **Side effects.**
  - The `jest.setup.ts` `sessionStorage.clear()` before each test is correct isolation.
  - The new `StatusChip` `title` prop is optional and additive.
- **No escape hatches.** The only `try/catch` blocks are around storage access, where unavailable storage is documented as degrading to "not kept".

### Phase 3: UI Review — PASS

- Checked live on 7063/9970 with real drafts: desktop at 1280 (the Back/Forward probe) and phone at 375 (`eval3-375-draft-add-row.png`).
- Console: the only error is the pre-existing schedule 404.
- My throwaway data was deleted by exact id. Pipelines `0905237d…` and `60fc964a…` and source `40a4e75d…` each returned 204, and a DB check found 0 rows. The probe's sessionStorage keys were cleared. The ids are recorded in `.concertino/scratch/HEL-1631/eval3-created-ids.txt`.

### Overall: PASS

### Non-blocking Suggestions

- `e2e/support/hel1582Phone.ts:251-252` checks the row and Output counts once, with no retry, so it fails if the Outputs are still loading. Use `await expect(items.outputs).toHaveCount(1)`. This race is pre-existing in a shared helper, and it failed once in my run.
- The sessionStorage restore also brings a draft back after a reload that the user confirmed through `beforeunload`. That fits the "kept for the tab" wording, but say so in the PR so it is not read as a bug.
- The cycle-1 and cycle-2 non-blocking items still stand.
