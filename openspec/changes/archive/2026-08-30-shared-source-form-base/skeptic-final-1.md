## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Ticket: HEL-720 · Change: shared-source-form-base · Commit under review: `faeb2234`
Reviewed cold from ground truth (diff, files, gates re-run, running app). The evaluator's
`evaluation-1.md` was not read.

### What I verified (with evidence)

**1. The actual diff (`git diff main...HEAD`)**
Read in full. 7 source/test files + change artifacts; 636 insertions / 294 deletions.
`UnstructuredSourceForm.tsx` is a line-for-line lift of the previously-triplicated JSX with
exactly five literals replaced by `config.*` / template-literal id interpolation. The three
wrappers keep their exported `*IngestMode` / `*SourceFormProps` names and pass
`onSubmit/isLoading/error/onCancel` straight through. No structural, class-name, or
ordering change anywhere in the rendered tree.

**2. AC-by-AC trace**
- *"One shared implementation backs all three unstructured-source forms"* — met.
  `UnstructuredSourceForm.tsx:56-135` owns the toggle/file/URL/`InlineError`/actions
  structure; `TextSourceForm.tsx`, `PdfSourceForm.tsx`, `ImageSourceForm.tsx` each reduce to
  a 5-field config const + a single delegating render.
- *"No behavior change for users"* — met. Confirmed three ways: (a) the diff is a mechanical
  extraction (above); (b) the 6 pre-existing behavioral tests per form (default sub-mode,
  toggle, `onSubmit` payload for upload mode, `onSubmit` payload for URL mode, error display,
  loading-disabled) are **unmodified** — the test diffs are additions only — and all pass;
  (c) live end-to-end submit in the running app (see 5).
- *"Validation/error messages stay consistent"* — met, and structurally strengthened: error
  rendering is now a single `<InlineError error={error} />` in the shared base rather than
  three copies. Error text itself originates in `AddSourceModal.tsx`, which is unchanged.

**3. Gates re-run by me (not taken on assertion)**
- `npx tsc --noEmit -p frontend/tsconfig.json` → exit **0**.
- `npm run lint` (`eslint . --max-warnings=0`) → exit **0**.
- `npm test` → exit 0, **274 suites / 2963 tests passed**, 0 failed.

**4. The two design-gate concerns, independently verified**

*(a) Are the new per-form assertions genuinely failable?* Yes — verified by mutating the
**source config** (not the test), one field at a time, on `TextSourceForm.tsx`. Baseline for
the three form suites was 21/21 passing. Each mutation turned the new test red:

| Mutation to `TEXT_CONFIG` | Result |
|---|---|
| `idPrefix` `source-text` → `source-txt` | 1 failed, 6 passed |
| `groupAriaLabel` `Text ingestion method` → `Textual ingestion method` | 1 failed, 6 passed |
| `fileLabel` `Text/Markdown file` → `Text file` | 3 failed, 4 passed |
| `accept` `.txt,.md,text/plain,text/markdown` → `.txt,text/plain` | 1 failed, 6 passed |
| `urlPlaceholder` `.../notes.md` → `.../x.md` | 1 failed, 6 passed |

