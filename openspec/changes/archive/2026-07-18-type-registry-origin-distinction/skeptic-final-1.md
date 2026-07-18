## Skeptic Report — final gate (round 1)

### Scope note
Per human-directed escalation resolution (binding, restated in orchestrator instructions): the
filed ticket's AC1 (source-vs-pipeline distinction) and AC2 (delete affordance) are obsolete,
resolved structurally by ad939146 + HEL-256 Fix B'. This review judges the implementation against
`openspec/changes/type-registry-origin-distinction/specs/type-registry-provenance/spec.md` and
DESIGN.md/CONTRIBUTING.md, not the filed ticket ACs — consistent with proposal.md's documented
scope.

### What I verified (with evidence)

1. **Diff scope** — `git diff --name-only main...HEAD` (frontend-only, plus openspec change
   artifacts): `App.tsx`, `DashboardList.css`, `pipelinesSlice.ts`/`.test.ts`, `MobileNavSheet.tsx`/
   `.css`/`.test.tsx`, `SidebarBody.tsx`/`.test.tsx`, `SidebarItemList.tsx`/`.test.tsx`. No backend/
   schema files touched. `git diff --stat -- ':!openspec'` confirms exactly 7 source/CSS + 4 test
   files, 356 insertions / 27 deletions — matches files-modified.md and tasks.md exactly.

2. **Read the full diff** for all 7 non-test files. Confirmed:
   - `selectPipelineNameByOutputTypeId` in `pipelinesSlice.ts`: memoized via `createSelector` on
     `state.pipelines.items`, builds `Map<string,string>` skipping pipelines with
     absent/null `outputDataTypeId` — matches design.md Decision 1 exactly.
   - `SidebarBody.tsx`: status-gated fetch extended to `(section === "sources" || section ===
     "registry") && pipelines.status === "idle"` — matches Decision 2.
   - `App.tsx`: separate status-gated `useEffect` for the mobile shell (`mobileSection ===
     "registry" && pipelines.status === "idle"`) — matches Decision 2's mobile branch.
   - `SidebarItem`/`MobileNavSheetItem` both gain optional `subtitle?: string`; rendering is
     additive-only (conditional render, no change to the no-subtitle path) — matches Decision 3/4.
   - `renderItemText` helper in `SidebarItemList.tsx` is shared between button/NavLink variants —
     avoids the divergence risk design.md's own risk list calls out.
   - Filter predicate untouched — only matches `item.name` (grep confirms no subtitle reference
     added to the filter logic) — matches Decision 6.

