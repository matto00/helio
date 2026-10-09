## Evaluation Report — Cycle 2 (evaluation-2.md)

Reviewed HEAD `63706d76574f6cc45f7cb641a0c935579f4d104b` against live-resolved base `03588796bbef47de0b48bedd201ae3e49739a191`. The cycle-2 delta (`4b839f9ae..63706d765`) touches only:
- `AdminUsagePage.css`
- `design.md`
- `specs/product-telemetry/spec.md`
- `files-modified.md`
- the committed `evaluation-1.md`

The backend tree is byte-identical to cycle 1 (`git rev-parse <rev>:backend` = `53748f4c…` at both commits).

### Gates (fresh run, WORKTREE_PATH)

| Gate | Result |
| --- | --- |
| `npm run lint` | exit 0 |
| `npm run format:check` | exit 0 |
| `npm run typecheck` | exit 0 |
| `npm test` (`--maxWorkers=3`) | exit 0. 498 suites, 5205 tests passed |
| `npm --prefix frontend run build` | exit 0 |
| `cd backend && sbt testFull` (`nice -n 19`) | exit 0. 6456 succeeded, 0 failed, 4 canceled. All four HEL-1420 specs ran |

### Phase 1: Spec Review — PASS

CR 3 is resolved:
- **`design.md` Decision 5** now states the shipped rule. A computable roll overwrites the value. A non-computable roll inserts NULL but on conflict keeps the earlier value (`COALESCE`), the same as WAU. The rationale is recorded.
- **The product-telemetry spec delta** now has a SHALL that matches the code. The "Not computable" scenario is scoped to a first roll. A new scenario, "Re-roll after the window left retention keeps the earlier value", is backed by `ProductEventMonthlyActiveSpec.scala:368-376`.

The cycle-1 Phase 1 findings still hold:
- every acceptance criterion is met
- C1, C2 and C3 are honoured
- owner rulings Q1-A, Q2-A and Q3-A are reflected

### Phase 2: Code Review — PASS

- **CR 1 (cascade) is resolved.** The selector is now `.admin-usage__stats.admin-usage__stats--totals` (`AdminUsagePage.css:38`), which outranks the base `.admin-usage__stats` 4-column rule at every width. The redundant 1100px re-declaration is removed.
- **CR 2 (breakpoint) is resolved.** The 600px block is folded into the existing canonical `@media (max-width: 430px)` block (`:150`). Grep shows the file's only media queries are 1100, 768 and 430, all canonical under DESIGN.md §4.

### Phase 3: UI Review — PASS

Setup:
- Servers came from `start-servers.sh`, which reused this worktree's servers, and `assert-phase.sh servers` returned PASS.
- I registered throwaway owner `b079822c-a0de-46f1-b91e-03209258982a` (`hel1420-eval2-1791581080@eval.local`) and promoted it by exact-id update.
- After review I deleted it by exact id (`DELETE 1`, re-count 0).

I measured the computed `grid-template-columns` of the totals grid in the running app:

| Viewport | Totals grid | Window-stats grid |
| --- | --- | --- |
| 1440, dark | 3 tracks (373.3px each) | 4 tracks (276px) |
| 1440, light | 3 tracks (373.3px each) | — |
| 1100 | 3 tracks (260px) | 2 tracks |
| 768 | 3 tracks (229px) | — |
| 500 | 3 tracks (140px), no card content overflow | — |
| 430 | 1 track (382px) | — |
| 375 | 1 track (327px) | — |

- No horizontal overflow at any width.
- No console errors on :6852 after login.
- Evidence:
  - `/home/matt/Development/helio/.concertino/runs/HEL-1420/evidence/.concertino-evidence-tmp/eval2-dark-1440.png`
  - `/home/matt/Development/helio/.concertino/runs/HEL-1420/evidence/.concertino-evidence-tmp/eval2-light-1440.png`

  Both show the totals row filling the full content width.
- The cycle-1 API, accessibility and keyboard checks are unaffected: there were no TSX or backend changes in this cycle.

### Overall: PASS

### Non-blocking Suggestions
These are carried over from cycle 1 and are unchanged:
- **`HELIO_OWNER_EMAILS` precedence trap.** `backend/build.sbt:140` adds `.env` to the forked `run` envVars, so a value in `backend/.env` overrides one exported in the shell. This was already the case before this change; consider a follow-up or a MISTAKES.md entry.
- **For the skeptic:** "WAU (latest)" in the window stats row duplicates the new "Active, last 7 days" headline. Whether that is acceptable is a judgment call.
