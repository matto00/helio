## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD: 3418a9cd63c71c2b6076405fa3cb42a586345f11. Base resolved live with resolve-review-base.sh: 032321ada8880dbfce4a1197c28e34d55b964388 (exit 0).
Commits: 142de4c9c (red e2e), 3418a9cd6 (implementation + jest). Lane constraints file read and followed (lane DB, empty
ANTHROPIC_API_KEY, 2 Playwright workers, scratch-only output, servers stopped via stop-servers.sh, residue user deleted by exact id).

### What I verified (with evidence)

- **Diff read in full** (5 files: FormPanel.css, FormPanelView.tsx, FormPanelView.test.tsx, FormPanel.css.test.ts, new
  e2e/hel1819-form-live-region-gap.spec.ts). Frontend only, no schema/migration. hel1791's spec is not edited (HEL-1826
  constraint honoured).
- **CSS (AC1)**: `FormPanel.css:10-11` adds `position: relative` to `.form-panel-view__fields`; `:28-30` adds
  `.form-panel-view__fields > :is(.form-panel-view__alert, .form-panel-view__status):empty { position: absolute; }`. No
  `display`/`visibility` change; the child combinator keeps the compact counter's regions (children of
  `.form-panel-view__compact-counter`) out of scope. The D1 containing-block concern checked: `.ui-toggle__input`
  (`shared/ui/Toggle.css:21-31`) is absolute with no offsets and `clip: rect(0,0,0,0)`, so moving its containing block
  to the field stack has no visual effect.
- **AC1 geometry, fresh**: servers started via start-servers.sh, `assert-phase.sh servers` = PASS. Ran
  `npm run e2e -- e2e/hel1819-form-live-region-gap.spec.ts e2e/hel1791-compact-counter-stack-height.spec.ts --workers=2`:
  exit 0, **10 passed**, no flakes (log: `.concertino/scratch/HEL-1819/skeptic-e2e.txt`). The gap test asserts
  `submit.top - lastField.bottom <= rowGap + 1` with rowGap from computed style, both themes, 390/768/1100.
  Independently in the live app (my own throwaway user): 1100 dark, sidebar open (sidebar-close control rendered,
  dashboards rail visible in screenshot) -> between=12, gap=12px, empty alert `position: absolute`; 390 light ->
  between=12, gap=12px, alert and status both `absolute` and still carrying their roles.
  Screenshots: `/home/matt/Development/helio/.concertino/runs/HEL-1819/evidence/e2e-evidence/HEL-1819/skeptic-1100-dark.png`,
  `.../skeptic-390-light.png`.
- **AC1 red is real**: commit 142de4c9c contains only the e2e spec (red-first). `evidence/red-e2e.txt` shows the gap test
  failing at `spec:192` with 36 px vs <= 13 in both light and dark (390 px; the per-width loop stops at the first
  failure). `git diff 142de4c9c HEAD -- e2e/` is empty, so the committed red spec is the spec that now passes. Note:
  the red log cites the per-kind test at :273 while the committed file has it at :275 (the red run used a pre-format
  copy two lines shorter after line 201); the gap assertion's lines 154/192 are identical, so this does not affect the
  red claim. Red at 768/1100 is corroborated by `heights-before.json` (+24.0 px form card at each width).
- **AC2 (messages render/announce from the same mounted regions)**: spec test at :201 holds an elementHandle captured
  BEFORE the submit and asserts, after it, the same node is connected, has role status/alert, `position: static`,
  visible, height > 0, between last field and Submit. Passed in my run ("The row was added." / "HEL1819 rejected submit").
  Visually confirmed: a client-validation submit at 1100 dark renders the alert summary in flow between Quantity and
  Submit with single gaps (`.../skeptic-1100-dark-alert.png`). Announcement itself is proxied by same-node + role, as
  for HEL-1804.
- **AC3 (other kinds unchanged incl. compact counter)**: my run wrote `heights-skeptic.json`
  (persisted: `/home/matt/Development/helio/.concertino/runs/HEL-1819/evidence/e2e-evidence/HEL-1819/heights-skeptic.json`).
  Its sha256 is identical to the executor's `heights-after.json`
  (b35a70be7d85ccc66518e31cd5341a5da964a06040f2dbd31cb9073e0d4a156b). Against `heights-before.json`: every kind 0.0 delta
  at 390/768/1100 (output, text, markdown, image, divider, compact counter 194.2/194.2/206.2); only the multi-field form
  changes, -24.0 px at each width (= exactly the two 12 px gap slots). hel1791's full spec (compact counter heights,
  in-flow messages) passes unedited. This is a content comparison, not an mtime ordering claim.
- **AC4 (scope addition)**: `FormPanelView.tsx:188` resets `burstRejectedRef` when a click starts with nothing in flight;
  `:281` sets it on a definite rejection; `:242` calls `onReconciled` only on the applied path (generation unchanged,
  pending empty), never in the catch; `:299-302` clears `setExternalErrors({})` unless a rejection settled in this burst.
  Colour is keyed only on `[aria-invalid="true"]` (CounterControl.css), so "not red" follows from not aria-invalid.
  Red: `evidence/red-jest.txt:229-235` shows test "HEL-1819 a" failing on base with `aria-invalid="true"` received (plus
  the 3 CSS guards; 4 failed / 39). Mutations: `mutation-b.txt` / `mutation-c.txt` each show the named guard failing at
  `FormPanelView.test.tsx:822` / `:851`, and those line numbers match the committed test file's final
  `aria-invalid` assertions. I did not re-run the mutations (read-only role); the evidence is consistent with the code.
- **Spec delta**: `specs/form-panel-submit/spec.md` ADDs the cross-burst clear and MODIFIES the rollback requirement's
  "only a later request's own success clears it" sentence; `specs/form-panel-rendering/spec.md` ADDs the region rule.
  Both match the implementation.
- **Gates, fresh**: `npx jest src/features/panels/ui/form` -> 6 suites / 97 tests passed. `npm run typecheck` exit 0.
  eslint `--max-warnings=0` on the three changed TS/TSX files exit 0. prettier --check on the spec and CSS exit 0.
  (Full-suite jest/build/lint taken from the evaluator's pasted exits.)
- **Design judgment**: no new values or tokens, positional CSS only; the card now ends at Submit plus the unchanged
  card padding, matching sibling cards' rhythm in both themes; the in-flow alert sits one stack gap below the last
  field and above Submit. Nothing an experienced eye would reject.
- **Cleanup**: my throwaway user's dashboard and sources deleted via API (204 x3), user deleted via
  `buildUserDeleteSql` by exact id (COMMIT; count now 0). Servers stopped with stop-servers.sh; ports 7251/10158 free.

### Verdict: CONFIRM

### Non-blocking notes
- The per-kind height test only records the table; "other kinds unchanged" is proven by offline comparison of before
  and after JSON, not by an assertion in the spec. A future regression to another kind's height would not fail this
  spec (hel1791 still guards the compact counter).
- `setExternalErrors({})` clears all field errors; safe today because the compact counter layout has one field and the
  existing success branch already does the same.
- A non-owner's counter never reconciles, so its stale error remains (design.md names this as a possible follow-up).
- FormPanelView.tsx is ~481 lines, above CONTRIBUTING's ~400 threshold (evaluator already flagged; HEL-1618 is next on it).
- The change dir is still untracked; the archive step must commit it.
