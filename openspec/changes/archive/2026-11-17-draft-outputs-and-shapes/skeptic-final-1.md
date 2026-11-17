## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD `9326c352508718acd6a7c0a9b501c77e9aa0b461` against the live-resolved base `e0443c24d0c02b41cdda105a410cea0b6bdf2b33`
(`resolve-review-base.sh`, exit 0; merge-base with origin/main; main is one commit ahead, HEL-1728's react-grid-layout pin).

### What I verified (with evidence)

**Gates, re-run fresh by me**
- `npm --prefix frontend run typecheck`: clean. `npm run lint` (`--max-warnings=0`): clean. `npm run format:check`: "All matched files use Prettier code style!".
- Jest, `HELIO_JEST_MAX_WORKERS=3`, `--testPathPatterns=features/pipelines`: `Test Suites: 193 passed, 193 total`, `Tests: 3070 passed, 3070 total`.
- Backend, `sbt -J-Xmx3g testOnly DraftDiffSpec NodeCapabilitiesParitySpec DraftSaveApiSpec` (servers stopped first): `Total number of tests run: 52`, `Tests: succeeded 52, failed 0`, `All tests passed.` (summary read, not the exit code). The red transcript `evidence/backend-red.txt` shows exactly the 3 D12 cases failing on the unchanged `planOutputs` (`Tests: succeeded 47, failed 3`); (b) is a passing guard, as stated.
- e2e, `DEV_PORT=7165 BACKEND_PORT=10072 --project=dev --workers=2`, against servers started with `start-servers.sh` (`assert-phase.sh servers` -> `PASS servers`):
  - `e2e/hel1733-draft-outputs-shapes.spec.ts`: **28 passed (3.3m)**.
  - `hel1631` + `hel1684` + `hel1705*` + `hel1632*` together: **55 passed (4.9m)**.
  - Transcripts: `/home/matt/Development/helio/.concertino/scratch/HEL-1733/skeptic-e2e-hel1733.txt`, `skeptic-e2e-alongside.txt`, `skeptic-sbt.txt`.

**Acceptance criteria**
- AC1 (each action works in a draft, atomic on Save & run, dropped on Discard): `usePipelineDraftRouting.ts` routes create/edit/delete, the shape and the aggregate tail into one overlay update each (`appendOps` for the multi-op ones), falling back to `useOutputImmediateActions` (thunks moved verbatim) when `!inDraft`. `draftSaveRequest`/`toDraftOutputs` emit `clientId`/`nodeStepClientId`/`rootId`. The e2e's eight actions (desktop-light, phone-dark, plus desktop-dark and phone-light smokes) each assert one `draft/save` carrying the change, no Output/step write, and the reloaded state. A5 asserts "Confirm delete (removes from 1 dashboard)", the cascade dialog's "Output: ..." and "1 panel bound to those Outputs", "Remove and save", and the panel list empty afterwards (spec lines 217-229, 344, 467-468). The "Discard drops ... at once, with no request" test asserts an empty request log. I also reproduced Discard by hand on a shared dev pipeline: after a created Output, a rename and a step disable, Discard left `GET /api/pipelines/:id/outputs` at the original two names and sessionStorage empty.
- AC2 (kept-draft restore and stale base): the overlay v3 / kept-draft v3 code, with v2/v1 restore (`keptDraft.ts`) and the D15 outputs-readiness judgement (`usePipelineDraft.ts`). Jest D15 (1)-(8) is in `usePipelineDraft.outputs.test.tsx`, and evidence.md records a mutation for it. The e2e covers restore after Back with a created Output, a seeded v2 kept draft restoring not stale, a stale base with an Output edit, and undo. All are in my 28-pass run.
- AC3 (desktop and phone, light and dark, e2e per action that fails first): `evidence/e2e-red.txt` shows **19 failed**, every one at a disabled control titled "Save or discard your draft first" (19 matches). That covers all eight actions in desktop-light and phone-dark, the two smokes and the Discard variant.

**Owner rulings and constraints**
- Q1 `inline-confirm-then-save-dialog` and C1: the two-click text is unchanged (the sheet passes `write.remove`; the footer component is untouched) and the cascade dialog is the existing one. I saw "Confirm delete (removes from 1 ..." live on phone.
- Q2 `one-pr` and C4: Outputs, shapes and the aggregate tail are all in this branch. Roots stay blocked (PipelineSpine/MobilePipelineHeader still feed `draftBlockReason` to Add/remove source).
- C2: see AC3.
- C3: see the backend red/green above.

**The type-seam e2e (the evaluator's open question)**
I read `useDraftNodeCapabilities.ts`. While the projection is `checking` or `unavailable`, the capabilities are built from the frame's column names, every one typed `"string"`. So no numeric slot (the histogram field) can offer `status` from the fallback. Saved capabilities type `status` as text too. The positive "after the draft cast `status` is a float" assertion can therefore only pass when the real `analyze-proposal` types the draft node and the TS port marks the column eligible. On main the honest red is the disabled "Add output" (a draft blocks it). A mutation transcript would be nicer, but the assertion is not vacuous. **Not blocking.** The "before" negative assertion can pass while still checking (the evaluator's note); that is harmless, because the positive half carries the proof.

**Visual review in the running app** (port 7165, `matt@helio.dev`, pipeline "HEL-1189 Skeptic Pipeline"; draft only, discarded afterwards, nothing written)
- Spine card meta, light: "Table · New · not saved" and "Table · used in 1 panel · Edited". It reuses `spine-card__meta`, and the separators match the existing `·` meta rhythm and the "Draft · unsaved changes" chip. Fine. Ref: `/home/matt/Development/helio/.concertino/runs/HEL-1733/evidence/.concertino/scratch/HEL-1733/sk-desk-light-spine.png`.
- Same in dark (`.../sk-desk-dark-spine.png`) and on the 375px phone in dark (`.../sk-phone-dark-outputs.png`). Parity holds.
- Live Output column with the created Output, dark: draft rows, the `live` marker, and "Rendered from the draft. Nothing is written until you save and run." It is on-pattern with DESIGN.md §11. Ref: `.../sk-desk-dark-live-created.png`.
- **Sheet hint "Saved with the draft on Save & run": off-pattern.** See Change Request 1. Refs: `.../sk-desk-light-sheet-bottom.png`, `.../sk-desk-light-edit-sheet-bottom.png`, `.../sk-desk-dark-sheet-bottom.png`, `.../sk-phone-dark-sheet-bottom.png`.

### Verdict: REFUTE

The behavior, tests and contracts are sound. Every gate I ran is green, and the e2e proofs prove what they claim. One piece of new UI does not meet the design language. This is a small, design-judgment refute.

### Change Requests

1. **The draft sheet hint is glued to the wrong element and sits where it is not seen** (`OutputEditorSheet.tsx`, the last line of the body: `{hint !== null && <p className="output-editor-sheet__field-hint">{hint}</p>}`, rendered after `<InlineError>`).
   - **Spacing.** `.output-editor-sheet__field-hint` has `margin: 0` (`OutputEditorSheet.css:58-62`). That class is designed to sit inside a field's gapped grid, but here it is a bare child of the modal body. Measured on desktop light, the hint's rect is `y=744, h=15`. It touches the preview card above (bottom at about 743) and the footer divider below (at about 759), with 0px on both sides. Every other section of the sheet is separated by about 20px.
   - **Proximity.** In edit mode the line lands directly under the "Placements (1)" dashboard link, with no gap. It reads as a caption of that placement, as though the placement is what gets "saved with the draft" (`sk-desk-light-edit-sheet-bottom.png`). The same flush placement shows in dark and on the phone.
   - **Visibility.** The sheet's body scrolls on every viewport I checked (1280x860, 1280x720, 375x812). This one line, which tells the user that "Save" records a draft entry rather than writing, is only visible after scrolling past the whole configuration and preview. A user pressing Save never sees it (`sk-desk-light-sheet-table.png`, the unscrolled create sheet).
   - **Required fix.** Give the hint its own spaced block with a `--space-*` token in the body's rhythm, and place it where it is read before saving. For example, put it directly under the Name/Step/Kind header fields at the top of the body: still not in the footer row, per D5. The "Checking column types..." and "Column types could not be checked..." hints that share the line move with it.
   - **Re-check.** Look at it in light and dark, on desktop and at 375px, in both create and edit mode.

### Non-blocking notes
- `CHECKING_TYPES_HINT = "Checking column types..."` uses three ASCII dots. The frontend uses the `…` character about 6:1 (101 vs 17 non-test literals). Consider `…` for consistency.
- Pre-existing, not introduced here (the footer component is untouched): at 375px the two-click "Confirm delete (removes from 1 dashboard)" label overflows its button (`.../sk-phone-dark-confirm-delete.png`). It is now reachable in a draft too, so it is worth a follow-up ticket.
- The evaluator's suggestions still stand: make the sheet's `actions` prop required, add a 500 variant to D5 case (e), and refresh `e2e-green-alongside.txt` (it still lists the cycle-1 86-test run).
- ECharts "Can't get DOM width or height" warnings fire when the sheet opens on a chart. This looks pre-existing (the preview card is unchanged); I did not bisect it.
- No dev-DB residue from me: the e2e harness deleted its 28 + 55 throwaway users, and my manual session wrote nothing (Discard, verified by re-reading the Outputs).
