## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD `302dac54ff077495fa8891544bf96e767d4a2afb` against the live-resolved base
`2ce4a46706d0642fbfb82c2257b13403d920f19a` (`resolve-review-base.sh`, exit 0). Two commits, 11 frontend files.

### What I verified (with evidence)

**Spawn guard.** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=bug/output-editor-label-overflow/HEL-1432`.

**AC1: `Select` id pass-through, and C2.**
- `frontend/src/shared/ui/Select.tsx` adds an optional `id` and applies it only to the trigger `<button role="combobox">`.
  React omits `id={undefined}`, so a caller that passes no id renders no `id` attribute.
- `Select.test.tsx` has two new tests: "id lands on the trigger" and "absent id → `not.toHaveAttribute('id')`".
- Every one of the 16 ids appears exactly twice in non-test `.tsx` (the label's `htmlFor` plus the new `id`). No other
  caller passes an id, so no other DOM id in the app changes.

**AC2 and AC4 (extension): labels resolve to their controls. Red on the whole pre-fix tree (C1).**
- I extracted the entire base tree (`git archive 2ce4a46 frontend scripts/lib schemas`) into the scratchpad. I dropped in
  only the two HEAD test files and ran them.
  - `Select.test.tsx` fails to compile (TS2322: `id` does not exist on `SelectProps`).
  - `OutputEditorSheet.labels.test.tsx` fails 10 of 11 tests. The one that passes is the edit-mode "label click is a no-op"
    guard, which is expected to pass on the old code too.
- A plain red would not show that each id is guarded, because each test stops at its first failing assertion. So I ran
  a per-id mutation on a full HEAD copy: remove one `id=` line, run the label suite, restore, for each of the 16 targets.
  **Every removal turned the suite red** (output-kind: 3 tests, output-slot: 2, each of the others: 1). Every target
  has its own independent guard.
- The suite is all green on HEAD: 19/19 across the two files.
- Live app at 375px in edit mode on a table Output: `label[for]` → `output-kind` resolves to a disabled combobox, and its
  `aria-describedby` text is "An Output's kind can't be changed after…". `table-density` resolves to a combobox. There are no
  duplicate ids in the document.

**AC3: HEL-1388 locked-Kind description.** Covered by the test `toHaveAccessibleDescription(REASON)` and confirmed in
the live DOM, as above.

**AC5: overflow at 375 and 768, both themes; 1100/1440 unchanged (C3).**
- Fixture: a throwaway user with a static source whose first column has an 86-character name, plus a table Output.
  This is a longer name than the evaluator's 49-character fixture.
- 375 dark: overflow 0px. Card `scrollWidth == clientWidth` (293), document 375 == 375. Density row is one column
  (261px). Each column row is 79px: name line, then the 140px format select (HEL-469 wrapper intact; the long name
  ellipsizes at 199px, never 0px), then the move group (gap 16px = `--space-4`, a 44px line height, buttons at 28px
  centred, HEL-813 intact).
  - Screenshot: `/home/matt/Development/helio/.concertino/runs/HEL-1432/evidence/skeptic-final-long-dark-375.png`
- 375 light: overflow 0px.
  - Screenshot: `.../evidence/skeptic-final-long-light-375.png`
- 768 light: overflow 0px, card 678px, the name gets 582px.
  - Screenshot: `.../evidence/skeptic-final-long-light-768.png`
- 1100: `matchMedia('(max-width: 768px)')` is false, so none of the new rules can apply. All new CSS is inside that one
  media block (see the diff of `TableDisplayFields.css`), and the TSX changes add only `id` attributes. The desktop
  layout is therefore identical to base by construction, not by screenshot comparison. Measured: density
  `432.7px 432.7px`, rows `nowrap`, 40px.
- I judge the result against DESIGN.md:
  - Only existing tokens are used (`--space-2`, `--space-4`). The 44px is the documented tap floor already used by
    HEL-813.
  - The change is gated on viewport width only. It does not use `pointer: coarse`, which is correct for layout.
  - Light and dark are at parity: same geometry, all colours come from tokens.
  - The stacked row (name / control line) matches how other mobile form rows in the sheet stack. I would not reject it.

**AC6: lint.**
- I re-ran `npm run lint` (`--max-warnings=0`): clean.
- `typecheck`: clean.
- `format:check`: "All matched files use Prettier code style!".
- The diff adds 0 `eslint-disable` lines.
- Full Jest suite (`--maxWorkers=3`, nice 19): 501 suites, 5238 tests, all passed.

**Debugging law.** This is a layout/a11y defect, and the root cause is recorded with numbers in the CSS comment and
design.md. The regression guard for the label half is proven by the mutation above. The overflow half has no Jest guard,
because jsdom has no layout. It rests on live measurement, which I reproduced independently above.

**Console.** One error: `GET /api/pipelines/:id/schedule` returns 404 because the pipeline has no schedule. This
predates the change and is unrelated.

**Evidence soundness (CON-160).** No claim in this report depends on mtime or directory ordering. The 1100/1440
"unchanged" claim rests on the media-query scope of the diff (self-authenticating), not on before/after image order.

### Verdict: CONFIRM

### Non-blocking notes

- **A desktop long-name overflow exists before this change and is worse than reported.**
  - With my 86-character column name at 1100px, the Configuration card content overflows by **229.4px**, and the whole
    sheet body scrolls horizontally: section labels are cut off at the left and the density select at the right.
    Screenshot: `.../evidence/skeptic-final-long-dark-1100.png`.
  - The evaluator recorded 56–70px with a 49-character name. The overflow grows linearly with name length.
  - The cause is the same `min-width: auto` / auto-track floor this change fixes inside the mobile query, and it is
    provably untouched by this diff. The AC explicitly requires 1100/1440 to stay unchanged, so it is out of scope.
  - It should be filed as a follow-up with this measurement, not left as an evaluator footnote. The 7 off-surface
    dangling `htmlFor` targets need their follow-up too.
- At 768px the stacked row leaves the move group far from its 140px format select (screenshot above). It is coherent
  but sparse. A future pass could keep the row inline above a container-width threshold. This is a cosmetic choice.
- **Hygiene: a fixture from evaluation cycle 2 was never deleted.**
  - `eval-c2-created-ids.json` records that throwaway user `17fb8a3a-fffd-43b9-9617-41943dc7062e` still owns outputs
    `6d9289c6-…`, `e6c284c9-…`, pipelines `9d122649-…`, `3b68f753-…` and data sources `b10eb44b-…`, `28d8f9b4-…`. Every
    DELETE returned 401.
  - The orchestrator should delete them by exact id before teardown.
- **Hazard for concurrent lanes: the scratchpad is shared across sibling subagents.**
  - A cookie jar named `jar.txt` in it was overwritten mid-run by another lane's skeptic (user
    `hel1414-skeptic-…@example.test`).
  - My first DELETEs therefore went out under that user's session and returned 404, so nothing was harmed.
  - I re-ran the deletes under a private jar in a lane-specific subdirectory.
  - Use lane-unique filenames in the scratchpad.
- **My own fixture is cleaned up.**
  - Deleted by exact id: output `185ad639-09ed-4ade-a7e2-b7c618d03716` (200), pipeline
    `8a7f1f8d-7ccb-4515-90a3-db463bc0b747` (204), source `21b48f70-890a-4ef6-b3b2-5a69d990963a` (204).
  - I confirmed the user's lists are empty afterwards.
  - The user row `39b35e8d-60a9-4490-8308-7fd66a4d45bc` remains, because there is no account-delete endpoint.
  - Record: `.../evidence/skeptic-final-created-ids.json`.
- `persist-evidence.sh`, given absolute paths that were already in the evidence dir, also wrote nested duplicates under
  `evidence/.concertino/runs/HEL-1432/evidence/`. They are harmless. The original paths cited above are durable.
