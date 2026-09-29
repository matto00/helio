## Evaluation Report — Cycle 2 (evaluation-2.md)

Reviewed commit `371d0a417e096389aea1955c85656e8d3736bec4` on
`feature/output-panel-control-config/HEL-1189`, diffed against LIVE-resolved
base `a6e603a1229cb1c7d1737c08d2ac88ff5355a92f` (`resolve-review-base.sh`),
and specifically against evaluation-1.md's reviewed commit
`fba7c629948cf06404d2cdafa10a93169e46ccc6` for the cycle's own diff.

### Phase 1: Spec Review — PASS

Both evaluation-1.md change requests independently re-verified as genuinely
addressed, not just re-asserted:

**CR1 (D5 orphan surfacing, server-side).** `PanelProtocol.scala`'s
`PanelResponse.fromDomain` gained an additive `orphanedControlIds: Option[Set[String]] = None`
param (default preserves every existing call site byte-for-byte — verified
by grepping all 20 `PanelResponse.fromDomain` call sites; every one besides
`PublicDashboardRoutes` still passes no `orphanedControlIds`, i.e. `None`).
`PublicDashboardRoutes.scala`'s `GET /api/dashboards/:id/panels` route now
resolves `orphanedControlIds` per panel via a new `resolveOrphanedControlIds`
(mirrors the existing `resolveDataAsOf` async-resolve-then-merge shape) and
`OutputPanelConfig.responseJson` bakes `orphaned: Boolean` onto each control
in the response.

I independently traced every other `PanelResponse.fromDomain` call site
(`PanelRoutes.scala`, `DashboardProposalRoutes.scala`,
`DashboardSnapshotRoutes.scala`'s export/import,
`DashboardContentsRoutes.scala`'s atomic replace,
`DashboardRoutes.scala`'s duplicate, and every `patchsets/*` preview/apply/
undo echo) and confirmed each is genuinely a write-acknowledgment echo or an
ephemeral preview/undo projection — never an independent "read the current
persisted state" surface a viewer relies on. `GET /api/dashboards/:id/panels`
(confirmed via `frontend/.../panelService.ts`'s `fetchPanels`, the ONLY
panel-list fetch the whole frontend calls, used for both authenticated and
public/shared dashboard viewing) is genuinely the one steady-state read path.
The documented scope boundary (files-modified.md's "Scope boundary for CR1"
section) is a legitimate, honestly-disclosed interpretation of Requirement 3
— not a rubber-stamped self-narrowing.

**Live end-to-end confirmation** (not just route-spec tests): restarted the
dev backend to pick up this cycle's commit (the previously-running instance
predated it — see Phase 3 note), added a Numeric-range control via the
running UI, clicked Save, then fetched
`GET /api/dashboards/:id/panels` directly and observed
`"orphaned": false` on the persisted control in the real response. Removed
the control afterward to leave the sandbox dashboard clean.

**4 new route-level tests** in `PublicDashboardRoutesSpec.scala`, verified
real (not fudged): a real `EmbeddedPostgres` instance, real Flyway migration
to v112, real `seedOutputPanelWithDateRangeControl`/`outputRepo.updateSchemaInternal`
schema-drift fixtures, and — genuinely stronger than the pure-function
`OutputControlEligibilitySpec` coverage — a real `nodeSnapshotRepo.overwriteRows`
+ real cardinality scan for the dropdown-kind test (not just asserting
`kindsFor`'s pure function). All 4 pass.

The `orphaned` field is correctly read-only: `OutputControlSpec.AllowedKeys`
(unchanged) still excludes `"orphaned"`, so a client attempting to write it
back gets a strict decode failure — confirmed by reading
`OutputPanel.scala`'s `AllowedKeys` set directly.

**CR2 (DRY / D3 single-source-of-truth).**
`OutputControlsValidator.controlEligible` now literally calls
`OutputControlEligibility.kindsFor(c.column, operators, fieldType).contains(c.kind)`
(line 112) — confirmed by reading the method body directly, not the
docstring. `kindsFor` is no longer dead code in production: grepped every
call site and found it invoked from `controlEligible` (write-time path) —
and, per the new `isOrphaned` method, that SAME `controlEligible` decision is
reused read-only for orphan classification, exactly as claimed ("orphaned"
is not a second copy of the eligibility rule). `resolveOperators` is
correctly scoped as a pure cost optimization (only resolves the
cardinality-gated `Eq`/`In` via a real DB scan when `kind == "dropdown"`) —
it does not re-derive any eligibility decision itself, it only decides which
operators are worth fetching before handing them to `kindsFor`.

No AC silently reinterpreted; no scope creep beyond the two CRs and their
test coverage. `tasks.md` 2.2's originally-flagged gap is now genuinely
closed. Schema (`panel.schema.json`) correctly documents the new `orphaned`
property's read-only, additive nature.

### Phase 2: Code Review — PASS

**D4 regression check (explicitly requested by the orchestrator's cycle-2
brief).** Diffed `PanelService.scala`,
`PanelServiceOutputControlsSpec.scala`, and `ApiRoutes.scala` between cycle 1
and cycle 2: **zero changes** — byte-identical. `OutputControlsValidator.reject`
(the id-diff logic) is also textually unchanged from cycle 1; only its
private `controlEligible` helper's internals changed (CR2's refactor). Since
the wiring, the diff logic, and the existing regression test
(`"an untouched, already-orphaned control ... does not block an unrelated
save"`) are all untouched, and the fresh `sbt test` run re-executed and
passed that exact test again, D4's hardest-won behavior is confirmed intact
— not just asserted.

