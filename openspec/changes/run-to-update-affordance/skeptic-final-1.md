## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed commit `13824cd43a0ae81b48d709387a83d10fac2ab07e` (base
`c9136b96d1c8026d59e27c238c1ebb891efded62`, resolved fresh via
`resolve-review-base.sh`). Working tree clean at time of review except for
this report and the pre-existing untracked `evaluation-1.md`.

### What I verified (with evidence)

**Cross-tenant `visible` gate (design.md D1)** — read `AutoRunTriggerService.scala`
in full. `handleDenied` (lines ~95-118): pipeline-vanished → `None`; owner →
`Denied(canRun=true)`; else `findGrantRole`: `editor` → `canRun=true`,
any other grant (viewer) → `canRun=false`, `None` (no grant at all) → `None`
(entry dropped entirely, no name/reasons leaked). This is exactly D1's
two-gate spec. Independently ran the four targeted backend specs myself
(`sbt testOnly ...DataSourceServiceDeniedPipelinesSpec ...PipelineServiceCanRunSpec
...AutoRunTriggerServiceSpec ...RowWriteResponseDenyReasonCoverageSpec`,
fresh, not copied from the evaluator's transcript) — 34/34 passed, including
`DataSourceServiceDeniedPipelinesSpec`'s real cross-owner, multi-root-pipeline
integration test (`omits the pipeline entirely when the writer has no grant on
it at all`) that constructs a genuinely different-owner second root and proves
the omission at the `DataSourceService` (response) level, not just
`AutoRunTriggerService`'s.

**`deleteRow` unmodified** — read `DataSourceService.scala:906-925` and
`DataSourceRoutes.scala:200` directly myself. `deleteRow` still returns
`Future[Either[ServiceError, Unit]]`, still calls the old
`triggerAutoRunFireAndForget` helper (unchanged, `Unit`-returning,
`.recover`-swallowed), still routes through `ServiceResponse.runNoContent` at
the HTTP layer. There is no `deniedPipelines` field anywhere on its wire type
— the contract genuinely cannot change even by omission-bug, since the type
has no such field to populate. `DataSourceServiceDeniedPipelinesSpec`'s
"deleteRow" block proves this by construction, and I ran it myself (see above).

**Ten `CostReason` codes, both surfaces** — cross-checked
`frontend/src/features/pipelines/services/denyReasonCopy.ts`'s
`ALL_COST_REASON_CODES` against every `CostReason(...)` construction site in
`backend/.../PipelineCostEstimator.scala` via grep — the two ten-code sets are
identical, verbatim. Confirmed the `denied-pipeline-response.schema.json`
enum matches too. Spot-checked "ai-step" and "steps-above-bound" live in the
running app on both surfaces (toast and pipeline page — see below).

**"Show the red" (C5) — reproduced myself, not trusted from the report.** I
deleted the `"ai-step"` entry from `DENY_REASON_COPY` myself (independent of
the executor's/evaluator's transcripts) and reran `npm test`: 8 tests failed
across 3 suites (`denyReasonCopy.test.ts` directly, plus two downstream
consumers — `deniedPipelinesToast.test.ts`'s two tests that assert on the
`ai-step` sentence). Restored the file, reran: 339/339 suites, 3696/3696
tests green, `git diff` on the file showed no residue. This constraint is
genuinely mutation-proven.

**C4/C6 a11y + keyboard operability — verified live in the running app, not
from a screenshot or description.** Started servers via
`start-servers.sh`/`assert-phase.sh` (`PASS`), confirmed both dev processes
(`6528`, `9435`) are bound to `WORKTREE_PATH` via `readlink
/proc/<pid>/cwd`. Built my own write against a pre-existing "HEL-1096 eval
denial pipeline" (an `analyzewithai` step, deterministic `ai-step` denial)
already present from a prior session's fixture setup, submitted a form panel
myself: toast appeared with `"HEL-1096 eval denial pipeline: This pipeline
calls AI, so it wasn't updated automatically."` and a "Run to update" action.
Read the live DOM via `browser_evaluate`:
- `aria-describedby="toast-message-1"` on the action button, real `<BUTTON>`,
  `tabIndex=0`.
- A `role="status"` / `aria-live="polite"` region carries the identical text
  (the visible card is `aria-hidden="true"` — this is the correct
  Toast.tsx-existing pattern, unmodified by this diff, and `aria-describedby`
  is spec-defined to traverse `aria-hidden` targets for the accessible
  description computation, so this is not a defect).
- Waited 8+ real seconds past the default toast duration; the "Run to update"
  button was still present (C6, `duration: 0`).
- Focused the button via keyboard (`document.activeElement` check), pressed
  `Enter`: fired a real `POST /api/pipelines/:id/run` (network tab confirmed;
  422 response — this dev environment's AI-call quota, an unrelated
  environmental condition, not a HEL-1096 defect, matching the evaluator's
  independent observation).
- Navigated to the pipeline's own detail page: the denial block reads
  `role="status"`/`aria-live="polite"`, action `aria-describedby` correctly
  pointing at the reason span — read directly from the live DOM.
- Screenshotted the pipeline-page denial block in dark (native) and light
  (toggled `data-theme`): both render with the `--app-warning`/
  `--app-warning-surface` tokens, legible contrast, no layout break — persisted
  at `/home/matt/Development/helio/.concertino/runs/HEL-1096/evidence/.playwright-mcp/hel1096-skeptic-pipeline-page-theme1.png`
  (dark) and
  `/home/matt/Development/helio/.concertino/runs/HEL-1096/evidence/.playwright-mcp/hel1096-skeptic-pipeline-page-light.png`
  (light).
- Read `PipelineDetailPage.css`'s diff directly: every new rule uses
  `var(--space-*)`/`var(--app-warning*)`/`var(--text-xs)`/
  `var(--app-focus-ring)`/`var(--app-radius-sm)`/`var(--app-transition)` — no
  hardcoded colors or spacing.

**AC3/AC4 (429 distinct message, SSE refresh) — ran the diff's own e2e suite
myself, fresh.** `DEV_PORT=6528 BACKEND_PORT=9435 npx playwright test
e2e/hel1096-run-to-update-affordance.spec.ts` → **2/2 passed** on my own
invocation. Read the spec file in full first: it seeds a real 21-`assert`-step
pipeline (`steps-above-bound`, deliberately AI-quota-independent), does a real
manual run, and asserts the bound table panel's row count updates via the
existing SSE fan-out with zero manual reload (AC4), and separately mocks a
429 with `Retry-After: 42` and asserts the resulting toast contains "too many
runs"/"42s" and explicitly does NOT contain "too many steps" (AC3/D7 — the
429 path never routes through the deny-reason copy mapping). Also read
`runToUpdate.ts` and confirmed `pipelineService.ts` (which defines
`runPipeline`) has a zero-line diff against base — the run path is genuinely
the pre-existing, unmodified `POST /api/pipelines/:id/run`.

