## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD `c07dd1c6401fe44d174e39afa5b05082c938d28c` against live-resolved base `626cf9852948bc5743320cf93a77f92c921f239a`.

### Phase 1: Spec Review — FAIL

Issues:

1. **D2 / spec delta "A seeded connector's controls are sampled" is not met at 1440.** `assertConnectorControlsCovered` (`e2e/support/state-surface-contrast-guard.ts:697-728`) checks the controls' doc ids against `covered`. At 1440 that is `[mainDocIds]` (`:963-965`), the value `probeView` returns. `probeView` returns `collectCandidates(...).docIds`, which holds **every visible element, sampled or not**. The comment at `:345-347` says so: "docIds already covers every VISIBLE element regardless of sampling". So the assertion proves the controls are visible in `<main>`. It does not prove they were measured. Its failure message ("is not in the sampled set") claims more than the check does. design.md D2 was written for exactly this case: "a later header control could sample the connector controls out while the partition check still passes". The assertion cannot fail in that case. The 1440 route cells have no `fullySampled` check, so nothing else catches it.
   - The narrow cells are covered in effect, because `fullySampled(viewName, main)` (`state-surface-contrast-guard-narrow.ts`, just before the new call) forces candidates == visible.
   - The 1440 `/connectors` view has 10 visible elements against `MAX_ELEMENTS_PER_VIEW` = 24, so nothing is sampled out today. This is a guard that cannot fail for the reason it exists, not a live miss.
2. **tasks.md 3.4 is ticked `[x]`, but the executor did not do the visual check** (the orchestrator brief says so, and no evidence file records it). The evaluator did it in this review (see Phase 3). The task must not claim work that was not done.

Otherwise PASS:
- AC1: red was committed before any CSS change. `529752708` touches only e2e support files and the change dir. The red logs name the row, actions trigger and Test connection (Test connection only at 1440/1100, where it is mounted) in both themes at 1440/1100/768/390.
- AC2: green in both themes (my run, below).
- AC3: CI time is stated in ci-impact.md: -2 s / -1 s / +1 s per file, within noise, and shard weights were not hand-edited.
- C2 (owner ruling) is honoured:
  - The header root cause was probed before any change (evidence/header-rootcause.md). A sticky Actions column covered the button during the forced hover, so `elementFromPoint` landed on `.connectors-page__th--actions`. That makes it a probe artifact, so the probe was fixed and `SortableTh.css` is untouched.
  - The only new exemption is `[connectors-page__scroll]`. It is hover-only (inside `r.forced === "hover" && (...)`), keyed on the first-class token (an exact bracket match, so it cannot match `--left`/`--right`), and has a written reason. Its focus is still measured (my log: `/connectors@390 ... [connectors-page__scroll] (#2) (focus) advisory`, not exempted).
- D1 holds: the seed is offline (`.invalid` TLD, `authType: none`, never clicked) and opt-in for `/connectors` only. D3's selectors are scoped to `.connectors-page__row-actions`, so the modal is unaffected.

### Phase 2: Code Review — FAIL (on Phase 1 item 1, which is a guard-code defect)

Gates, my own fresh runs in WORKTREE_PATH:
- `npm run lint`: pass (0 warnings). `npm run format:check`: pass. `npm run typecheck`: pass.
- `npm test`: root 71 suites / 621 tests, frontend 902 suites / 10480 tests, all pass (3 workers).
- `npm --prefix frontend run build`: pass.
- Guard spec files, full files, Playwright 2 workers, lane DB, `HEL_GUARD_LOG_RATIOS=1`:
  - routes-light: 8 passed
  - narrow-1100-768: 12 passed
  - narrow-390: 8 passed
  - routes-dense: 8 passed
  - overlays-chrome: 4 passed
- Ratios after the fix: row / trigger / Test connection 1.1866 (dark) and 1.1188 (light) at every width where mounted. The red run had 1.057 (dark) and 1.054 (light).

**The probe change (probeView centres the candidate before the forced hover) was verified by an A/B run.** I made a throwaway detached worktree at HEAD with only the 3 `scrollIntoView({inline:"center"})` lines removed, then ran all 5 guard spec files against the same servers and CSS. I compared the normalized per-element verdict/ratio lines (times and uuids stripped):
- Without the centring, narrow-390 fails on exactly `Credential` / `Dependents` `[sortable-th__btn]` hover, in both themes. This reproduces the root cause.
- The ONLY verdict differences in all 1346 ratio lines across the 5 files are those 4 lines, all `fail -> advisory`. Every other element in every cell has the same verdict and ratio (4 dp).
- So the change hides no failure anywhere else.
- It also cannot change the resting read: `readBackdrop` and `readSnapshot(base)` run before the scroll, and the pre-existing forced hover already scrolled.
- Evidence: `/home/matt/Development/helio/.concertino/runs/HEL-1805/evidence/.concertino/scratch/HEL-1805/ab-probe-centre.txt`. The throwaway worktree was removed afterwards.

