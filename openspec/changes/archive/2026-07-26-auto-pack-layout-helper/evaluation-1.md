## Evaluation Report — Cycle 1

### Phase 1: Spec Review — PASS
Issues: none.

- All 6 ticket acceptance criteria addressed explicitly and fully (not partial):
  wrap/no-overlap, shelf-fill widening w/ sparse-shelf no-op, per-kind clamping,
  omitted-panel retention + 400 on unknown panelId, ScalaTest coverage (wrap,
  shelf-fill, clamp, single-panel, empty — plus a property test beyond the
  ticket's minimum), MCP `auto_layout_dashboard` tool.
- No AC silently reinterpreted. The one open judgment call — scaling the
  fill-shelf threshold as `round(cols*7/12)` instead of the fixed `7` helio-news
  uses — is a necessary consequence of `cols` being configurable (ticket's own
  scope: "+ optional `cols`, default 12"), reduces to exactly `7` at the default
  `cols=12` (byte-identical to the reference algorithm's untouched behavior),
  is documented in-code with explicit reasoning, and is exercised by the
  shelf-fill unit tests at `cols=12`. Not scope creep, not a hidden
  reinterpretation of an AC — judged reasonable.
- All 13 tasks.md items checked and each matches what's actually implemented
  (verified file-by-file against the diff, not just tasks.md's own claim).
- No scope creep: diff touches exactly the files ticket/proposal/design scoped;
  no HEL-368/369/624 absorbed (confirmed no references to those ticket numbers
  or their concerns anywhere in the diff).
- No regressions: full backend suite (`sbt test`, 2154 tests across 127 suites)
  passes clean on this branch.
- API contracts: `schemas/auto-layout-item.schema.json` +
  `auto-layout-request.schema.json` added; `check:schemas` confirms JsonProtocols
  parity (29 checked across 26 protocol files, no drift).
- Planning artifacts (design.md D1–D6) match the final implementation exactly —
  verified D1 (all four breakpoints identical), D3 (input-order determinism,
  tested), D4 (clamp table ported verbatim using `PanelKind.*` constants, not
  magic strings), D6 (see Phase 2 note below) all line up with the code.

**D6 mixed-request behavior verified as specified, not a bug.** Kept (omitted)
panels are appended alongside newly packed panels with no collision avoidance
against them — this is exactly what design.md D6 and the ticket's AC text
("Panels omitted from the input keep their current position (or are documented
as unmanaged)") call for. It is: (a) explicitly documented in
`AutoLayoutService`'s Scaladoc and design.md's Risks section, (b) covered by a
passing test (`AutoLayoutRouteSpec`: "keeps an omitted panel's saved position
unchanged and appends the newly packed panel"), and (c) the skeptic's prior
design-gate review (`skeptic-design-1.md`) already CONFIRMed this exact
trade-off before implementation. No change requested.

### Phase 2: Code Review — PASS
Issues: none.

- **Canonical code-quality compliance**: `npm run check:scala-quality` (which
  mechanically enforces the no-inline-FQN rule from CONTRIBUTING.md "Imports &
  Qualifiers") passes clean on this branch — 0 violations in the new files. The
  70 file-size soft-budget warnings it prints are all pre-existing files
  untouched by this diff; none of the 5 new backend files
  (`PanelPacker.scala` 124 lines, `AutoLayoutService.scala` 120 lines,
  `AutoLayoutRoutes.scala` 39 lines, `PanelPackerSpec.scala` 146 lines,
  `AutoLayoutRouteSpec.scala` 141 lines) are flagged — well within the ~250-line
  budget.
- Design-standard: N/A — no frontend files touched (see Phase 3).
- DRY: `AutoLayoutService.authorizeEditor` mirrors
  `DashboardContentsService.authorizeEditor` line-for-line in structure
  (sharing-aware `findById` → owner short-circuit → `accessChecker.requireAccess`
  → Viewer=403/Editor+=proceed); clamp table keys off `PanelKind.Metric`/etc.
  constants (`Panel.scala:146-155`), not duplicated magic strings; persistence
  reuses `dashboardRepo.update` (same path `DashboardService.applyUpdate` uses).
- Readable: clear naming throughout (`fillShelf`, `clamp`, `PackInput`,
  `ClampBounds`); the one non-obvious value (fill-threshold scaling) is
  explained in a doc comment, not a bare magic number.
- Modular: `PanelPacker` is a genuinely pure module (verified zero
  HTTP/DB/domain-repository imports — only `com.helio.domain.{DashboardLayoutItem,
  PanelId, PanelKind}`), independently unit-testable, exactly as design.md's
  Goals required.
- Type safety: value-class IDs (`PanelId`, `DashboardId`) used throughout the
  Scala side; MCP tool has a fully-typed zod `inputSchema`
  (`panelId: z.string().min(1)`, `w`/`h`: `z.number().int().positive()`).
- Security: panel `kind` is looked up server-side from the dashboard's actual
  panels via a sharing-aware repository call — never trusted from the request
  body (design.md D4, matches `DashboardContentsService.validatePanels`'s
  established pattern). ACL is enforced before any panel/layout read.
- Error handling: `cols < 1` rejected with 400 before any DB work; unknown
  `panelId` rejected 400 with no persistence (verified by test); Forbidden/NotFound
  mapped correctly per the codebase's existence-not-leaked convention
  (`findById` → `None` → 404, Viewer-grant → 403).
- Tests meaningful: `PanelPackerSpec` includes a genuine property test (200
  random seeds, 1–15 panels each, `w`/`h` deliberately ranged into negative/zero
  territory to exercise clamping, asserting zero pairwise overlaps and full
  size retention on every seed) — this satisfies design.md D5's requirement
  that overlap-freedom be tested as a property, not just examples.
  `AutoLayoutRouteSpec` covers the full owner/editor/viewer/no-access/
  unauthenticated ACL matrix, 400-with-no-persistence, omitted-panel retention,
  all-four-breakpoints-identical, and the empty-items edge case — all passing.
- No dead code: none found.
- No over-engineering: no premature abstraction; `PanelPacker` exposed as a
  plain object with two public functions, matching its actual call surface (one
  caller today, per design.md D2's explicit non-goal of merging endpoints).
- N/A for behavior-preservation (net-new feature, not a refactor).

**ACL pattern verified consistent with `DashboardContentsService`**: both
services follow the identical owner-short-circuit → `accessChecker.requireAccess`
→ Viewer=Forbidden/Editor-or-owner=proceed shape; `findById` (not
`findByIdOwned`) is correctly used since auto-layout must honor sharing grants,
same as replace-contents.

### Phase 3: UI Review — N/A
No frontend files are touched by this diff (`grep -rn "auto-layout|autoLayout"
frontend/src` returns zero matches) and the feature has no UI surface — it is
consumed only via direct API call or the new MCP tool. `ApiRoutes.scala` and
`schemas/**` were modified (nominal Phase-3 triggers), but only to wire a new
backend-only endpoint; there is no dashboard-builder UI flow that calls or
displays this endpoint's output. Backend route-level tests (`AutoLayoutRouteSpec`,
8 scenarios, all passing) are the equivalent objective/observable verification
for this endpoint's happy/unhappy paths given the absence of a UI consumer.

### Verification gates re-run (fresh evidence)
- `sbt test` (full backend suite): **2154/2154 passed**, 127 suites, 0 failures.
- `sbt "testOnly com.helio.services.layout.PanelPackerSpec com.helio.api.AutoLayoutRouteSpec"`:
  **20/20 passed** in isolation.
- `npm run lint` (root, zero-warnings ESLint): clean.
- `npm run format:check`: clean.
- `npm run check:schemas`: schemas in sync with `JsonProtocols` (29 checked).
- `npm run check:openspec`: only flags the expected "complete but not archived"
  hygiene note (archiving happens later in the workflow, not at this cycle).
- `npm run check:scala-quality`: clean (0 violations; 70 pre-existing file-size
  soft-warnings unrelated to this diff).
- `helio-mcp`: `npm ci` (worktree's `helio-mcp/node_modules` was not installed —
  see note below) then `npm run typecheck` and `npm run build`: both clean.

**Process note (no code issue, environment-only, self-corrected mid-review)**:
this worktree's `helio-mcp/node_modules` was not installed at review start,
which without workspace-level dependency isolation caused `npm run typecheck`
to fall back to `typescript`/`zod` hoisted from the parent repo checkout's
`node_modules` (via Node's ancestor-directory module resolution, since this
worktree is nested under the main repo path), producing ~60 spurious
implicit-`any` errors unrelated to the new code. Installing the worktree's own
`helio-mcp` and root dependencies (`npm ci` in both) resolved this and both
typecheck and build passed clean. Separately, an errant `git stash`/`git stash
pop` I ran while investigating this (attempting to compare against a clean
baseline) surfaced that `git stash` is shared across worktrees sharing this
repo's `.git` dir — it began popping an unrelated stash entry from a different
in-flight branch (`feature/echarts-base-chart-panel/HEL-65`), hit a conflict,
and left the worktree in a conflicted state. No data was lost (the foreign
stash was never dropped, confirmed still present in `git stash list` after);
I resolved it with `git reset --hard HEAD` (safe here because the worktree's
working tree exactly matched `HEAD` before my first `git stash` call — confirmed
by that call's own "No local changes to save" output). Final state: worktree
clean, matches `HEAD`, both pre-existing foreign stash entries intact and
untouched. Flagging this for awareness only — no code changes were needed as a
result, and this does not affect the Overall verdict.

### Overall: PASS

### Change Requests
None.

### Non-blocking Suggestions
- MCP tool's `items` zod schema uses `.min(1)` (`helio-mcp/src/tools/write.ts`),
  while the backend endpoint explicitly supports and tests an empty-items
  request (`AutoLayoutRouteSpec`: "returns an empty result unchanged for empty
  items"). Not a defect — an agent would never call this tool with zero items —
  but worth a one-line note in the tool description if a future ticket wants
  the MCP surface to fully mirror the backend's accepted range.
