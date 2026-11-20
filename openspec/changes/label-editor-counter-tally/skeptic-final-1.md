## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD `6b224f1b520d9c8cbf0842394c496820ed80858b` against the live-resolved base
`a867001d7b1c4c1484fc587ef34291552403885f` (`resolve-review-base.sh`, exit 0). Evidence below is my own, and
was persisted when it was captured (refs under `/home/matt/Development/helio/.concertino/runs/HEL-1788/evidence/.concertino/scratch/HEL-1788/`).

### What I verified (with evidence)

- **Diff read in full** (frontend + e2e): `counterTallyCaption.ts` (one constant), `FormFieldControl.tsx` (`tallyCaption`
  prop; caption `<p>` after `CounterControl`; caption id appended after any error/hint id), `FormPanelView.tsx`
  (`tallyCaption` iff `!isFormOwner` in the compact branch; `zeroCounterSeed = isCompactCounter && !isFormOwner`),
  `useFormPanelValues.ts` (flag in seed and re-seed key), `CounterControl.css` (tokens only). No backend or schema
  change, `openspec/changes/archive/**` untouched. The mechanism differs from design D3a's wording (a flag, not a
  stripped `initialValue`); the behaviour is the same.
- **AC1, desktop, light and dark.** A fresh fixture of my own: an owner and an editor grantee, plus a compact counter
  with `step: 5, initialValue: 10`. At 1440 px the editor sees value 0 (not 10) with "Your net change this session"
  under it in both themes (`skeptic-editor-desktop-light.png`, `skeptic-editor-desktop-dark.png`). The spinbutton's
  `aria-describedby` resolves to exactly the caption text, and `aria-valuetext` is "0, step 5". Computed colours in
  dark mode: `rgb(170,164,156)` on `rgb(26,24,22)`, about 7.2:1. No ancestor has opacity below 1. This matches the
  evaluator's pixel-measured 7.17:1 dark and 6.25:1 light.
- **AC1, phone.** At 390 px the caption is rendered and correctly associated, but it is not visible on load
  (`skeptic-editor-phone-dark.png`). See the non-blocking note: this is a pre-existing collapse of the card.
- **AC2, owner unchanged.** Signed in as the owner on the same panel, the counter shows `aria-valuenow=10`, has no
  `aria-describedby` and no caption element. With `tallyCaption` undefined and `zeroCounterSeed=false`, the code path
  is identical to the base.
- **AC3, no `/api/data-sources/*` request.** The editor page's resource timing list has zero `/api/data-sources`
  entries. The full e2e spec `e2e/hel1784-editor-form-submit.spec.ts` (C12) runs against the lane servers on
  7220/10127 with DB `helio_hel1788`: **7 passed**, including the editor no-dataset-read assertion and the new owner
  no-caption test (`skeptic-e2e.txt`).
- **AC4, red first.** I made a throwaway detached worktree at red commit `9f572d202` (tests only, plus the constant)
  and ran the two jest files: `Tests: 4 failed, 9 passed`. The FormPanelView failures are behavioural assertions:
  caption, zero seed, no-data-source-while-captioned and late re-seed. FormFieldControl.test fails compile with
  TS2322 on the unknown prop (`skeptic-red-jest.txt`). The worktree has since been removed. At HEAD, the form folder
  jest run gives 84/84 passed. The evaluator's four mutation probes (owner gate, describedby append, seed flag,
  re-seed key) all go red, and each one maps onto a test I read.
- **Screen-reader order.** DOM order is: label "Widgets", Decrease, spinbutton, Increase, caption `<p>`. The caption
  adds no tab stop and is announced with the value as its description.
- **Design judgment.** Only tokens are used (`--text-sm`, `--app-text-muted`). The caption is sans (copy, not data) and
  aligns with the label and counter column. It matches sibling form chrome in both themes and does not look
  off-pattern.

### Verdict: CONFIRM

### Non-blocking notes
- **Pre-existing phone defect: file a follow-up.** At 390 px every compact-counter form card in
  `mobile-panel-stack` collapses to 30 px. I reproduced this for the **owner** too (card 30 px, no caption;
  `skeptic-owner-phone-dark.png`), and that code path is untouched by this diff. My probe of the ancestor chain:
  `.crossfade` (`flex: 1 1 0%`, `min-height: 0`) and `.crossfade__layer` compute to 0 px inside the intrinsic-height
  card, and `.panel-content--form` is 24 px with `overflow-y: auto` (scrollHeight 56). So the tally and the caption
  are clipped for every user until someone scrolls inside a 24 px region. Until that is fixed, the phone half of AC1
  holds structurally but a phone user cannot see it.
- Hierarchy nit: the caption is `--text-sm` (14 px), which is larger than its field label (`--text-xs`, 12 px). The
  shared `.ui-form-field__hint` uses `--text-xs`. Matching the hint size would read as more consistent. It is
  legible either way.
- Reword design.md D3a to describe the `zeroCounterSeed` flag before archive, and tick task 3.3.
