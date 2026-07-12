## Skeptic Report — final gate (round 1)

### What I verified (with evidence)

- **Ticket ACs traced to code:**
  1. "Type Registry list visually differentiates unstructured DataTypes" →
     `frontend/src/shared/chrome/SidebarBody.tsx` registry branch computes
     `unstructuredTypeIds` via `isUnstructuredDataType` over the full
     `pipelineOutputDataTypes: DataType[]` and passes `renderBadge` to
     `SidebarItemList`. Confirmed live: navigated to `/registry` (screenshot,
     light + dark), badge ("Content" pill) renders next to "Evaluator Curl
     Upload", "probe-good", "ssrf-test-valid-md2", "HEL-215 Test Notes" and is
     absent from `EvalChunkType` (whose `content` field is plain `string`, not
     `string-body`) and other structured types.
  2. "Indicator reuses an existing badge/chip primitive" → CSS diff
     (`DashboardList.css`) matches `.pipeline-status`'s pill recipe exactly
     (`padding: 2px 7px`, `border-radius`, `--text-xs`, `--weight-medium`);
     improves on it by using `--app-radius-pill` token instead of the
     precedent's literal `999px`, matching design.md Decision 3's explicit
     instruction. No new `Badge` component introduced.
  3. "Backend/wire-shape change minimal and additive" → `git diff main...HEAD
     --stat` confirms zero backend files touched (16 files changed, all
     frontend + openspec artifacts).

- **Design.md Decision 1 "Type-flow note" implemented as specified:**
  read the actual diff of `SidebarBody.tsx` — the `Set<string>` of
  unstructured ids is built over the full `DataType[]` list *before*
  `renderBadge` is constructed, and `renderBadge` looks the row up by
  `item.id`. No type assertion/cast on `item` anywhere in the diff (grepped
  the full diff for `as DataType` / similar — none found). Matches design.md
  verbatim.

- **Design.md Decision 5 "Layout note" implemented:** `SidebarItemList.tsx`
  diff wraps `dashboard-list__name` + badge in a new
  `.dashboard-list__name-group` flex span in both the button and NavLink row
  variants, leaving `dashboard-list__active-dot` as the second top-level flex
  child — exactly the fix design.md called for.

- **Gates re-run myself (not trusted from evaluator's report):**
  - `npm run lint` → clean (zero warnings).
  - `npm run format:check` → "All matched files use Prettier code style!"
  - `npx jest --testPathPatterns="dataType.test|SidebarBody.test"` → 2 suites,
    8 tests pass.
  - `npx jest --testPathPatterns="SidebarItemList.test"` (pre-existing,
    unmodified — regression check for the shared component) → 1 suite, 3
    tests pass.
  - Full suite: `npm test` → 76 suites / 839 tests pass — matches the
    evaluator's reported count exactly.
  - `npm run build` → succeeds cleanly (only a pre-existing chunk-size
    advisory warning, unrelated to this diff).

- **DESIGN.md token fidelity (independently re-verified, not just trusting
  the evaluator's claim):** grepped `frontend/src/theme/theme.css` directly —
  `--app-radius-pill` (:67), `--text-xs` (:26), `--weight-medium` (:36),
  `--app-info` (:113 light / :157 dark, aliases `--app-accent`),
  `--app-accent-surface` (:103 light / :148 dark), `--space-2` (:48) are all
  real tokens, all correctly applied in the diff. No hardcoded hex/rgb.

- **Live visual check, light + dark:** started servers via
  `scripts/concertino/start-servers.sh` (reused already-healthy instances on
  5391/8298), `assert-phase.sh servers` → `PASS servers`. Navigated to
  `/registry` in both themes (screenshots taken and viewed): badge renders
  with correct accent-derived contrast in both. Verified `/sources` renders
  with zero `.dashboard-list__badge` elements (regression holds) and
  confirmed the pre-existing sidebar horizontal-overflow the evaluator
  flagged is real and predates this diff — reproduced it independently on
  `/sources` where a long source name ("Skeptic Multipage PDF Renam...")
  clips with no ellipsis and **no badge at all is present**, proving the
  clipping is a pre-existing container-width issue, not something this diff
  introduces or worsens.

- **Accessibility:** confirmed via accessibility snapshot that the badge text
  folds into the interactive row's accessible name (e.g. button name
  "Evaluator Curl Upload Content") even where the badge is visually clipped
  in the default scroll position — the full text is available to assistive
  tech regardless of the visual clipping. Meaning is carried by the "Content"
  text label, not by color alone (DESIGN.md §8 "color is never the sole
  carrier of meaning" — satisfied).

- **Unit/RTL test quality:** read `dataType.test.ts` and `SidebarBody.test.tsx`
  in full — they exercise the actual fixed/added logic (string-body present,
  binary-ref present, all-structured, computed-field-only-ignored; live
  DOM presence/absence of `.dashboard-list__badge` in the registry vs.
  sources/pipelines sections). These are meaningful regression tests, not
  vacuous assertions.

- **Commit message convention:** `HEL-218 Add unstructured DataType badge to
  Type Registry sidebar list` — follows `HEL-N Description` convention.

### Verdict: CONFIRM

### Non-blocking notes
- Agree with the evaluator's non-blocking note: the pre-existing sidebar
  horizontal-overflow (reproduced independently on `/sources`, unrelated to
  this diff) causes the new badge to clip without an ellipsis fallback for
  long item names in the default (unscrolled) view. Worth a small follow-up
  ticket to add truncation/ellipsis to `.dashboard-list__badge` or fix the
  container overflow, but out of this ticket's scope and not a regression
  introduced here.
