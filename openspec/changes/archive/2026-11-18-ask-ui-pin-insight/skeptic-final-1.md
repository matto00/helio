## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD `a103cd4566ce1a6e837f8e523117e51771215267`, branch `feature/ask-ui-pin-insight/HEL-1746`. The base resolved live to `f2358c16d` through `resolve-review-base.sh` (exit 0). Spawn-cwd guard: `READY`. Servers: `start-servers.sh` reused healthy servers on 7178 and 10085. I confirmed both ports' listening PIDs have their cwd in this worktree (`.../HEL-1746/frontend` and `.../HEL-1746/backend`), so this is not a stale server from another lane. `assert-phase.sh servers` printed `PASS`.

### What I verified (with evidence)

**Gates, re-run fresh by me**
- The full affected e2e set: hel1746-ask-ui, hel1744-insight-panel, hel1003, hel666, hel1575-dashboard-tabs, hel1510, hel1331, hel1668-header-meta, hel813 (both files), hel1583-glass-nav and hel1582-mobile-pipeline. Run with `DEV_PORT=7178 BACKEND_PORT=10085 nice -n 19 npx playwright test ... --workers=2`.
  - Result: **140 passed (12.5m), EXIT 0**, with no failed or flaky test.
  - The global teardown deleted the 148 recorded throwaway users.
  - Log: `/home/matt/Development/helio/.concertino/runs/HEL-1746/evidence/.concertino/scratch/HEL-1746/skeptic/e2e-run1.txt`.
- `AskSeamSpec` via `sbt -J-Xmx3g "testOnly com.helio.api.protocols.AskSeamSpec"`.
  - Result: **succeeded 6, failed 0**: 200 with a pin, 200 with `pin: null` for a viewer, 422 ASK_UNGROUNDED, 422 ASK_ANSWER_TRUNCATED (a real `stop_reason=max_tokens` hop in the log), 403 and 429.
  - Log: `/home/matt/Development/helio/.concertino/runs/HEL-1746/evidence/.concertino/scratch/HEL-1746/skeptic/seam.txt`.
- jest for `features/ask`, OutputEditorSheet, BottomSheet, CommandBar, DashboardMetaRow and useMetaRowTier: 28 suites, 324 tests passed, 19 snapshots.
- `npm run typecheck` exited 0, `npm run lint` exited 0, and `npm run check:schemas` passed.

**Acceptance criteria, traced to code and to the run**
1. **Ask, answer, pin, and a new insight Output appears.** Under the ruling, "renders" is met as placed in the not-yet-rendered state.
   - `useAsk` sends the question. `AskAnswerCard` renders the answer through the reused `InsightMarkdown` and `CitationChip`.
   - `useAskPin` POSTs `pin.request` unchanged (through the thunk or the service) and then places the panel with `createPanel` for the owner.
   - The e2e test proves each step. It asserts that the posted body equals the fixture's `pin.request`, that the create returns 201 with `kind: "insight"`, and that the panel POST returns 201. It then finds the stored insight in the real GET outputs and sees the card's "Not yet rendered" status.
   - I saw this myself in `ask-placed-dark-desktop.png` and `ask-placed-light-phone.png`: the new panel "How do revenue and cost compare?" shows "Not yet rendered".
2. **A viewer sees no pin action.**
   - On the client, the action renders only when `response.pin !== null` (`AskAnswerCard.tsx`). There is no client role logic, and M4 is recorded as the mutation for this.
   - On the server, `AskPinBuilder` returns a pin only for Owner or Editor. AskSeamSpec's viewer case writes `pin: null` for real.
   - The e2e viewer holds a pipeline viewer grant, uses the Output sheet, and sees no Pin.
   - The dashboard drawer is effectively owner-only, because `GET /api/dashboards` lists owned dashboards only. The spec documents this inline, and it is a true, pre-existing limit of the shell rather than of this change. The AC holds through the Output sheet plus the server-side seam. I accept this as proof.
3. **Keyboard use and focus in a real browser.**
   - The e2e drives the whole flow by keyboard: opening, the field focused on open, Enter to submit, Enter on a chip with Escape returning to the chip, Enter on Pin, and Escape returning focus to the opener.
   - It also covers the kebab item at 900px, with focus returning to the kebab trigger, and the phone kebab.
   - All 8 drawer variants and both kebab tests passed in my run.
4. **Light and dark, desktop and phone.** The e2e matrix runs both themes on 1280 and 390 viewports. I looked at the screenshots from my own run (listed below).

**Driver rulings and constraints**
- **C1 (seam).**
  - The only `page.route` is the `/ask` regex in `e2e/support/askFixtures.ts`. The pin and everything after it hit the real backend: the e2e waits on real 201s.
  - Each fixture is Ajv-validated before and after id substitution.
  - AskSeamSpec checks the RAW body against the schema, then checks fixture equality and fixture schema validity. M1 mutated a fixture and the spec failed.
  - The 429 case is real, from a seeded `assistant_daily_usage` row, not schema-only.
- **No model picker, no billing-weight copy.**
  - The e2e asserts `combobox` count 0 in the drawer.
  - `askErrorCopy` never interpolates `limit`, and M5 is recorded as its mutation.
  - `mapAskResponse` allow-lists fields, so no model, usage or cost value reaches state.
- **C2.**
  - The `BottomSheet.size.css.test.ts` CSS-text guard exists, with mutations M2 and M3 recorded.
  - The e2e measures the drawer at 540px on desktop and at the viewport width on a phone. This passed in my run.
