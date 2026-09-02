# Evaluation Report — Cycle 2 (evaluation-2.md)

Scope this cycle (per orchestrator): re-verify cycle 1's two blocking findings are genuinely
fixed, re-run every gate independently, and spot-check that the 17-file deletion didn't break
anything downstream. Commit under review: `2e0b47de`.

## Server-staleness pre-check (cycle-1's documented trap) — CAUGHT AGAIN

Before gathering any evidence I cross-checked process start times against the commit:

- Backend (`sbt run`, pid 2595162/2595315) started **11:20:06**; commit `2e0b47de` is
  **11:36:36**. The running backend was **stale by 16 minutes** — the exact failure mode cycle 1
  documented. Vite (pid 2428425) was from 09:57:11.
- I killed all three, re-ran `start-servers.sh`, and confirmed the replacements started
  **11:42:39** (backend) and **11:42:45** (frontend) — both after the commit.
  `assert-phase.sh servers` → `PASS servers`.
- Corroborated behaviorally: anonymous `GET /api/dashboards/:id/panels/:panelId/rows` now returns
  `404 {"message":"Dashboard not found"}` — the correct route response, not the misleading `401`
  the stale server gave cycle 1.

**All UI/live evidence below is from the post-restart servers.**

## Phase 1: Spec Review — PASS

- Cycle 2's change is confined to closing cycle 1's two CRs; no scope creep. `git show --stat
  2e0b47de` touches 26 source/test/schema files plus `files-modified.md`/`ticket.md` — every one
  traceable to CR1 or CR2.
- `openspec validate --type change public-dashboards-export-docs-sweep --strict` → **valid**
  (re-run by me).
- Spec-delta coverage re-derived independently, not taken from cycle 1: I enumerated every
  `openspec/specs/**` file still carrying a swept identifier (22 files: `alert-*`, `patch-set-*`,
  `collection-panel-*`, `timeline-panel-type`, `chart-type-display-config`,
  `table-panel-display-config`, `markdown-panel`, `image-panel-type`, `mcp-metric-tools`,
  `mcp-panel-composition-tools`, `panel-batch-create`, `pipeline-*`,
  `assistant-conversation-loop`, `workspace-context-assembly`) and confirmed **all 22 have a
  delta** in `openspec/changes/.../specs/` (28 deltas present). The residue is pending-archive,
  not leftover work.

## Phase 2: Code Review — PASS

### Cycle-1 CR1 — dead `outputDataTypeId` chain — **VERIFIED FIXED**

`grep -rn selectPipelineNameByOutputTypeId` across the whole tree returns exactly **one** hit,
and it is a historical comment (`pipelineStep.ts:451`) — the selector definition, its two Redux
tests, and both `Pipeline.outputDataTypeId` / `PipelineSummary.outputDataTypeId` fields are gone,
along with the false "still read by the legacy wizard (HEL-937)" comment. The replacement comment
at `pipelineStep.ts:443-451` now states the correct, verifiable fact (the only reader was itself
dead). All 13 fixture sites named in CR1 were cleaned; `npm test` compiles and passes.

Remaining `outputDataTypeId` hits are all allowlisted-by-design: HEL-NNN-prefixed historical
comments (clause iii), and test-local identifiers that are not the deleted chain
(`WorkspaceSearchServiceSpec`'s own local case-class field, `V94OutputsMigrationSpec`'s
pre-migration column references, which a migration spec necessarily must name).

### Cycle-1 CR2 — `metricId` shim — **VERIFIED FIXED (deletion route taken)**

`grep -rn metricId` returns **zero** hits in all four layers cycle 1 named:
`DashboardProposalProtocol.scala` (field/encode/decode), `AssistantProposalToolSchemas.scala`,
`schemas/dashboards/dashboard-proposal.schema.json`, `helio-mcp/src/types.ts`. I read the full
`ProposalPanel` case class and both `write`/`read` bodies — 17 fields, symmetric, no `metricId`.

All three falsely-live comments are fixed, each checked against the live code rather than the
diff text:
- `ApiRoutes.scala` — the bogus "metricRepo threaded in ... carries a metricId" comment is
  deleted; the surviving line is `new DashboardProposalService(dashboardService, panelService,
  outputRepoOpt.orNull)`, which now has no comment contradicting it.
- `ProposalPanelSupport.scala:47-52` — the "THEN (HEL-549) a panel carrying a `metricId`
  resolves" clause is gone; the doc-block now describes only the `outputId` path that the code
  actually implements.
- `DashboardProposalProtocol.scala:6-9` header no longer cites the retired
  `metric`/`chart`/`table` panel kinds.

`AssistantSystemPromptSpec.scala:69` is a genuine absence-guard (asserts `"metricId"` and the
retired kind strings do **not** appear in the prompt), so the deletion is regression-protected,
not merely un-tested.

### Behavioral spot-check of the deletion — done live, not inferred

Deleting a decoded field can silently convert "tolerated" into "rejected" for older clients.
I probed the running backend directly:

