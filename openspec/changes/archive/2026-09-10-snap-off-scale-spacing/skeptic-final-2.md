## Skeptic Report — final gate (round 2, skeptic-final-2.md)

Cold re-derivation. Round 1's REFUTE was entirely about screenshot-evidence
integrity; the code/CSS/baseline were confirmed sound then and are re-confirmed
from scratch here.

### What I verified (with evidence)

**Screenshot integrity (the round-1 REFUTE) — genuinely fixed.**
- `md5sum *.png` over `.concertino/runs/HEL-830/evidence/screenshots/`: 53 files,
  exactly 7 duplicate-hash pairs, matching the claim. No sign-in-page byte-twins
  and no blank-page twins remain.
- Opened by eye (not by hash): `pipelines-list-768-after`, `pipeline-detail-768-after`,
  `settings-768-after`, `source-detail-768-after`, `sources-list-768-after`,
  `dashboards-list-768-after` — all show the real, correctly-named authenticated
  surface. Root cause 1 is fixed.
- Opened by eye: `pipeline-detail-desktop-before`, `settings-430-before`,
  `source-detail-desktop-before`, `dashboards-list-desktop-before/after` — all show
  real rendered pre-snap content (distinct "HEL-830 Recap Before …" fixtures), not
  blank pages. Root cause 2 is fixed.

**Gates re-run fresh by me, output read:**
- `npm run lint` → exit 0 (`--max-warnings=0`).
- `npm run typecheck` → exit 0.
- `npm run format:check` → "All matched files use Prettier code style!".
- `npm test` → 25/25 suites + 248 tests (root), 301/301 suites + 3197 tests (frontend), all green.

**Guard is failable, not vacuous (mutation probe):** reverted one snapped site
(`PipelinesPage.css` `var(--space-1)` → `5px`) and re-ran
`tokenAuditSweep.css.test.ts` → **1 failed** at `expect(unexpected).toEqual([])`.
Restored the file; re-ran → 46/46 pass; `git status --porcelain` clean.
`SPACING_BASELINE` is 10 entries (down from 62), all ≤4px optical tweaks.

**Independent re-scan (AC1):** ran `spacing-scan.js` from `frontend/src` myself —
55 remaining px off-scale hits, values exclusively 1px/2px/3px. Zero residual
literals above the 4px floor this ticket targets.

**Diff is spacing-only:** every non-comment `[+-]` line in the CSS diff is a
`margin`/`padding`/`gap`/`row-gap`/`column-gap` declaration; the only other
changes are comment text updating stale `14px` references to `16px`. No colour,
size, or layout-mode changes → theme parity structurally unaffected.

**AC2/AC6 (deliberate per-context choice + inline reasons):** 94 added
`/* HEL-830: … */` comments, each naming the target and the reason
(e.g. "6px -> 4px, dense preset-chip cluster reads loose at 8px" vs
"6px -> 8px, chip/badge padding reads compressed at 4px"). Not a blanket rule.

**AC7 (HEL-680):** `git diff main...HEAD -- frontend/` contains zero `chip-padding`
occurrences; the `7px` chip sites are snapped as literals only. Reconciled.

**Live app, my own eyes (both themes).** `start-servers.sh` + `assert-phase.sh
servers` → `PASS servers`. Confirmed the reused dev server actually serves the
post-snap CSS (`curl .../PipelinesPage.css?direct` returns `var(--space-*)`, no
raw px). Captured `/pipelines` at dark and at light (`helio-theme=light`, reload)
— `skeptic2-pipelines-{dark,light}.png`: spacing rhythm is pixel-parallel across
themes, table row/cell padding reads consistently with sibling screens, no
off-pattern one-offs, 0 console errors. Theme restored to dark afterwards.

### Verdict: REFUTE

One narrow but real defect, in the same artifact and the same class as round 1's
finding: a duplicate-pair explanation in `files-modified.md` that sounds plausible
and is **false**, plus a dup pair omitted from the enumeration. I measured this
directly rather than inferring it.

`files-modified.md` explains the dashboards-list duplicates as
`dashboards-list-{430,desktop}-{before,after}` being "pixel-identical because none
of `DashboardList.css`'s three snapped sites … produce a visible pixel shift in a
**single-plain-dashboard sidebar row**." Two things are wrong:

1. The **768** pair (`dashboards-list-768-{before,after}`, md5
   `06b0a1463e11c3fd75d01bf086859cd9`) is also an exact duplicate and is not listed
   at all — so the "7 pairs, all documented" claim covers only 6.
2. The stated reason is not the actual reason at 430/768. There is **no sidebar row
   at those widths**: opening `/` at 768 and querying the DOM, every
   `.dashboard-list*` node measures `0×0` (the sidebar is replaced by the mobile
   command bar). I clicked the `Switch dashboards` affordance to check for an
   alternative host — it opens a *different* mobile switcher sheet
   (`skeptic2-768-dashboard-switcher.png`); the `.dashboard-list__filter-input`
   stayed `0×0`. So `DashboardList.css` has **zero rendered pixels** at 430px and
   768px, and those two capture pairs are not visual evidence for that file at all
   — while AC3 ("visual verification at desktop, 430px and 768px for every surface
   touched") is presented as satisfied for it. Desktop coverage is genuine and its
   dup pair's explanation is fine.

(For the record, I confirmed the CSS itself IS live and correct at 768:
`getComputedStyle(.dashboard-list__filter-input).padding` = `0px 32px 0px 8px`,
i.e. the `30px`→`--space-7` snap applied.)

### Change Requests

1. `openspec/changes/snap-off-scale-spacing/files-modified.md`, "Verification
   method used this time" bullet list: add the missing seventh pair
   `dashboards-list-768-{before,after}` so the enumeration matches the actual 7
   duplicate hashes.
2. Same bullet: replace the "single-plain-dashboard sidebar row" reason for the
   430 and 768 pairs with the measured truth — `DashboardList.css` renders in the
   desktop sidebar only; at ≤768px every `.dashboard-list*` node is `0×0` (the
   mobile command bar's dashboard switcher is a different component), so those
   captures contain none of the file's markup. Keep the existing (correct) reason
   for the desktop pair.
3. Move `DashboardList.css`'s 430px/768px visual verification into the "Known
   gaps" section, stated as structural — the file has no narrow-width rendered
   surface, so AC3's 430/768 requirement is vacuous for it rather than met.

No code, CSS, baseline or gate changes are required — this is an
evidence-documentation correction only.

### Non-blocking notes

- The before/after fixtures are not strictly A/B comparable on some surfaces (e.g.
  `pipeline-detail-desktop-before` has one cast row, `-after` has two), so the
  pairs read as "both render correctly" rather than as a controlled spacing diff.
  Acceptable given the line-by-line diff review and the mutation-proven guard.
- All 53 captures are dark-theme only. Justified here (the diff touches no colour
  tokens), and I covered light mode live myself; worth noting for future UI tickets.
- `TimelineRenderer.css` and the 430/768 `run-history-modal` /
  `dashboard-appearance-editor` gaps are already honestly documented — no action.
