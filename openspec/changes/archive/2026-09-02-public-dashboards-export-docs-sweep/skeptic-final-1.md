# Skeptic Report — final gate (round 1, skeptic-final-1.md)

Commit under review: `2e0b47de`. Everything below is derived from my own fresh
commands/probes, not from `evaluation-1.md`/`evaluation-2.md` (read only as claims).

## Server-freshness pre-check (the documented two-time trap)

`start-servers.sh` reported "already healthy ... reusing" for BOTH servers, so I did not
trust it and checked process ages directly:

- backend `sbt run` pid 2655322 started **11:42:39**, vite pid 2655692 started **11:42:45**
- HEAD `2e0b47de` committed **11:36:36**
- `/proc/<pid>/cwd` for both resolves inside this worktree (`.../HEL-910/backend`, `.../HEL-910/frontend`)

Both post-date the commit and belong to this worktree. All live evidence below is from
these processes. (The reuse was legitimate this time — cycle 2 had already restarted them.)

## What I verified (with evidence)

### Gates — all 14 re-run by me, none taken on the evaluator's word

| Gate | Result |
|---|---|
| `npm run lint` | PASS (exit 0) |
| `npm run typecheck` | PASS |
| `npm run format:check` | PASS |
| `npm test` | PASS — **252 suites, 2588 tests, 0 failed** |
| `cd backend && sbt test` | PASS — **237 suites, 3550 tests, 0 failed, 0 canceled** (203s) |
| `check:schemas` | PASS — 73 schemas across 48 protocol files, 7 panel-type enum surfaces |
| `check:openspec` | PASS |
| `check:spec-structure` | PASS |
| `check:scala-quality` | PASS |
| `check:e2e-types` | PASS |
| `check:helio-mcp-types` | PASS |
| `check:repo-integrity` | PASS |
| `openspec validate public-dashboards-export-docs-sweep --strict` | valid |
| `npx playwright test e2e/hel910-...spec.ts` | 2 passed |

Both test counts reproduce evaluation-2's numbers **exactly** (2588 / 3550), so its gate
table is corroborated rather than merely asserted.

### Public read path — probed live over HTTP, not inferred

I granted a public viewer role on a real dev dashboard, probed anonymously, then reverted.

- anonymous `GET /api/dashboards/:id/panels` → **200**, and `dataAsOf` resolves
  (`2026-09-01T02:35:28Z`) on all 5 output panels — the new `panel → output →
  pipeline.lastRunAt` path genuinely works, not a `None` fallback.
- anonymous `GET /api/dashboards/:id/panels/:panelId/rows?limit=2` → **200**
  `{"items":[{"amount":10.0,"name":"Alpha"},{"amount":20.0,"name":"Beta"}],"total":3}` — real
  rows out of `node_snapshots`.
- **cross-dashboard confinement probe** (the security-critical property): requesting a
  panel id belonging to a *different, private* dashboard against the shared dashboard's
  path → **404 `{"message":"Panel not found"}`**. Confinement holds live.
- after revoking the grant, the same anonymous row request → **404 "Dashboard not found"**.

Confirmed by construction too: `PanelRepository.findAllByDashboardId` filters
`_.dashboardId === dashboardId.value` **and** re-applies the owner/grantee/public access
predicate, so `resolveRows` cannot reach an off-dashboard panel.

Production wiring is real, not degraded: `ApiRoutes.scala:630` passes `outputRepoOpt`,
`Option(pipelineRepo)`, `nodeSnapshotRepoOpt` (all `Some` when `dbContext` is non-null),
so the graceful-degradation branches are test-only.

### RLS smoke — checked specifically for the superuser/BYPASSRLS vacuity trap

`PublicPathRlsSmokeSpec` is **not** vacuous. It creates a real `NOSUPERUSER` role
(`helio_app_test`), drives a separate Hikari pool with `SET ROLE helio_app_test`, seeds via
the **real repositories** (so it cannot drift from the live schema), and asserts both the
anonymous denial (0 rows) *and* the owner-positive (1 row). Critically it then carries a
genuine **mutation-based red proof**: on a disposable Postgres it drops
`outputs_select`/`node_snapshots_select` and asserts the owner-positive assertion itself
flips 1 → 0. That is a real red-before-trusted guard, not a green-by-construction test.

### Export → import round-trip (AC2) — proven live, because no test covers it

No automated test exercises an export→import round-trip of an **Output-bound** dashboard
(the existing round-trip tests use zero-panel or pre-remodel dashboards). So I proved it
myself against the running server on a real 6-panel dashboard (5 output panels):