**Gates re-run myself, fresh:** `npm run lint` (clean), `npm run typecheck`
(clean), `npm run check:schemas` (clean, 102 protocols / 50 files checked),
`openspec validate run-to-update-affordance --type change` (valid), targeted
`sbt test` subset (34/34, see above), full `npm test` twice (once with the
mutation applied — 8 failures as expected — once restored — 3696/3696 green).
Did not re-run the full `sbt test` (4819 tests, ~5min) a second time given the
targeted subset already exercises every backend file this diff touches and
the evaluator's own pasted output (4819/4819, fresh run, timed) is
unambiguous, not merely asserted.

**HEL-1171 follow-up — verified directly via Linear MCP, not the evaluator's
narrative.** `get_issue(HEL-1171)`: title "Design a non-breaking way to
surface auto-run denials for row DELETE", label `Follow-up`, project
`28f119e2-5738-46b1-a53b-42f73e06b053` (matches C11/v0.8), description
embeds `origin_ticket: HEL-1096` and explicitly documents the owner ruling
and the exact `204`/`helio-mcp` contract reason for `deleteRow`'s exclusion.
Its existence and content make clear `deleteRow` was deliberately, not
accidentally, left out of this ticket's scope — it does not imply the
opposite.

**N>1 denied-pipelines toast message — independent judgment, not borrowed
from the evaluator.** Read `deniedPipelinesToast.ts` and its test: for N>1,
the toast names every pipeline and every specific rule, but carries no action
and no explicit pointer to "go to the pipeline page." I agree this is a real,
minor UX friction point (a user who doesn't already know pipeline detail
pages exist has to infer where to go), but I independently concur it is
non-blocking for v1: (a) this exact trade-off was litigated across 3 design-gate
rounds with an explicit, reasoned owner ruling (a toast `action` cannot target
N>1 pipelines); (b) every named pipeline's own detail page independently
renders the identical denial block with its own "Run to update" button,
discoverable via the existing "Data Pipelines" nav item already visible in
every screenshot I took; (c) the AC's literal text ("offers a manual...action
instead of silently doing nothing") is satisfied for the single-denial case,
which is what the AC's own example implies. This is a legitimate
design-judgment call already made at the correct gate, not a gap this final
gate should re-litigate.

**Fixture-diff and no-regression claims** — spot-checked several of the fixture
diffs (`AutoRunTriggerServiceSpec.scala`, `DatasetWriteAutoRunCoalescingSpec.scala`,
`DatasetWriteAutoRunEndToEndSpec.scala`) myself: all additions were exactly a
new `user` parameter threaded through or a `deniedPipelines: []`/`canRun: true`
default added to existing call sites — no existing assertion's expected value
was altered. Matches the evaluator's "type gained a field" characterization.

### Gate-defect check (per instructions)

The evaluator's report does not rely on mtime ordering for any load-bearing
claim, and states this explicitly. I found no case where this gate accepted
an mtime-ordering claim at face value. No gate defect to record on that axis.

### Verdict: CONFIRM

I independently re-derived every load-bearing claim in `evaluation-1.md` from
ground truth — the actual diff, the actual running app in both themes, fresh
gate re-runs, a self-reproduced red/green mutation cycle, and a direct Linear
lookup — rather than trusting the evaluator's or executor's narrative. I found
no defect. The cross-tenant `visible` gate, the `deleteRow` exclusion, the
ten-code copy mapping, the mutation-provable coverage test, the a11y/keyboard/
theme behavior, the guard-rejection/SSE-refresh chain, and the HEL-1171
follow-up all hold up under adversarial, from-scratch verification. This
change ships.

### Non-blocking notes

- The N>1-denied-pipelines toast lists every pipeline by name but never says
  "visit each pipeline's page to run it" — a one-clause addition would close
  a minor discoverability gap if it surfaces in practice (echoes the
  evaluator's own note; I independently agree it is non-blocking).
- `aria-describedby` on the toast action points at an `aria-hidden="true"`
  span — correct per the accessible-description computation spec (hidden
  elements ARE included when referenced this way), and this is pre-existing
  `Toast.tsx` behavior this diff does not touch. Flagging only so a future
  reviewer doesn't misdiagnose it as a regression.