**`nodeSnapshotRepo`-null-guard regression check.** Re-traced the refactored
`controlEligible`: the null-guard now reads
`case Some(_) if c.kind == "dropdown" && nodeSnapshotRepo == null => Future.successful(Right(()))`,
which only short-circuits when `kind == "dropdown"` — `text`/`numeric-range`/
`date-range` always fall through to the real `kindsFor` check regardless of
`nodeSnapshotRepo`'s nullness, preserving cycle 1's bug fix exactly. In
production, `nodeSnapshotRepoOpt` is `Some(...)` whenever `dbContext` is
non-null (`ApiRoutes.scala:225`), so this null path is a test-fixture
convenience only, never a live gap.

**Gates re-run fresh, in `WORKTREE_PATH`:**
- `npm run lint` — clean, zero warnings.
- `npm run format:check` — clean.
- `npm test` — 363 suites / **3906/3906** tests passed (unchanged from cycle
  1 — zero frontend files changed in this cycle, confirmed via diff).
- `npm --prefix frontend run build` — succeeds.
- `npm run check:scala-quality` — clean (188 pre-existing soft-budget
  warnings, none newly introduced by this ticket's files; no inline-FQN
  violations).
- `sbt test` — 334 suites / **4917/4917 tests passed** (4913 + 4 new), 0
  failed. Matches the executor's claim exactly.
- `npx openspec validate output-panel-control-config --type change` — valid.

(Note on the executor's stated "npm test 4177/4177": my own `npm test` run
against `frontend/` alone shows 3906/3906, identical to cycle 1 — the 4177
figure appears to be a combined frontend+mcp total carried over from the
cycle-1 report's phrasing; `helio-mcp` has no `npm test` script in this
worktree and no `helio-mcp` files are touched by this diff, so it is out of
this review's gate scope. Not treated as a discrepancy since the actual
frontend number I need — 3906/3906 — matches exactly.)

File-size budget: all four cycle-2-touched files (`OutputControlsValidator.scala`
140 lines, `PublicDashboardRoutes.scala` 224 lines, `PanelProtocol.scala` 310
lines, `OutputPanel.scala` 231 lines) are within CONTRIBUTING.md's soft
budgets; none newly crossed the ~400-line trigger.

Minor, non-blocking observation: `resolveOrphanedControlIds` has no explicit
`.recover` around its DB calls (a failed `isOrphaned` future would fail the
whole panel-list request rather than degrading that one panel's orphan flags
to a safe default). This exactly mirrors the pre-existing `resolveDataAsOf`'s
own lack of `.recover` in the same file — not a regression this ticket
introduced, and consistent with established precedent, so not a Change
Request, just noted for awareness.

### Phase 3: UI Review — PASS

Zero frontend files changed in this cycle (confirmed via
`git diff fba7c629...371d0a41 --stat`), so the editor's rendering, both
themes, mobile stack, and a11y behavior verified in evaluation-1.md are
unchanged by construction. Re-verification performed:

- Confirmed the previously-running dev backend process predated this cycle's
  commit (started 12:05, cycle-2 commit landed after) — restarted it via
  `start-servers.sh` to pick up the new code, then re-confirmed via
  `readlink /proc/<pid>/cwd` that both frontend (6621) and the freshly
  restarted backend (9528) serve this worktree.
- Live re-ran the two-click add flow (Add control → Numeric range) — control
  appeared immediately, auto-bound to `revenue` (identical to cycle 1's
  result, confirming no drift).
- Live-verified the actual save round-trip this time (cycle 1 only tested
  add/remove without saving): clicked Save, confirmed the modal transitioned
  to view mode, then fetched the panel-list endpoint directly and confirmed
  the new `orphaned: false` field on the persisted control — genuine,
  first-hand evidence beyond the route-spec tests.
- Cleaned up by removing the added control and re-saving, confirmed the
  panel's `controls` list is empty again.
- No console errors attributable to this change during any of the above.

Full theme/mobile/a11y re-verification was not repeated pixel-by-pixel since
the frontend bundle is provably unchanged from evaluation-1.md's already-
thorough pass (dark/light both themes, mobile stack at 400×800, keyboard-only
add, ARIA live-region announcements, non-color-only orphan badge) — re-doing
that would test the same unchanged code twice for no new signal, and the
live confirmatory pass above already exercises the same component tree
end-to-end against the live app.

### Overall: PASS

Both cycle-1 change requests are genuinely, correctly addressed — verified
independently at the code level (not the executor's self-report), the test
level (fresh gate runs, all green, numbers matching), and live in a running
instance of this worktree (a real save round-trip showing the new
`orphaned` field on a real persisted control). No regression found in D4's
hardest-won non-blocking-on-drift behavior or the `nodeSnapshotRepo`
null-guard fix. No new Change Requests.

### Non-blocking Suggestions

- Consider adding a `.recover`/graceful-degrade wrapper around
  `resolveOrphanedControlIds`'s DB calls in `PublicDashboardRoutes.scala`
  (and, if ever addressed, `resolveDataAsOf` alongside it) so a transient DB
  hiccup on one panel's orphan-status resolution degrades that one panel's
  field rather than failing the whole panel-list response. Pre-existing
  pattern, not introduced by this ticket — optional hardening only.
