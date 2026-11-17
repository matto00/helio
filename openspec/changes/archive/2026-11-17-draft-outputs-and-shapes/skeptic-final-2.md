## Skeptic Report — final gate (round 2, skeptic-final-2.md)

Reviewed HEAD `5580112e8af4a623bda13111e751343d79dadc8e` against the live-resolved base `e0443c24d0c02b41cdda105a410cea0b6bdf2b33` (`resolve-review-base.sh main origin`, exit 0). Since round 1 (`9326c3525`) the only code delta is `5580112e8`: `OutputEditorSheet.tsx` (+5/-1), `OutputEditorSheet.css` (+8), `outputSheetDraft.ts` (1 line), the hint e2e (+47), and design.md/evidence.md text. `git diff --name-only 9326c3525..HEAD -- backend` is empty.

### What I verified (with evidence)

**Gates, re-run fresh by me**
- `npm --prefix frontend run typecheck`: exit 0. `npm run lint` (`--max-warnings=0`): exit 0. `npm run format:check`: "All matched files use Prettier code style!".
- Jest, `HELIO_JEST_MAX_WORKERS=3`, `--testPathPatterns=features/pipelines`: `Test Suites: 193 passed, 193 total`, `Tests: 3070 passed, 3070 total`.
- Backend, `sbt -J-Xmx3g "testOnly *DraftDiffSpec *NodeCapabilitiesParitySpec *DraftSaveApiSpec"` (before starting servers): `Total number of tests run: 52`, `Tests: succeeded 52, failed 0`, `All tests passed.` Transcript: `/home/matt/Development/helio/.concertino/scratch/HEL-1733/skeptic2-sbt.txt`.
- e2e, servers from `start-servers.sh` (`assert-phase.sh servers` -> `PASS servers`), `DEV_PORT=7165 BACKEND_PORT=10072 npm run e2e -- e2e/hel1733-draft-outputs-shapes.spec.ts --project=dev --workers=2`: **32 passed (4.0m)**. That is round 1's 28 plus the 4 new hint tests. The harness deleted its 32 throwaway users. Transcript: `/home/matt/Development/helio/.concertino/scratch/HEL-1733/skeptic2-e2e-hel1733.txt`.
- I did not re-run the hel1631/1684/1705/1632 specs. None of them references the hint text, `Checking column types` or the sheet's hint classes (grep of `e2e/`), and no other code changed since round 1's green 55-test run of those specs.

**Round 1's Change Request 1 (hint placement)**
- Code: the hint is now `<p className="output-editor-sheet__draft-hint" role="status">`, the last child of the first `output-editor-sheet__group` (Name / Step / Kind). The old bottom-of-body line is gone. The class uses `--text-xs` and `--app-text-muted`, with no hardcoded values.
- Live measurement (desktop 1280x800, light, edit sheet of "Orders by region" in a throwaway draft on "HEL-1189 Skeptic Pipeline"): the hint is at top 285, IntersectionObserver ratio 1 (fully visible without scrolling), 12px below the Kind section (the group's `row-gap: 12px` = `--space-3`), and `font-size: 12px`.
- Visual check, from screenshots my e2e run captured fresh:
  - `/home/matt/Development/helio/.concertino/runs/HEL-1733/evidence/e2e-evidence/HEL-1733/sheet-hint-desktop-light-create.png`
  - `.../sheet-hint-desktop-dark-edit.png`
  - `.../sheet-hint-phone-dark-edit.png`
  - `.../sheet-hint-phone-light-create.png`
  - plus my own live shot `/home/matt/Development/helio/.concertino/scratch/HEL-1733/sk2-after-open.png`.
- What the screenshots show:
  - In every case the hint sits above the Configuration card and is read before Save.
  - The 12px group gap above it and the 20px `__group + __group` gap below it keep it clearly separate from the fields and from the card.
  - In edit mode it follows the kind-lock caption. The caption is 8px under its select, inside the field section; the hint is a further 12px down, so the hint reads as a sheet-level note rather than a caption of the Kind field.
  - Light and dark are at parity, and nothing overflows at 375px.
- The fix is on-pattern. CR1 is resolved.

**New e2e: does it fail first?**
- The executor recorded no red run and no mutation for the hint test. evidence.md only lists screenshots.
- I checked failability myself with a DOM mutation in the running app. I moved the hint node back to the round-1 position (the last child of the modal body), then measured exactly what the test asserts:
  - Before: ratio 1, gap 12.
  - Mutated: IntersectionObserver ratio 0 (out of view, top 1648 in an 800px viewport), and 0px gap from the previous sibling.
  - Restored: ratio 1, gap 12.
- Both `toBeInViewport()` and `gap >= 8` would go red on the old placement, so the guard is failable.
- This was an in-browser mutation, not a red run of the spec on the old commit. I record it here as a substitute for the missing executor evidence.

**`…` character**: `CHECKING_TYPES_HINT = "Checking column types…"` (`outputSheetDraft.ts:15`). Jest uses the constant and is green.

**Acceptance criteria, owner rulings and constraints (re-checked against round 1's ground truth; nothing they depend on changed)**
- AC1, AC2 and AC3, Q1 (inline confirm, then the cascade dialog), Q2 (one PR) and C1–C4 were each traced in skeptic-final-1.md to code, unit tests and e2e tests.
- The round-2 delta touches only the hint's placement and text. All of those e2e cases still pass in my fresh 32-test run (A5 delete-cascade, Discard of everything, kept-draft restore, stale base, v2 restore, and the type seam).
- The backend is unchanged, and its D12 tests are green in my run (C3).

**Hygiene**
- My live draft (one step Disable) was discarded. Afterwards there was no Discard button and no draft key in sessionStorage. Nothing was written, so I created no dev-DB residue.
- The only console error was the pre-existing `GET .../schedule` 404 (the pipeline has no schedule).
- I stopped the servers with `stop-servers.sh` (`STOPPED ports=7165,10072`).

### Verdict: CONFIRM

The change ships. Round 1's only blocking finding is fixed, and the fix is on-pattern in light and dark, on desktop and on a 375px phone, in create and edit mode. Every gate I re-ran is green, and the new guard is shown to be failable.

### Non-blocking notes
- `.output-editor-sheet__draft-hint` duplicates `.output-editor-sheet__field-hint` exactly (same three declarations). The comment justifies a separate class, but reusing `__field-hint` would avoid the copy.
- The executor should record a red run or mutation for any new guard test. This round I supplied it (see above).
- Round 1's other notes still stand. The main one is the pre-existing overflow of "Confirm delete (removes from 1 dashboard)" at 375px, which deserves a follow-up ticket.
