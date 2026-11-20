## Evaluation Report — Cycle 2 (evaluation-2.md)

**Reviewed:** HEAD `3538becffaaccbc87c23fd2c3d38de826975cd7e`.
**Base:** `a867001d7b1c4c1484fc587ef34291552403885f`, resolved live by `resolve-review-base.sh`.
**New since cycle 1:** commit `3538becff`.
- The caption `<p>` now has the class `ui-form-field__hint counter-control__caption`.
- `.counter-control__caption` now holds only `text-align: center`.

**Evidence:** everything was persisted with `persist-evidence.sh` when captured, under
`/home/matt/Development/helio/.concertino/runs/HEL-1788/evidence/.concertino/scratch/HEL-1788/eval2-*`.

### Phase 1: Spec Review — PASS

The ticket's acceptance criteria stay met; see Phase 3. The style change follows the owner's ruling at Delivery: the
caption matches the 12 px shared form-hint style.

The working tree has uncommitted edits to `design.md` and `tasks.md`:
- D5 now describes the shared-hint styling.
- D3a now describes the `zeroCounterSeed` mechanism (cycle 1's suggestion).
- Task 3.3 is ticked.

These edits match the implementation, but they are **not committed at the reviewed HEAD**. At HEAD, design.md D5
still says `--text-sm`. They must be committed before merge; see the suggestions below.

### Phase 2: Code Review — PASS

**Gates.** I ran each of these fresh in WORKTREE_PATH at `3538becff`:

| Gate | Result |
| --- | --- |
| `npm run lint` | exit 0 |
| `npm run format:check` | all files pass |
| `npm --prefix frontend run typecheck` | exit 0 |
| Jest, `frontend/src/features/panels/ui/form` + `frontend/src/shared/ui` | 49/49 suites, 509 tests |
| Full `npm test` | 617 root tests + 10315 frontend tests, exit 0 |
| `npm --prefix frontend run build` | exit 0 |

**Does the shared class have side effects?** I checked every selector that matches `ui-form-field__hint`
(`grep -rn ui-form-field__hint frontend/src e2e`):
- `frontend/src/shared/ui/FormField.css:28` sets `margin: 0; font-size: var(--text-xs); color: var(--app-text-muted)`.
  That is exactly the ruled style, and the dropped declarations were the same values or now come from this rule.
- `frontend/src/features/panels/ui/PanelContent.css:412-416` shrinks hints to `--text-micro` inside the
  `panel-card` container query. That rule is scoped to `.form-panel-view__fields`, which is the stacked layout only.
  The compact counter lives in `.form-panel-view__compact-counter`, so the rule cannot match it.
  - Checked live: on phone the card is under 180 px, so the container query is active, and the caption still
    computes to 12 px. `--text-micro` is 10 px, so the shrink rule did not apply.
- No jest test or e2e spec selects `.ui-form-field__hint`.
- `FormField.tsx` uses the class only on its own `hintId` paragraph. The caption keeps its own `useId` id, so the
  `aria-describedby` wiring is unchanged.

### Phase 3: UI Review — PASS

**Setup:**
- `helio_hel1788` was recreated with `createdb`, and Flyway migrated it to 142 rows.
- Servers ran via `start-servers.sh` on 7220/10127, with `DATABASE_URL` set to the lane database, `DB_USER=matt`,
  and `ANTHROPIC_API_KEY` empty.
- Servers stopped with `stop-servers.sh`. The database was left in place as instructed.

**Fixture:**
- An owner and an editor grantee.
- Compact counter A: `step 5, initialValue 10`.
- Compact counter B: has `helpText: "Count gadgets"`, so the caption sits next to a real hint.

**Findings by item:**

**(1) Size and style.** For the editor, the caption computes to:
- `font-size` 12 px (`--text-xs` = 0.75rem), `margin` 0, `text-align` center, sans (Schibsted Grotesk).
- Colour rgb(100,94,86) in light and rgb(170,164,156) in dark, which is `--app-text-muted`.
- It sits centred directly under the counter, the same width as the counter (158 px) and 15 px tall.
- Screenshots: `eval2-editor-desktop-light.png`, `eval2-editor-desktop-dark.png`, `eval2-editor-phone-light.png`,
  `eval2-editor-phone-dark.png`.
- The phone card collapse is HEL-1791. It predates this change and is not counted here. To show the caption on phone
  I scrolled the card's inner area.

**(2) Contrast.** Measured from rendered device-scale pixels at the default panel opacity (computed opacity 1), as
the darkest glyph pixel against the dominant background pixel, using WCAG relative luminance:

| View | Text on background | Ratio | File |
| --- | --- | --- | --- |
| Desktop, light | rgb(100,94,86) on rgb(253,252,250) | **6.25:1** | `eval2-caption-desktop-light.png` |
| Desktop, dark | rgb(170,164,156) on rgb(26,24,22) | **7.17:1** | `eval2-caption-desktop-dark.png` |
| Phone, light | on rgb(244,242,237) | **5.73:1** | `eval2-caption-phone-light.png` |
| Phone, dark | on rgb(15,14,13) | **7.81:1** | `eval2-caption-phone-dark.png` |

- On phone the background is the scroll-edge gradient of the HEL-1791 clipped card, so those two figures are the
  worse case.
- Every ratio is at least 4.5:1.

**(3) Screen reader and reading order are unchanged from cycle 1.**
- Counter A: `aria-describedby` resolves to "Your net change this session". Reading order is label, then Decrease,
  then the value, then Increase, then the caption.
- Counter B: the description is "Count gadgets | Your net change this session", so the hint id comes first and the
  caption is appended after it.

**Owner view.** The owner sees:
- Counter A at value 10, with no caption and no description.
- Counter B with the description "Count gadgets" only, and no caption.

Screenshot: `eval2-owner-desktop-light.png`.

**(4) E2E.** I ran the full hel1784-editor-form-submit, hel1088-compact-counter-chrome, hel1087-form-submit-path
and hel1090-form-panel-assembled-a11y spec files with 2 workers. Result: **17 passed** (`eval2-e2e.txt`). The jest
results are listed in Phase 2.

**(5) No data-source requests.** The editor's network log covers load, a `+` click (`POST .../submit` 201, value 0 to
5), several reloads and theme changes. It has **0** `/api/data-sources/*` requests; the panel schema came from
`/api/panels/:id/form-schema` (`eval2-editor-network.txt`).

**Other checks:**
- No horizontal overflow at 1440 or 390.
- 0 console errors in each page load I reviewed.
  - The browser's all-session log does hold earlier entries: one 401 from `/api/auth/me` before sign-in, and
    `ERR_CONNECTION_REFUSED` against a dashboard id I never created.
  - Those predate this run's servers and are not from this change.

### Overall: PASS

### Change Requests
none

### Non-blocking Suggestions
- Commit the working-tree edits to `openspec/changes/label-editor-counter-tally/design.md` (D3a, D5 and the Risks
  line) and `tasks.md` (3.3) before merge. At HEAD `3538becff`, design.md D5 still specifies `--text-sm`, so the
  committed artifact does not match the shipped style. This report's `head_sha` covers the code, not those
  uncommitted documents.
- On a compact counter that also has `helpText`, the DOM shows the centred caption first and the left-aligned hint
  second. Both are now the same 12 px muted style. The screen reader announces them the other way round, hint then
  caption. This dates from cycle 1, but the shared style makes the two lines look more alike. Whether that looks
  right is a visual call for the skeptic. It is not a mechanical defect.