All five config fields are individually failable — the assertions are load-bearing, not
decorative. I also ran the exact scenario the design skeptic feared: **transposing the whole
PDF config into `IMAGE_CONFIG`** → `ImageSourceForm` went to *3 failed, 4 passed*. A
config transposition is caught. Source files restored; `git status --porcelain` shows a clean
worktree afterwards (only the evaluator's untracked `evaluation-1.md`).

*Measurement note:* my first mutation sweep emitted no output. Rather than read that as a
result, I re-ran it and found the cause was my own bad flag (`--testPathPattern` was replaced
by `--testPathPatterns` in Jest 30), not the code. The table above is from the corrected,
reproduced run.

*(b) Is `AddSourceModal.tsx` unchanged and still correct?* Yes.
`git diff main...HEAD --name-only` contains **no** `AddSourceModal` entry — the file is
byte-identical to `main`. Its four call sites (`AddSourceModal.tsx:377/402/426/450` for
Static/Text/Pdf/Image) and its type imports (`ImageIngestMode`, `PdfIngestMode`,
`TextIngestMode` at lines 28/31/36) still resolve — proven by the clean `tsc` run, since the
wrappers deliberately kept those exported names. Grep confirms no other consumer of these
three components anywhere in `frontend/src`. `StaticSourceForm` / `useRestSourceForm` were
correctly left untouched per the ticket's explicit non-goal.

**5. UI gate — drove the running app (not just code)**
`start-servers.sh` + `assert-phase.sh servers` → `PASS servers`. I additionally confirmed the
listener on 6152 is genuinely this worktree (`/proc/1418506/cwd` →
`.../shared-source-form-base/HEL-720/frontend`), so I was not reviewing a stale server.

Drove `/sources` → "Add source" for all three types in both modes. Live DOM read back:

| Form | group aria-label | file id / accept / label | url id / placeholder |
|---|---|---|---|
| Text | `Text ingestion method` | `source-text-file` / `.txt,.md,text/plain,text/markdown` / `Text/Markdown file` | `source-text-url` / `https://example.com/notes.md` |
| PDF | `PDF ingestion method` | `source-pdf-file` / `.pdf,application/pdf` / `PDF file` | `source-pdf-url` / `https://example.com/report.pdf` |
| Image | `Image ingestion method` | `source-image-file` / `.png,.jpg,.jpeg,.gif,.webp,.bmp,image/*` / `Image file` | `source-image-url` / `https://example.com/photo.png` |

All match the pre-refactor literals. URL field keeps `aria-label="URL"` and `type=url`; the
toggle still emits `add-source-modal__type-btn--active` on the selected button only; switching
source type still resets to upload mode.

**End-to-end behavior, not just render:** created a real Text source via upload mode
(`hel720-probe.md` attached through the shared base's `handleFileChange`, name
`HEL720-skeptic-probe`, submit). The modal closed, the row appeared in the sources table as
`HEL720-skeptic-probe / Text/Markdown`, and the toast read *Data source
"HEL720-skeptic-probe" created.* This proves `onSubmit(mode, file, url)` still plumbs
correctly from the shared base through the unchanged `AddSourceModal` to the backend.

**Screenshots looked at (not just captured):**
- `.playwright-mcp/hel720-text-upload-light.png` (dark theme) — Text upload mode
- `.playwright-mcp/hel720-text-url-dark.png` — Text URL mode, correct placeholder
- `.playwright-mcp/hel720-image-upload-light.png` — Image upload, **light** theme
- `.playwright-mcp/hel720-pdf-url-light.png` — PDF URL, **light** theme

Light/dark parity holds: identical layout, spacing rhythm, and label hierarchy in both; the
active toggle and primary "Create source" button render their accent correctly in each theme;
no unreadable or unthemed surfaces. Console: **0 errors** across the whole session (the single
console error late in the log is from my own cleanup `fetch`, not the app).

**Design judgment.** This is an extraction, and it is a faithful one — it introduces no new
markup, no new class names, and no new hardcoded values; it *removes* two duplicate copies of
every token/class decision, which is a net DESIGN.md improvement (single source of truth for
the upload flow, which is exactly what P1.5/HEL-908 will consume). The remaining
off-pattern bits in this modal — the bare native `Choose File` control and the bespoke
`add-source-modal__*` classes instead of shared primitives — are **pre-existing on `main`,
byte-identical before and after**, and explicitly out of scope per the proposal's non-goals.
I am not refuting on them; see non-blocking notes.

### Verdict: CONFIRM

Ships. The AC are met and traceable, the gates are green under my own hands, the new
assertions are proven mutation-failable including the specific transposition failure mode the
design gate flagged, `AddSourceModal.tsx` is untouched and still type-checks against the
preserved exports, and the three flows behave and look identical in the running app in both
themes.

### Non-blocking notes

- The native `<input type="file">` ("Choose File") is unstyled against DESIGN.md and the
  `add-source-modal__*` classes duplicate what `frontend/src/shared/ui` primitives now offer
  (post-HEL-725). Both are pre-existing and were correctly excluded here. Now that the markup
  is single-sourced in `UnstructuredSourceForm.tsx`, a follow-up ticket to restyle it is a
  one-file change instead of a three-file one — worth filing.
- My probe source `HEL720-skeptic-probe` (id `268f75b0-f4d1-451e-aabf-395260982688`) remains
  in the shared dev DB. I could not remove it: the sources detail view exposes no delete
  control, and a direct `DELETE /api/data-sources/:id` from the page returned `403`. This is
  unrelated to HEL-720 (unchanged code path) and consistent with the many existing `SWEEP-*`
  leftovers, but noting it so it is not mistaken for real data.