- export → `version: 2`, each output panel carrying `config.outputId` (no reshape, matching
  design.md's "no version bump" decision)
- re-import → **201**
- re-export and normalized compare: **panels identical: True, layout identical: True,
  appearance identical: True, version 2 == 2**

AC2's first half therefore holds behaviorally. Its second half ("named error") is covered by
a non-vacuous test (`ApiRoutesSpec.scala:1517`) that runs against the **production-wired**
`routes()` (real `outputRepo`, not the `null` default), asserts the message contains the bad
id, and asserts no dashboard was created.

### HEL-940 wire rename — probed live end-to-end

- `POST /api/dashboards/apply-proposal` with `outputId` → **201**, and the persisted panel
  exports as `{"outputId": "hel904-output-3a46..."}`.
- the same request with the OLD `dataTypeId` → **400 "panel 1 ('Bound'): a output panel
  requires a outputId"** — cleanly rejected, no silent shim, consistent with Decision 11.

So the rename is not half-applied: backend, schemas (`check:schemas` proves protocol/schema
parity), frontend (`ProposalReview.tsx`/`CombinedProposalReview.tsx` renamed symmetrically,
user-visible labels unchanged), and helio-mcp all moved together.

### Sweep — re-run independently across all declared patterns/dirs

I ran all 12 patterns myself over `backend/src frontend/src helio-mcp/src e2e schemas
openspec/specs docs README.md CLAUDE.md`. `com\.helio\..*DataType` and `TODO(remodel)`:
zero hits. Every remaining hit I inspected reduces to an allowlisted class under design.md
Decision 6 (HEL-NNN historical comments, absence-asserting tests, the real `pg_dump`
fixture, test-local identifiers) — with one exception, see note 3.

### E2E spec — its own claims checked, not taken at face value

Re-ran it: `28 interactions` / `2 interactions`, 2 passed. The counting helper is honest —
every click in both measured scenarios routes through `io.click` (the only bare
`page.click` is at line 55, in pre-measurement login setup). I checked the header's
"unreachable by construction" argument against the actual `OutputEditorSheet` default and
it is accurate. Scenario 2 meets its ≤2 AC exactly. CI wiring for the spec is present
(`ci.yml`), and the Sleeper-MCP non-wiring is documented with a *corrected* reason.

### "Known, accepted" list — honesty check

All items are stated accurately or **better** than documented. The Sleeper note actively
corrects the ticket's own wrong premise (not a credentials blocker) rather than hiding
behind it. No CSS/visual files changed at all, so there is no design-token/component
review surface in this diff.

## Verdict: REFUTE

Nothing in the remodel itself is broken — the diff is coherent, the rename is complete, and
every AC I could trace is satisfied. I am refuting on one reproduced, user-facing gap that
this ticket's headline feature converts from cosmetic into a data-exposure one-way door,
plus two cheap missing guards on paths I had to verify by hand because nothing else does.

## Change Requests

1. **A publicly-shared dashboard can never be un-shared — and this ticket is what makes
   that expose row data.** Reproduced end to end:
   - `POST /api/dashboards/:id/permissions {"role":"viewer"}` (no `granteeId`) creates a
     `grantee_id IS NULL` public grant → **201**.
   - The only revoke route is `DELETE /api/dashboards/:id/permissions/:userId`
     (`PermissionRoutes.scala:44`, `UserIdSegment`), and
     `ResourcePermissionRepository.delete` (`:52-57`) filters
     `r.granteeId === UUID.fromString(granteeId.value)` — which can **never** match a NULL
     grantee. There is no API path that deletes a public grant.
   - I had to remove my own probe grant with a direct `psql DELETE`. Corroborating
     evidence that this bites in practice: a stray public grant on dashboard
     `70df04b5-de21-4fdb-8a2a-3263dac0b95f` has been live in the dev DB since
     **2026-07-26** with no way to revoke it.
   - Additionally, `DELETE /api/dashboards/:id/permissions/public` (any non-UUID segment)
     returns **500 `{"message":"Internal server error"}`** — an unhandled
     `UUID.fromString` `IllegalArgumentException` — instead of 400/404.

   This code is pre-existing and untouched by this diff, so I am not claiming a regression.
   The reason it blocks *here* is impact: before this row, a public grant exposed panel
   metadata; `GET /api/dashboards/:dashboardId/panels/:panelId/rows` now serves the
   underlying **row data** through that same irrevocable grant, and v0.7.8 is the first
   time any of it runs in production. Shipping an un-revokable public data share is a
   privacy one-way door for real users.

   Either resolution is acceptable:
   (a) fix it here — accept a `public` sentinel on the revoke path and add a
   NULL-grantee delete in `ResourcePermissionRepository`, plus reject non-UUID segments
   with a 400 rather than a 500; or
   (b) get an explicit human decision to ship as-is, with a blocker-tagged follow-up
   ticket filed and named in the PR (the same treatment HEL-941/HEL-942 got) — not left
   silent.

2. **Add a regression guard for cross-dashboard panel confinement on the new public rows
   route.** `PublicDashboardRoutes.scala:69-76` explicitly justifies choosing
   `findAllByDashboardId` over `PanelRepository.findByIdInternal` precisely so a panel is
   proven to belong to the dashboard whose ACL was checked — but no test asserts it.
   `PublicDashboardRoutesSpec` covers shared-happy-path, private-404, and
   unresolvable-degrades-to-empty; none covers "panel id from a *different* dashboard".
   I verified the behavior is correct live (404 "Panel not found"), so this is a missing
   guard, not a live vulnerability — but "simplify this to `findByIdInternal`" is exactly
   the plausible future refactor that would silently open cross-tenant row leakage on an
   **unauthenticated** route with every test still green. Add the case to
   `PublicDashboardRoutesSpec`.

3. **Add an export → import round-trip test for an Output-bound dashboard (AC2, first
   half).** AC2 reads "Export → import round-trip of a migrated dashboard produces an
   identical dashboard (panels, layout, appearance) against the same pipelines", but the
   only round-trip tests in `ApiRoutesSpec` are zero-panel ("import assigns new IDs on each
   import") or pre-remodel kinds. The new-world path — an `output` panel whose
   `config.outputId` must survive export and then satisfy this ticket's *new*
   `validateImportPanels` `findByIdOwned` check — has no automated coverage, and that new
   check is precisely what could reject a legitimate round-trip. I verified it passes live
   (panels/layout/appearance all identical), so this is coverage owed for an AC that is
   currently only satisfied by my manual probe.

## Non-blocking notes

1. **`openspec/specs/pipeline-run-execution/spec.md:167`** carries `output_data_type_id`
   (a declared sweep pattern, `type_id`) and is the **one** live spec file with no delta in
   this change. Its text is a historical-removal note citing HEL-904/HEL-891, so allowlist
   clause (iii) covers it in spirit — but note the enumeration in `evaluation-2.md` is
   wrong and should not be pasted into the PR as-is: it claims "22 files, all 22 have a
   delta". My own enumeration finds **27** live spec files carrying a swept identifier, 26
   with deltas and `pipeline-run-execution` without. Worth also rewording that
   requirement's heading ("writes schema snapshot to **Type Registry**") and its scenario
   name ("Output **DataType** fields reflect run result schema"), which are stale
   vocabulary in a live normative contract.
2. **`tasks.md:27` (task 4.2) is checked off as "Update `docs/agent-native.md`", but this
   branch changed that file by zero bytes** (`git diff main...HEAD -- docs/agent-native.md`
   is empty). The file's content *is* correct and current — I verified its rename table
   against the live helio-mcp tool set (57 registered tools; every retired name it lists is
   genuinely absent, and it is a rename table rather than an exhaustive catalogue, so the
   tools it omits are not a defect). The task was satisfied by an earlier row. The PR
   should say "verified already current, no change needed" rather than claiming an update
   this ticket did not make.
3. **Error-message grammar, user-visible and prod-bound:** "a output panel requires a
   outputId" → "an output panel requires an outputId".
4. **`e2e/hel910-pipeline-to-dashboard-flow.spec.ts:24`** still has the stray `///`
   (triple-slash) mid-comment flagged in evaluation-1 and again in evaluation-2. Trivial,
   but it has now survived two cycles.
5. **`PublicPathRlsSmokeSpec`** issues `SET`/`RESET app.current_user_id` as standalone
   statements against a 5-connection Hikari pool, then runs the assertion query as a
   separate `run` — session-scoped settings on a pooled connection. It works today via
   Hikari's connection affinity and it fails *closed* (a mismatch shows as a test failure,
   never a false pass), so this is not a correctness risk; `maximumPoolSize(1)` or a single
   composed session would make it deterministic.
6. **`AggregatorRegressionSpec.scala:57,165`** uses `"dataTypeId"` inside an opaque
   `config: JsValue` round-trip payload. It is arbitrary JSON content, not a live field, so
   the test is correct — but it is the last confusing echo of the name in a non-comment
   position and is free to rename.
7. **`scripts/agent/*.sh` remain stale** (3 references to `/api/types`-era endpoints).
   `scripts/` is deliberately outside the ticket's declared sweep directories, and
   `docs/agent-native.md` flags this prominently and honestly rather than presenting them
   as current. Recorded, not held against the sweep.
8. Dev-DB hygiene: all my probe data was removed and verified gone (round-trip dashboard,
   wire-probe dashboard, public grant — the latter via `psql`, since CR1 means no API can).
   The one remaining `grantee_id IS NULL` grant predates me (2026-07-26).
