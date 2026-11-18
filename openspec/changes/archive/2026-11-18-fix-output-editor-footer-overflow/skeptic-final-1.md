## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD `a2af4a52fefbc05b796c0f2109026a731dbbff6a`. The review base was resolved live by `resolve-review-base.sh`: `506c224423f3777f8090ef1f6705a501f9bd303e`. The branch has 2 commits. The only product change is 12 lines in `frontend/src/features/pipelines/ui/outputEditor/OutputEditorSheet.css`:
- `flex-wrap: wrap` on `.output-editor-sheet__footer`.
- A rule scoped to `.output-editor-sheet__footer .ui-modal-btn`: `height:auto; min-height:var(--control-md); padding-block:var(--space-1); text-align:center`.

The new e2e spec is `e2e/hel1752-output-editor-footer-fit.spec.ts`.

### What I verified (with evidence)

- **Cwd guard:** `READY ambient=/home/matt/Development/helio branch=bug/output-editor-footer-overflow/HEL-1752`.
- **Scope (C16):** the CSS is scoped to the sheet footer. The global `.ui-modal-btn` is untouched, and the confirm copy is unchanged. It uses tokens only (`--control-md`, `--space-1`) and never sets `min-height: 44px`, which DESIGN.md forbids. The `::after` 44px expander is unchanged.
- **Full affected e2e files (C12), run by me:**
  - Setup: lane DB `helio_hel1752`, servers on 7184/10091 started by `start-servers.sh`, `assert-phase servers` PASS, 2 workers, `nice -n 19`.
  - Result: **45 passed (4.5m)**, exit 0. Output: `.concertino/scratch/HEL-1752/skeptic/e2e-full.txt`.
  - The backend's pg connections were on `helio_hel1752`.
- **hel908-full-flow was never actually run, by me or by the evaluator:**
  - `playwright.config.ts:105` lists it in `testIgnore` (quarantine HEL-951/HEL-964), and Playwright filters it out even when it is named explicitly. Of the six files, only 5 appear in the run output.
  - So evaluation-2's claim that it ran "all six" is inaccurate. It is the same 45-test set.
  - I ran it on its own with a scratch config that un-ignores only that entry (`skeptic/pw908.config.ts`). It **fails at step 1** (`getByRole('menuitem', {name: 'Filter rows'})`, spec line 83). The page snapshot shows "+ Add step" now opens a `dialog "Add step"`, not a menu. The spec is stale against the current Add-step UI.
  - The failure comes before any Output sheet or footer is opened, so the 12 lines of footer CSS cannot cause it. It is pre-existing and quarantined. It is not a REFUTE, but it is recorded here so nobody cites it as passing evidence.
- **RED:** `red-run.txt` shows 4 phone tests failing on unmodified CSS with the ticket's symptoms: confirm `scrollHeight 60 vs clientHeight 30`, and Add-tail `lines 3`. Desktop passed.
- **Mutations, re-run by me without touching tracked files:**
  - Method: scratch copies of the spec inject a `!important` style via `addInitScript`. Output: `skeptic/mutations-skeptic.txt`.
  - (a) `flex-wrap: nowrap` failed all 4 phone tests: confirm "line count" in both themes, and "Add as tail with aggregate must fit one line" in both themes.
  - (b) `height: var(--control-md)` on the footer buttons failed confirm in both themes: "label rect outside its button by 2". Add-tail and desktop passed, as expected for single-line labels.
  - These match the executor's `mutations.txt` and `mutations-cycle2.txt`.
- **Running app, 375x812, my own screenshots:**
  - Confirm state, light: `ref=/home/matt/Development/helio/.concertino/runs/HEL-1752/evidence/.concertino/scratch/HEL-1752/skeptic/sk-phone-light-confirm.png`.
  - Confirm state, dark: `ref=.../skeptic/sk-phone-dark-confirm.png`.
  - The full label "Confirm delete (removes from 1 dashboard)" sits on its own line in a 295x46 danger-outline box. It is centered on two lines and fully inside the border. Cancel and Save are 32px (`--control-md`), right-aligned on the next line.
  - Before the confirm click, Delete/Cancel/Save share one row at 32px.
  - The danger treatment is the same in both themes.
- **Create mode, 375px:**
  - Screenshots: `ref=.../skeptic/sk-phone-light-add-tail.png` and `ref=.../skeptic/sk-phone-dark-add-tail.png`.
  - Cancel and "Add as tail with aggregate" (203x32, one line) are on line 1, and Save is alone at the bottom right on line 2. Every label is contained and every button is 32px.
- **Desktop 1280:**
  - The e2e measure log in my run shows the confirm state identical to the task 1.0 baseline: confirm 497/w311, Cancel 820/w80, Save 912/w67, all at top 222 and h32.
  - The tail state was Cancel 604, add-tail 696/w204, Save 912, h32, which also matches.
  - Screenshot: `ref=.../skeptic/sk-desktop-light-add-tail.png` shows one row.
- **Robustness to the HEL-1757 font change:**
  - The spec has no hard-coded pixel widths. Everything is derived live: `--control-md` via a probe, the expander height from computed `::after` style, and footer bounds.
  - It asserts invariants (containment, at most 2 lines, button height for single-line labels, one row at 1280, first-button-left equals footer-left, footer-right equals modal content-right), never a create-mode line grouping. So a font that flips the add-tail arrangement does not break it.
  - The one metric-sensitive assertion is "Add as tail with aggregate fits one line" at 375px. It needs about 203px against a 295–303px footer, which leaves about 90px of headroom. That is the ticket's AC, and it is robust.
  - I did not run against main's HEL-1757 fonts, because the branch predates them. The rebase at delivery will exercise that.
- **AC trace:**
  - AC1 (confirm fits, light and dark): screenshots plus the e2e containment and line assertions, which pass on the fix and are RED without it.
  - AC2 (add-tail not squeezed): it is one line in both themes, and the e2e asserts `lines === 1`.
  - AC3 (full label kept): `expect(confirm?.text).toBe(CONFIRM_TEXT)`, and the copy is visible in the screenshots.
  - AC4 (desktop unchanged): measured geometry equals the baseline.
- **Residue:** I deleted the skeptic user `ad0cb4d2-2a63-4f22-bf2b-7d34f1466ee4` from `helio_hel1752` by exact id via `buildUserDeleteSql` (count after: 0). The e2e teardown reported "deleted 45 recorded throwaway user(s)". Servers were stopped with `stop-servers.sh`.

### Verdict: CONFIRM

### Non-blocking notes
- **Evaluator evidence defect:** evaluation-2 lists hel908-full-flow among the files that passed, but `testIgnore` silently excludes it. The real file fails at a stale Add-step locator, which is unrelated to this change (see above). Future C12 lists should drop it or name it as quarantined.
- **e2e screenshot path collision:** `e2e-evidence/HEL-1752/*.png` is overwritten by any later run of the spec, including my mutation copies. Those files currently show mutated states, so cite the persisted `.concertino/scratch` copies, not `e2e-evidence/`.
- **Phone create-mode layout:** Save sits alone on line 2, apart from Cancel. This is acceptable and in-language: the primary action is right-aligned at the bottom. The design.md risk list already accepts it.
- **Confirm label break:** at 375px the confirm breaks "from 1 / dashboard)". This is cosmetic only.
