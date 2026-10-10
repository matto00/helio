## Evaluation Report — Cycle 2 (evaluation-2.md)

Reviewed HEAD: `302dac54ff077495fa8891544bf96e767d4a2afb`. Review base, resolved live: `2ce4a46706d0642fbfb82c2257b13403d920f19a`.
The cycle-2 delta is `08614ac70..302dac54f`:
- `TableDisplayFields.css`: the gate changes from `(max-width: 768px), (pointer: coarse)` to `(max-width: 768px)`, and the header comment loses its hard-coded pixel figures.
- `Select.test.tsx`: the redundant comment is removed.
- design.md D6 is rewritten.
- files-modified.md is updated.
- evaluation-1.md is committed.

Evidence is in `/home/matt/Development/helio/.concertino/runs/HEL-1432/evidence/`. My files for this cycle are prefixed `eval-c2-`.

### Phase 1: Spec Review — PASS

- Cycle-1 Change Request 1 is resolved. All layout rules (density collapse, `min-width: 0`, the `minmax(0, 1fr)` list track, wrap and row-gap, `flex: 1 1 100%`, and the move-group `margin-left`/`align-items`/`min-height: 44px`) now sit under `@media (max-width: 768px)`. That is at `TableDisplayFields.css:167`.
- The tap-target rule (the reset-button expander, `:129`) stays on the touch gate, which is what DESIGN.md §3/§4 call for.
- design.md D6 now matches what ships.
- AC1–AC6 are all met. The cycle-1 findings for AC1–AC4 still apply: the only non-test source change since then is the CSS media query, and the label tests are unchanged apart from a comment. So my cycle-1 red-on-whole-pre-fix-tree run, where 21/21 per-id cases failed, still applies. For AC5, see Phase 3.
- Non-retired CONSTRAINTS C1–C5 are all honored:
  - **C3:** the HEL-469 and HEL-813 invariants hold, and the fix now complies with DESIGN.md.
  - **C4:** evidence is in the evidence directory.
  - **C5:** I used a throwaway user. Its fixtures were *not* deleted, because of an evaluator-side mistake. The ids are listed under Phase 3.

### Phase 2: Code Review — PASS

I ran the gates fresh in WORKTREE_PATH:

| Gate | Result |
| --- | --- |
| `npm run lint` | exit 0 |
| `npm run format:check` | exit 0 |
| `npm run typecheck` | exit 0 |
| `npm --prefix frontend run build` | exit 0 |
| `npm test` (root) | 44 suites / 426 tests passed |
| `npm test` (frontend) | 501 suites / 5238 tests passed |

- No backend files changed.
- DESIGN.md [mechanical]: layout is now width-gated, the tap-target rule is touch-gated, the token gap is `--space-4`, and `min-height: 44px` sits on the move-group container rather than on a button.
- The rewritten header comment explains the cause and the mechanism without stale numbers.
- No new issues.

### Phase 3: UI Review — PASS

**Servers.** I checked the reused servers rather than trusting them:
- `/proc/<pid>/cwd` for :6864 is `.../HEL-1432/frontend`, and for :9771 it is `.../HEL-1432/backend`.
- The served `TableDisplayFields.css` contains the `@media (max-width: 768px)` block.

**How I measured.** I used my own Playwright script (`eval-c2-measure.cjs.txt`). Each case ran in a fresh browser context, in both themes. Touch cases used `hasTouch: true`, and I recorded `matchMedia('(pointer: coarse)')` for each one. The fixtures were:
- **long:** 10 columns, including the 49-character `customer_lifetime_value_adjusted_for_seasonality1`.
- **short:** 3 columns.

Full numbers are in `eval-c2-measurements.json`. Screenshots are `eval-c2-<fixture>-<theme>-<width>-<mouse|touch>.png`.

| case (light and dark) | coarse | layout query | overflow | shape |
| --- | --- | --- | --- | --- |
| long/short 375 mouse | false | true | 0 / 0 | density 1 col; long rows 131px (name / format / move), short rows 79px; gap 16px; 44x44 expanders, none overlapping the format select or each other; name ≥ 20.8px |
| long/short 375 touch | true | true | 0 / 0 | identical to mouse |
| long/short 768 mouse | false | true | 0 / 0 | density 1 col (644px); rows 79px; no expander overlap |
| long/short 1100, 1440 mouse | false | false | long 56–69.8, short 0 | desktop layout: density 2 col, rows 40px, move group inline |
| long/short 1100, 1366 touch | true | false | long 56–69.8, short 0 | **desktop layout kept**: density 2 col, single-line rows (52px because touch-gated controls are taller), expanders active with no overlap |

What these numbers establish:

- **The executor's claims are confirmed.** Overflow is 0px at 375 and 768 in both themes. A coarse-pointer device at 1100 or 1366 keeps the desktop layout, which closes cycle-1 CR1.
- **1100/1440 with a mouse is unchanged.** The layout query does not match there, so the HEL-1432 rules cannot apply.
- **The executor's before/after 1100/1440 JSON agrees.** It is identical except for a new `coarseMatch` field.
- **The long-name desktop overflow is pre-existing and out of scope**, as in cycle 1. Its size varies between 56 and 69.8px from run to run, most likely depending on whether the web font has loaded. It is not in this diff, and the short fixture shows 0px.

Console errors: only 404s. These match the cycle-1 findings (schedule GET with no schedule, and root preview in create mode). Both predate this change.

**Fixture cleanup failed (evaluator-side, not a code issue).** The throwaway user is `17fb8a3a-fffd-43b9-9617-41943dc7062e` (`hel1432-eval-c2-…@example.com`). These are its ids:
- pipelines `9d122649-a778-434b-ab62-6d82d2aa1df9` and `3b68f753-3bb0-4368-a4d6-3cdaa92b6f61`
- data sources `b10eb44b-7193-449d-aa5d-2dd6d03ec3c2` and `28d8f9b4-3820-4fe2-abc1-08f5d23a5421`
- outputs `6d9289c6-76f7-42b4-82ad-b2af04fd7f95` and `e6c284c9-da44-40c4-b40a-92292a604ceb`

Every exact-id DELETE returned 401. The curl jar's session for this user had stopped being valid after the 14 browser-context logins. I had already deleted my scratch copy of the throwaway password before confirming the deletes, so I could not log in again.

All 6 rows still exist, recorded in `eval-c2-created-ids.json`. They need deleting by exact id. This does not affect the verdict.

### Overall: PASS

### Non-blocking Suggestions

- Carried over from cycle 1: file a follow-up for the pre-existing desktop long-name overflow (1100/1440/1366, mouse or touch). The `.table-display-fields__column-list` auto track floors at the nowrap name's min-content, pushing it about 23–70px past the Configuration card. The 7 off-surface dangling `htmlFor` targets need a follow-up too.
- Side observation, outside this ticket: repeated logins for one user from separate browser contexts invalidated an earlier session cookie, and a fresh login briefly redirected to `/login`. I did not investigate further. It may just be rate limiting, but it is worth a look if gate scripts log in repeatedly.