Mutations: the executor reverted each of the three rules one at a time in routes-light only (1440): each went red for exactly its control, both themes. I judge this sufficient. The same selectors apply at every width. At 1100/768/390 the committed red run (seed only) followed by green after the fix is in effect the same mutation for the row and trigger, and for Test connection at 1100.

The sticky actions-cell override (`ConnectorsPage.css:179-183`) is not reachable by the guard, because `td` is not a candidate. I checked it visually instead (Phase 3).

Other checklist items: the CSS uses tokens only and sits inside `@media (hover: hover)`, the DRY / type-safety / security checks raise nothing, there is no dead code, and nothing is over-engineered. There are no backend changes, so `sbt testFull` was not required.

### Phase 3: UI Review — PASS

Servers were started with `start-servers.sh` (lane DB) and stopped with `stop-servers.sh` (`STOPPED ports=7237,10144`).

I registered a throwaway user with one no-auth connector and one bearer connector, both with `.invalid` URLs. The user was deleted afterwards by exact id with `buildUserDeleteSql` (0 rows left, connectors cascaded).

**Task 3.4 visual check**, done here because the executor did not do it. Real mouse hover, both themes:
- **1440, Test connection hovered inside the hovered row.**
  - Dark: the row and button are both rgb(35,32,25). The button is still distinguishable by its border (0.09 → 0.18 alpha) and full-contrast text.
  - Light: both are white, and the button is outlined by `--app-border-strong`.
- **1440, actions trigger hovered.** It is distinguishable by its stronger border, and the unhovered Test connection drops back to muted text.
- **390, actions trigger hovered.** Light and dark: the hovered row and the sticky actions cell read as one band (the override moves with the row), and the trigger stays outlined.
- Distinguishable in every case. Whether border-only distinction is enough design-wise is the skeptic's call.
- Screenshots (persisted), all under `/home/matt/Development/helio/.concertino/runs/HEL-1805/evidence/.concertino/scratch/HEL-1805/`:
  - `eval-dark-1440-testconn-hover.png`
  - `eval-light-1440-testconn-hover.png`
  - `eval-dark-1440-trigger-hover.png`
  - `eval-light-390-trigger-hover.png`
  - `eval-dark-390-trigger-hover.png`

**Edit modal "Replace credential"** (bearer connector), probed while hovered:
- Dark: bg rgb(22,21,20) on modal rgb(38,35,32).
- Light: bg rgb(239,236,230) on modal rgb(255,255,255).
- Both are unchanged `--app-surface-soft` and visible. This matches the executor's evidence.

No console errors during these flows. The triggers have accessible names (`<name> actions`) and are buttons.

### Overall: FAIL

### Change Requests

1. **`e2e/support/state-surface-contrast-guard.ts:697-728` (`assertConnectorControlsCovered`) and its 1440 call at `:963-965`: make the check prove measurement, not visibility.**
   - The fix: check the ids against the candidates that were actually probed. For example, return the sampled candidates' doc ids from `probeView` alongside `docIds`, or call `collectCandidates(page, main, MAX_ELEMENTS_PER_VIEW)` in the helper and assert `candidates.some(c => c.docId === id)`.
   - Then pass that sampled set, not `mainDocIds` / `covered`.
   - Show the check can fail: temporarily lower the cap so a connector control is sampled out, or drop one id from the sampled set, and record the red line in evidence. Then restore.
   - Keep the narrow path consistent: it can use the same sampled-set source, or rely on `fullySampled` with a comment saying that is what makes it sound.
   - Make the failure message match what is asserted.
2. **`openspec/changes/connector-hover-contrast-seed/tasks.md` task 3.4:** record that the evaluator did it in evaluation-1.md (screenshots under the evidence ref above), instead of a bare `[x]` with no evidence. Do not claim it as executor work.

### Non-blocking Suggestions

- `state-surface-contrast-guard.ts:385-405`: the new HEL-1805 comment and the `scrollIntoView` call sit between the cycle-4 "hover the immediate parent first" comment and the code it describes. Move the HEL-1805 block above the cycle-4 comment so each comment sits directly over its own code.
- ci-impact.md is a single run per file. A one-line note that the noise band (about ±3 s) comes from those single runs, not from repeated measurement, would be more honest.