- **No production backend change and no migration (R9).** The diff touches only `backend/src/test/...AskSeamSpec.scala`.
- **The admitted red-first gap.** The frontend unit tests were written alongside the module, not before it. `mutations.md` records M2-M28, each removing one guarded behaviour and naming the test that failed. I read the tests behind M4, M5, M8, M13-M18 and M20-M21; they assert the stated behaviour against the real service, thunks and store, with only `httpClient` mocked.
  - I did not re-run the mutations, because this role does not modify code.
  - This gap is acceptable, for two reasons. First, the AC-bearing behaviour is independently proven by e2e on the real build and by the backend seam, and the seam had a recorded red run. Second, the mutation table is specific and covers each guard.
  - The PR should state this honestly, as `red-evidence.md` already does.

**UI and design judgment** (DESIGN.md, against the running app, from screenshots captured fresh in my run)
- **Meta row.**
  - Ask is a borderless secondary `IconButton`, and Add panel stays the single accent control.
  - The `MessageCircleQuestion` glyph reads as distinct from the assistant's two-bubble `MessagesSquare`, so `CircleHelp` is not needed.
  - The tier thresholds moved by +40 (860/680) and are recorded in `measurements.md`. DESIGN.md §9 is amended to match. The hel1668 meta-row and hel1003 specs passed.
- **Drawer, desktop.**
  - It is the shared `BottomSheet`/`Modal` at size `md` (540px), with a labelled `FormField`/`Textarea`, the `ui-modal-btn` recipe and a soft answer card on `--app-surface-soft`/`--app-border-subtle`.
  - Light and dark are at parity (`ask-pinned-light-desktop.png` vs `ask-pinned-dark-desktop.png`). The error banner is the shared `InlineError` (`ask-ungrounded-dark-desktop.png`).
- **Phone.**
  - The swipe sheet shows its grab handle and spans the full width.
  - The chips and the secondary Pin button fit, with no overflow (`ask-answer-dark-phone.png`).
  - The upsell sits in a soft card, and focus rests on the dialog title, since the free tier has no field (`ask-upsell-light-phone.png`).
- **Output sheet.**
  - The disclosure group matches the neighbouring card groups.
  - In a draft, Pin is disabled and the visible reason "Save or discard your draft to pin." is tied to it by `aria-describedby` (`ask-sheet-draft-dark-desktop.png`).
- **Tokens.** `ask.css` uses only `--space-*`, `--text-*`, `--app-*` and `--app-radius-md`. It sets no width override and contains no hardcoded colour.
- I found no off-pattern UI that I would reject.

Persisted evidence (refs):
- `/home/matt/Development/helio/.concertino/runs/HEL-1746/evidence/e2e-evidence/HEL-1746/ask-pinned-light-desktop.png`
- `/home/matt/Development/helio/.concertino/runs/HEL-1746/evidence/e2e-evidence/HEL-1746/ask-pinned-dark-desktop.png`
- `/home/matt/Development/helio/.concertino/runs/HEL-1746/evidence/e2e-evidence/HEL-1746/ask-answer-dark-phone.png`
- `/home/matt/Development/helio/.concertino/runs/HEL-1746/evidence/e2e-evidence/HEL-1746/ask-placed-light-phone.png`
- `/home/matt/Development/helio/.concertino/runs/HEL-1746/evidence/e2e-evidence/HEL-1746/ask-placed-dark-desktop.png`
- `/home/matt/Development/helio/.concertino/runs/HEL-1746/evidence/e2e-evidence/HEL-1746/ask-sheet-draft-dark-desktop.png`
- `/home/matt/Development/helio/.concertino/runs/HEL-1746/evidence/e2e-evidence/HEL-1746/ask-upsell-light-phone.png`
- `/home/matt/Development/helio/.concertino/runs/HEL-1746/evidence/e2e-evidence/HEL-1746/ask-ungrounded-dark-desktop.png`

These screenshots are fresh because my e2e run wrote them (the files changed between 07:57 and 07:59, during my run). The claim rests only on their content, not on the timestamps: each one shows this run's lane-specific dashboard names, such as "HEL-1746 board dark desktop".

### Verdict: CONFIRM

### Non-blocking notes
- **The e2e substitutes `rootId` with the real root id.** The server's `AskPinBuilder` falls back to the *pipeline id* as `rootId` when an Output has neither a step nor a root (that is how the harness fixture got `"rootId": "{{PIPELINE_1}}"`). The browser test therefore never exercises that fallback body against the real create route. This belongs to HEL-1745's pin builder, not this UI. It is worth a follow-up check that a create POST with a pipeline-id `rootId` is accepted, or that real Outputs always carry a root or step.
- **The question text carries across dashboards.** `AskPanel` stays mounted inside the always-mounted `Modal`, so the typed question persists when the user switches dashboards. The answer state does reset by scope key. This is minor and arguably convenient.
- **The upsell sheet on a phone is shorter than the answer sheet.** In `ask-upsell-light-phone.png` the sheet starts near y=245, while the answer sheet is full height. This is probably a capture during the entrance or a content-height difference; it is cosmetic.
- **Untracked review files.** `evaluation-2.md` and `evaluation-3.md` are untracked, and `workflow-state.md` is modified. The delivery commit should include them.
- **Content the PR must state:**
  - the `/ask` browser seam and its server-side pin;
  - placement in the not-yet-rendered state while HEL-1743 is parked;
  - that the dashboard drawer is owner-only in practice, with the viewer AC proven on the Output sheet and in AskSeamSpec;
  - the mutation-instead-of-red proof for the frontend unit tests.