3. **Gates re-run fresh (not trusting evaluation-1.md's assertions):**
   - `npm run lint` → 0 warnings.
   - `npm run format:check` → clean.
   - `npx jest --testPathPatterns="pipelinesSlice|SidebarBody|SidebarItemList|MobileNavSheet"` →
     5 suites / 70 tests passed.
   - `npm test` (full suite) → 106 suites / 1136 tests passed.
   - `npm run build` → succeeds (vite build, PWA precache generated).
   - `npm run check:schemas` → in sync (expected — no schema changes).
   - `npm run check:scala-quality` → clean, 43 pre-existing informational soft-budget warnings,
     none in files touched by this diff (all are backend test files, this diff is frontend-only).

4. **Spec scenarios — live-verified against the worktree's own servers** (started via
   `scripts/concertino/start-servers.sh`, `assert-phase.sh servers` → PASS; logged in as
   matt@helio.dev, session persisted from a prior run):
   - Desktop `/registry` at 1440px: entries matched to a loaded pipeline's `outputDataTypeId` show
     `Pipeline: <name>` subtitle (e.g. "HEL254WideType" → "Pipeline: HEL-254 Wide Table Pipelir…",
     ellipsis-truncated); unmatched entries (EvalChunkType, Evaluator Curl Upload, probe-good,
     ssrf-test-valid-md2, TextNotesType, etc.) render name(+badge)-only, no subtitle element.
     Screenshot: `skeptic-01-registry.png`.
   - Dark theme same page: subtitle color/contrast reads correctly against the dark surface.
     Screenshot: `skeptic-02-registry-dark.png`.
   - Sources section (`/sources`): rows render single-line, no subtitle markup — regression
     confirmed live, not just via test. Screenshot: `skeptic-03-sources.png`.
   - Pipelines section (`/pipelines`): sidebar rows also unaffected (name-only).
     Screenshot: `skeptic-07-pipelines.png`.
   - Phone shell at 390×844, `/registry`: header shows the same subtitle under the active type
     name. Screenshot: `skeptic-04-phone-registry.png`.
   - Phone section sheet (opened via the "Switch type registry" control): sheet items show the
     same `Pipeline: <name>` subtitles as desktop, confirming desktop/phone parity. Screenshot:
     `skeptic-05-phone-sheet.png`.
   - Tap-target measurement via `getBoundingClientRect()` on 12 sheet rows (mix of with/without
     subtitle): every row measured exactly `44px` tall — the ≥44px requirement holds regardless of
     subtitle presence (grows via `min-height`, doesn't shrink, per design.md's risk note).
   - Filter-ignores-subtitle scenario: typed "Wide Table Pipeline" (present only in the subtitle
     of "HEL254WideType", not in its name) into the desktop registry filter → "No matches" state
     rendered live. Screenshot: `skeptic-06-filter-nomatch.png`.
   - No-refetch-when-loaded scenario: navigated to `/sources` (triggers a pipelines fetch), then
     performed an in-app (non-reload) navigation to `/registry` via the sidebar link, and confirmed
     via `browser_network_requests` that no additional `GET /api/pipelines` fired — request count
     stayed at 2 (one earlier, none new) across the SPA transition.
   - Console: 0 errors on every page/viewport/theme checked. 4 pre-existing warnings from
     `selectPipelineOutputDataTypes` (in `dataTypesSlice.ts`) are present but that file is untouched
     by this diff (confirmed absent from `git diff --name-only`) — not a regression.

5. **DESIGN.md token compliance** — read the touched CSS directly:
   `.dashboard-list__subtitle` / `.mobile-nav-sheet__item-subtitle` use `var(--text-xs)` (verified
   `--text-xs: 0.75rem` = 12px in `theme.css`, matching the spec's "12px scale token" requirement)
   and `var(--app-text-muted)` (defined in both light and dark theme blocks in `theme.css`); layout
   uses `var(--space-1)` and `var(--control-md)`. No literal px font-sizes or hex/rgb colors
   introduced. `SidebarItemList` (a canonical chrome primitive) is extended, not duplicated.

6. **Tests read directly** (not just counted): `pipelinesSlice.test.ts` selector tests cover
   present/absent-`outputDataTypeId`/empty-pipelines cases; `SidebarItemList.test.tsx` and
   `MobileNavSheet.test.tsx` cover subtitle-present/absent and the filter-ignores-subtitle case;
   `SidebarBody.test.tsx` integration tests cover cold-fetch-once (`waitFor` on the mocked
   `getPipelines`) and no-refetch-when-`succeeded`. These exercise the actual spec scenarios, not
   just incidental coverage.

7. **tasks.md** — all 22 items checked off; each maps 1:1 to a diff hunk I read myself (no
   task claims work I couldn't find in the diff).

8. **design.md Decisions 1–6** — every decision traced to the corresponding code in the diff
   (cited above); no contradiction between planning artifacts and implementation.

### Verdict: CONFIRM

### Non-blocking notes
- Same observation as evaluation-1.md: `App.tsx` is now 498 lines (pre-existing >400-line file,
  this diff added 32 lines to it). Informational only per CONTRIBUTING.md's soft-budget policy;
  worth a future decomposition pass (e.g. extracting `mobileSheetItems` construction into a hook)
  but not a reason to block this ticket.
- The four pre-existing `selectPipelineOutputDataTypes` console warnings are unrelated to this
  diff and out of scope here; a good candidate for a small separate cleanup ticket.
- No demo-data row currently combines a badge (e.g. "Content") with a provenance subtitle, so the
  badge+subtitle stacked layout wasn't visually exercised live. Read the CSS/JSX and it composes
  structurally (badge stays inline in the name-group row; subtitle stacks below the whole group),
  so I'm not flagging this as a defect — just noting the live check didn't hit that combination.
