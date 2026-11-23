## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD `d391d7ef763188ffdda5732d7660b997c5922774` against the live-resolved base
`032321ada8880dbfce4a1197c28e34d55b964388` (`resolve-review-base.sh`, exit 0).

### What I verified (with evidence)

- **Spawn-cwd guard:** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=bug/auto-run-trigger-badge-style/HEL-1822`.
- **The diff, read in full.** Product code: one 8-line rule, `.run-history-modal__trigger--auto-run`
  (`RunHistoryModal.css:79-86`), set to `color: --app-text; border-color: --app-border-strong; background: --app-surface-raised`.
  This matches the owner ruling exactly. All values are tokens; there are no raw values.
  `RunHistoryModal.tsx:62` already emits `run-history-modal__trigger--${triggerSource}`, so the modifier needs no TSX change.
  The other changes are a comment-only edit in `TriggerSourceMigrationSpec.scala`, the contract test tightened to exactly the
  four labels, the `tokenAuditSweep` baseline line moved 162 -> 170 (a pure shift, because the rule was inserted above it),
  and the new e2e spec.
- **AC1 (fails first; own modifier; visibly different from manual in both themes).** Commit `16f42588d` contains only the spec
  and the openspec artifacts, with no CSS. Its recorded red run (`.concertino/scratch/HEL-1822/red-run.txt`) fails both themes
  on fill-vs-row 1.00. On HEAD I re-ran `e2e/hel1822-auto-run-trigger-badge.spec.ts` myself (DEV_PORT=7254, lane DB,
  2 workers): **2 passed**. Log ref: `/home/matt/Development/helio/.concertino/runs/HEL-1822/evidence/.concertino/scratch/HEL-1822/skeptic-e2e.txt`.
  The spec asserts the `--auto-run` class, the fill against the row and against manual, that the text colour differs from
  manual, and text-on-fill. Failures are reported per theme with `expect.soft`.
- **AC2 (contrast measured and stated).** My run reproduced the claimed values. Each is computed from `getComputedStyle`
  on the rendered page, with the badge fill composited over the row's opaque fill:
  - light: text-on-fill **16.74:1**, fill-vs-row **1.179** (fill `rgb(255,255,255)` on row `rgb(239,236,230)`)
  - dark: text-on-fill **14.16:1**, fill-vs-row **1.122** (fill `rgb(35,32,25)` on row `rgb(22,21,20)`)

  Both clear 4.5:1 and the HEL-866 1.10 floor. The badge has no hover state of its own, so the state-surface floor applies
  only as the "visibly distinct" measure.
- **Leftovers.** The Scala doc comment now names V110's `auto-run` widening. The contract test asserts that the sorted labels
  equal the four known labels, so "Unknown" can no longer pass. I re-ran `runHistory.contract` and `tokenAuditSweep` with
  jest: 2 suites, 43 tests, all passed.
- **UI judgment: the design-gate watch item (does the badge read as interactive next to the row toggle's hover?).**
  Servers were started with `start-servers.sh`, and `assert-phase servers` printed `PASS`. I drove a scratch Playwright
  script, kept outside the worktree, over the shared run-history fixture plus two added failed rows (auto-run and manual),
  so that the "Show log" toggle sits on an auto-run row. Screenshots at 2x DPR:
  - 1280 list, light: `/home/matt/Development/helio/.concertino/runs/HEL-1822/evidence/.concertino/scratch/HEL-1822/skeptic-vis/shots/light-1280-list.png`
  - 1280 list, dark: `.../skeptic-vis/shots/dark-1280-list.png` (same evidence root)
  - toggle hovered on an auto-run row: `.../light-1280-auto-row-toggle-hover.png` and `.../dark-1280-auto-row-toggle-hover.png`
  - phone Runs tab at 430: `.../light-430-list.png` and `.../dark-430-list.png`

  Measured on the hovered row: the toggle and the badge have **identical** computed colours in both themes. Light is
  `rgb(255,255,255)` / `rgba(33,29,25,0.2)` / `rgb(33,29,25)`; dark is `rgb(35,32,25)` / `rgba(242,239,233,0.18)` / `rgb(242,239,233)`.
  They differ in radius (badge 9999px pill, toggle 6px), type (micro semibold vs xs regular), cursor (badge `auto`) and
  position (the badge sits in the left chip cluster beside the StatusChip, the toggle is pinned right with `margin-left: auto`).

  **Judgment: the badge does not read as interactive.** On the rendered page it reads as a chip. It has the same pill shape
  and micro-semibold label as the Scheduled and External badges, and it sits in the same cluster as the status pill. The
  toggle's rectangle and larger regular-weight label keep it reading as the row's only control. The shared colour triple is
  only visible while the pointer is over the toggle, and even then the shape difference separates the two. On the phone
  layout there is no hover, and the badge stays in the chip line. Light and dark are at parity: both read as a neutral raised
  chip, and neither collides with the hue-coded scheduled, external or status pills.
- **Pre-existing hel1774 1280x800 failures.** I did not re-run these. The CSS selector matches only the trigger span inside
  the run-history row, which cannot reach the Share or Schedule dialogs, and the evaluator's base-tree reproduction log
  exists at `.concertino/scratch/HEL-1822/eval-e2e-main-tree.txt`. I accept the structural argument, and I place no reliance
  on mtime ordering.
- **Servers:** stopped with `stop-servers.sh`, which printed `STOPPED ports=7254,10161`. Throwaway users were deleted by
  globalTeardown: 4 + 2 for the scratch visual runs and 2 for the spec run.

### Verdict: CONFIRM

### Non-blocking notes
- In light theme the Auto-run pill (pure white fill, `--app-text`, 16.7:1) is the loudest trigger badge in the row, louder
  than the hue-coded Scheduled and External badges, even though auto-run is a routine trigger. The owner ruled this
  treatment, so this is an observation, not a request.
- The Manual badge (transparent, `--app-border-subtle`, muted text) matches the app's resting secondary-button recipe
  (`Modal.css:230`, `IconButton.css:70`). That resemblance to a control predates this change and is not in scope.
- Evaluator Phase 3 suggestion: the HEL-1774 1280x800 Share/Schedule failures on main still need an owner.
