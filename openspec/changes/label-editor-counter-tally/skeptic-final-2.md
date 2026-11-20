## Skeptic Report — final gate (round 2, skeptic-final-2.md)

Reviewed HEAD: `3538becffaaccbc87c23fd2c3d38de826975cd7e`. Base resolved live with `resolve-review-base.sh`:
`a867001d7b1c4c1484fc587ef34291552403885f`. The diff has 3 commits: red tests `9f572d202`, implementation
`6b224f1b5`, and the shared-hint restyle `3538becff`.

Evidence is under `/home/matt/Development/helio/.concertino/runs/HEL-1788/evidence/.concertino/scratch/HEL-1788/skeptic2/`
(`EV/` below). Each file was persisted with `persist-evidence.sh` right after it was captured.

### What I verified (with evidence)

**Code, from the full diff `git diff a867001d7...HEAD`:**
- `FormFieldControl.tsx`:
  - Adds `tallyCaption`. When it is set, a `<p id={captionId} className="ui-form-field__hint counter-control__caption">`
    renders after the control.
  - `describedBy` becomes `[baseDescribedBy, captionId].filter(Boolean).join(" ")`. The caption id is appended; it does
    not replace the error or hint id.
  - With no caption, the output is unchanged.
- `FormPanelView.tsx`:
  - `tallyCaption={isFormOwner ? undefined : COUNTER_TALLY_CAPTION}` is passed only in the compact branch.
  - `isCompactCounter` moved above the hook so it can feed `useFormPanelValues(..., isCompactCounter && !isFormOwner)`.
- `useFormPanelValues.ts`:
  - `zeroCounterSeed` seeds counters with `emptyValueFor`, which shows as 0.
  - The re-seed key gains `#zero` only while the flag is set.
  - The owner path is identical, and the parameter defaults to `false`.
- `CounterControl.css`: the only new rule is `text-align: center`. There are no hardcoded values; size, colour and
  margin come from the shared `.ui-form-field__hint` (`frontend/src/shared/ui/FormField.css:28-32`).

**Gates, run fresh by me at 3538becff:**

| Gate | Result |
| --- | --- |
| Jest `features/panels/ui/form` (3 workers, nice 19) | 4 suites, 84 tests, all passed |
| `npm --prefix frontend run typecheck` | exit 0 |
| `eslint --max-warnings 0` on the form folder | exit 0 |
| Playwright, full files `e2e/hel1784-editor-form-submit.spec.ts` and `e2e/hel1088-compact-counter-chrome.spec.ts`, 2 workers, against the lane servers on 7220/10127 | 8 passed |

The 8 passing e2e tests include the new editor caption and accessible-description assertions, and the new "owner's
compact counter carries no tally caption" test.

**Red first.** Commit `9f572d202` adds only the tests and the caption constant. Its message records that the hooks were
bypassed because typecheck and jest fail by design. The tests assert caption text that nothing rendered at that
commit, so they could not pass there. Evaluation-1/2 record the mutation probes; I did not re-run them, because this
role is read-only.

**Live UI.** The fixture was my own:
- An owner and an editor grantee.
- Compact counter "Widgets" with `step 5, initialValue 10`.
- Compact counter "Gadgets" with `helpText`.

I measured with `page.evaluate` and screenshots (`EV/result.json`):
- **Editor, 4 combinations (desktop and phone, light and dark):**
  - Both captions read "Your net change this session". They are 12px, centred, in Schibsted Grotesk, and visible.
  - Caption colour is rgb(100,94,86) in light and rgb(170,164,156) in dark, which is `--app-text-muted`.
  - Widgets shows `aria-valuenow=0` even though `initialValue` is 10.
  - Accessible description: Widgets = [caption]; Gadgets = ["Count gadgets", caption].
- **Owner, 4 combinations:**
  - No caption.
  - Widgets `aria-valuenow=10`.
  - Gadgets description is ["Count gadgets"] only.
- **Network:** the editor made **0** `/api/data-sources/*` requests in all 4 loads. The owner's `/schema` reads are
  expected and unchanged.
- **Console:** 0 errors in all 8 loads.

### Acceptance criteria trace

1. **The caption appears for a non-owner, on desktop and phone, in light and dark.** Met.
   - Code: `FormPanelView.tsx` compact branch, and `FormFieldControl.tsx` caption `<p>`.
   - Desktop screenshots: `EV/editor-desktop-light.png`, `EV/editor-desktop-dark.png`.
   - Phone screenshots: `EV/editor-phone-dark-caption-b.png`, where the caption is legible on the phone card.
   - The wording differs from the ticket's example, and the ticket allows that. "Net change" is more accurate than
     "clicks" when `step` is not 1, as design D3 argues.
   - On phone the card collapses for the owner too (`EV/owner-phone-light.png`). That is pre-existing and tracked as
     HEL-1791.
2. **The owner's counter is unchanged.** Met: `EV/owner-desktop-light.png`, the owner rows in `EV/result.json`, the jest
   owner test and the e2e owner test.
3. **No `/api/data-sources/*` request from a non-owner.** Met: the `dsRequests` editor entries in `EV/result.json` are
   all `[]`, plus the jest and e2e assertions.
4. **A test that fails first.** Met: the red commit `9f572d202` comes before the implementation.

The spec delta's 4 scenarios (editor caption, initialValue ignored, owner none, stacked none) are covered by jest. The
first and third are also covered live.

### Design judgment

The caption sits directly under the tally:
- It is centred and as wide as the counter.
- It uses the same 12px muted hint style every form uses.

Light and dark match. It reads as secondary copy, not data, and the compact block stays vertically balanced in the card.
It reuses the shared form-hint class and adds no new tokens. This is consistent with the sibling form panels.

### Verdict: CONFIRM

### Non-blocking notes

- **design.md and tasks.md must be committed before merge.** At HEAD `3538becff`, the committed `design.md` D5 still
  specifies `--text-sm`, and D3a describes the abandoned strip-`initialValue` mechanism. The accurate versions are
  uncommitted working-tree edits. I reviewed that diff (`git diff HEAD -- openspec`) and it matches the shipped code.
  Commit it verbatim. If the merged artifact still says `--text-sm`, it diverges from the code.
- **Hint and caption order differ visually and in the accessible description.** On a compact counter that has
  `helpText`, the screen shows the centred caption first and the left-aligned hint second
  (`EV/editor-desktop-light.png`, Gadgets card). The accessible description reads the hint first, then the caption. Both
  are the same 12px muted style, so the two lines look slightly stacked. This is acceptable, and is a candidate for a
  later polish pass if anyone cares.
- **Cleanup.** My fixture's two users were deleted by exact id through `buildUserDeleteSql`; a count check shows 0
  remain. The servers were stopped with `stop-servers.sh`. The lane DB was left in place.