| Probe | Result |
|---|---|
| `POST /api/dashboards/apply-proposal` with a stray `"metricId":"stray-value"` | **201** — tolerantly ignored |
| Same request without `metricId` (control) | **201** |

So the removal is wire-backward-compatible: an old MCP client still emitting `metricId` is not
broken by this change. Both probe dashboards deleted afterward (`204`, `204`) — shared dev DB
left clean.

### Downstream-breakage spot-check

`ProposalPanel` construction sites: `AuditMutationInstrumentationSpec.scala:632` is fully
positional with 17 arguments — I counted them against the case class and confirmed the arity and
ordering are right (`Some("hello")` lands on `content`, position 6). The other six sites use
named arguments. `sbt test` compiling and passing is the binding proof.

### Gates — every one re-run by me, fresh, in `WORKTREE_PATH` (post-restart)

| Gate | Result |
|---|---|
| `npm run lint` | PASS |
| `npm run format:check` | PASS |
| `npm run typecheck` | PASS |
| `npm test` | PASS — 252 suites, **2588** tests, 0 failed |
| `npm --prefix frontend run build` | PASS |
| `cd backend && sbt test` | PASS — 237 suites, **3550** tests, 0 failed, 0 canceled |
| `check:schemas` | PASS |
| `check:openspec` | PASS |
| `check:spec-structure` | PASS |
| `check:scala-quality` | PASS |
| `check:e2e-types` | PASS |
| `check:helio-mcp-types` | PASS |
| `check:repo-integrity` | PASS |
| `openspec validate --strict` | valid |

Counts move in the expected direction and by the expected amount: frontend 2591 → 2588 (−3: the
two `selectPipelineNameByOutputTypeId` selector tests plus one fixture assertion), backend
3555 → 3550 (−5: the `metricId` encode/decode cases in `DashboardProposalProtocolSpec`). No
suite was skipped or silently dropped to reach green.

### Sweep re-run (ticket AC 6 / task 7.2) — **now clean**

I re-ran all 12 patterns across all 9 named directories myself, then filtered out Decision 6's
allowlist classes (db/migration; `openspec/changes/**`; HEL-NNN-prefixed comments and JSON Schema
`description` strings; absence-asserting tests). The two live-code classes cycle 1 flagged are
the only ones that ever failed the allowlist, and both are now gone. The residual hits I
inspected line-by-line reduce to: pending-archive `openspec/specs` deltas (all 22 covered),
HEL-NNN historical comments, test-local variable names, and
`backend/src/test/resources/db/fixtures/hel904-real-dump.sql` — a real `pg_dump` fixture that
must contain pre-migration data to be worth anything.

## Phase 3: UI Review — PASS

- **E2E spec re-run by me** (`DEV_PORT=6342 npx playwright test
  e2e/hel910-pipeline-to-dashboard-flow.spec.ts`): **2 passed**, printing `HEL-910 flow: 28
  interactions` and `HEL-910 existing-Output placement: 2 interactions` — byte-identical to
  cycle 1, confirming this UX was genuinely untouched. Scenario 2 meets its ≤2 AC exactly.
- `/pipelines` (the only page whose Redux slice and types this cycle edited) renders correctly,
  title resolves to `Data Pipelines · Helio`, and the console shows **0 errors, 0 warnings**.
- Public rows route re-confirmed present and correctly ACL-denying anonymously (`404`, and
  distinguishable from cycle 1's stale-server `401`).
- No visual/CSS surface was touched this cycle (deletions of dead type fields, a selector, and
  comments only), so no design-token or shared-component review surface was introduced.

## Overall: PASS

Both cycle-1 blocking findings are independently verified as genuinely fixed — not merely claimed
fixed — by fresh greps, full-file reads of the corrected code and comments, a live wire-
compatibility probe, and a complete from-scratch gate run against correctly-dated servers. The
sweep, this ticket's headline deliverable, is now clean under Decision 6's allowlist.

## Non-blocking Suggestions

Carried forward from cycle 1 (still open; none blocking, none regressions):

- `e2e/hel910-pipeline-to-dashboard-flow.spec.ts:24` — stray `///` (triple slash) mid-comment,
  should be `//`.
- `PublicDashboardRoutes` — the no-op `paged.copy(items = paged.items.map(identity[JsValue]))`
  noted in cycle 1 (file has since moved; locate by grep).
- `DashboardService.validateImportPanels` — a one-line comment noting that the throwaway
  `DashboardId("")` / random `PanelId` are validation-only placeholders.

New this cycle:

- `WorkspaceSearchServiceSpec.scala:147/169/220/313/323/325` uses a **test-local** field named
  `outputDataTypeId` that now holds a real Output id. It is correctly explained by the comment at
  `:138` and is not part of the deleted chain, but renaming it to `outputId` would remove the last
  confusing echo of a name that no longer exists anywhere in production code, and would shrink the
  sweep's manual-triage surface for whoever runs it next.
- Stray dev-DB dashboard `HEL909-EVAL4-clobber` from an earlier evaluation still present (not
  this ticket's, re-noted for the record).
